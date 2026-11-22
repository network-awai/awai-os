#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const namespace = "awai-pc-release-build";
const defaultPlan = "voc-m-16c-128gb-800s-amd";
const plans = new Set([defaultPlan, "vc2-16c-64gb"]);
const planKey = "awai.network/vke-plan";
const labelKey = "vke.vultr.com/node-pool";
const taintKey = "awai.network/release-build";
const ownerKey = "awai.network/vke-run";
const jobNames = ["awai-pc-release-build", "awai-pc-release-restore"];
const finished = new Set(["Succeeded", "Failed"]);
const systemPods = /^(calico-node|calico-typha|csi-vultr-node|konnectivity-agent|kube-proxy)-/;
// Release pools carry this Vultr node-pool label (and therefore node label) so the
// in-cluster build-reaper can find them. Tatara pools carry tatara.network/role.
export const purposeKey = "awai.network/purpose";
export const purposeValue = "release-build";
// Shared with other on-demand pools (Tatara APK lane): the build-reaper deletes
// idle pools carrying this label and never the Tatara pools.
export const reapableKey = "awai.network/reapable";
export const tataraRoleKey = "tatara.network/role";
export const releaseLabel = /^awai-pc-release-[0-9a-f]{12}$/;

// Identify the Awai Tatara cluster by the role labels on its nodes, not by pool
// names, so renaming a Tatara pool does not break the check.
export function tataraRoles(nodes) {
  return [...new Set(nodes.map((node) => node.metadata.labels?.[tataraRoleKey]).filter(Boolean))].sort();
}

export function requireTataraCluster(nodes) {
  requireState(tataraRoles(nodes).includes("system"),
    `The kubeconfig must target the Awai Tatara cluster (no node labelled ${tataraRoleKey}=system).`);
}

function requireState(ok, message) {
  if (!ok) throw new Error(message);
}

export async function teardown({ kube, vultr, run, wait, deleteLock, empty = false, allowMissing = false }) {
  const lock = await kube("get", "namespace", namespace);
  requireState(lock.metadata.uid === run.uid && lock.metadata.annotations?.[ownerKey] === run.label,
    "The release namespace no longer belongs to this run.");

  const jobs = (await kube("-n", namespace, "get", "jobs")).items;
  requireState(empty ? jobs.length === 0 : jobs.length === jobNames.length && jobNames.every((name) => jobs.some((job) =>
    job.metadata.name === name && job.spec.template.spec.nodeSelector?.[labelKey] === run.label &&
    job.status?.conditions?.some(({ type, status }) => type === "Complete" && status === "True"))),
  empty ? "An empty release must have no Jobs." : "The build and independent restore Jobs must both complete before release.");

  let nodes = (await kube("get", "nodes", "-l", `${labelKey}=${run.label}`)).items;
  requireState(nodes.length <= 1, "Unexpected number of release nodes.");
  const pods = (await kube("get", "pods", "-A")).items;
  const onPool = new Set(nodes.map((node) => node.metadata.name));
  requireState(pods.every((pod) => {
    if (pod.metadata.namespace === namespace) return !empty && finished.has(pod.status?.phase);
    if (finished.has(pod.status?.phase)) return true;
    return !onPool.has(pod.spec.nodeName) ||
      (pod.metadata.namespace === "kube-system" && systemPods.test(pod.metadata.name));
  }), "An active release Pod or unexpected workload still uses this pool.");
  requireState((await kube("-n", namespace, "get", "pvc")).items.length === 0,
    "The release namespace contains a PVC. Preserve it before removing the namespace.");

  const pools = await vultr.list();
  const matches = pools.filter((pool) => pool.label === run.label);
  requireState(matches.length <= 1, "More than one Vultr pool matches this run.");
  requireState(!empty || allowMissing || matches.length === 1,
    "The empty release needs a provider pool. Investigate a missing or ambiguous create before removing the lock.");
  if (matches.length === 1) {
    const [pool] = matches;
    requireState(pool.plan === (run.plan ?? defaultPlan) && pool.tag === run.label,
      "The provider pool does not match the release owner and plan.");
    requireState(!pool.labels?.[tataraRoleKey], "Refusing to remove a Tatara pool.");
    requireState(nodes.every((node) => node.metadata.labels["vke.vultr.com/node-pool-id"] === pool.id),
      "The Kubernetes node belongs to a different provider pool.");
    try {
      await vultr.remove(pool.id);
    } catch (error) {
      // A lost DELETE response can still mean Vultr accepted the deletion.
      // Keep the lock until the subsequent inventory proves its outcome.
      if (error.name !== "TimeoutError" && !(error instanceof TypeError)) throw error;
    }
  }
  await wait(async () => {
    const activePools = await vultr.list();
    nodes = (await kube("get", "nodes", "-l", `${labelKey}=${run.label}`)).items;
    return !activePools.some((pool) => pool.label === run.label) && nodes.length === 0;
  }, "Vultr and Kubernetes did not both report the release pool gone");
  await deleteLock(run.uid);
}

// Idempotent release used on every failure, interruption or ambiguous exit.
// Built outputs already live in B2, so nothing on the pool is worth keeping.
export async function abort({ getLock, kube, vultr, wait, deleteLock, deleteJobs, settle = async () => {}, expect }) {
  const lock = await getLock();
  if (!lock) return { released: false, reason: "No release run is recorded." };
  const label = lock.metadata.annotations?.[ownerKey];
  requireState(releaseLabel.test(label ?? ""), "The release lock records no valid run.");
  // A caller that owns one run must never release a different, newer run.
  if (expect && expect !== label) return { released: false, reason: `Run ${expect} was already released; ${label} is another run.` };
  const plan = lock.metadata.annotations?.[planKey] ?? defaultPlan;
  requireState(plans.has(plan), "The release plan is outside the supported VKE plans.");
  await deleteJobs();
  await wait(async () => (await kube("-n", namespace, "get", "pods")).items.length === 0,
    "Release Pods did not terminate");
  // A lost create response can surface a pool late; give the inventory a moment.
  if (!(await vultr.list()).some((pool) => pool.label === label)) await settle();
  await teardown({ kube, vultr, wait, deleteLock, empty: true, allowMissing: true,
    run: { label, plan, uid: lock.metadata.uid } });
  return { released: true, label };
}

export async function releaseWithRetry(attempt, { attempts = 3, pause = () => delay(30_000), log = console.error } = {}) {
  let last;
  for (let index = 1; index <= attempts; index += 1) {
    try {
      return await attempt(index);
    } catch (error) {
      last = error;
      log(`Release attempt ${index}/${attempts} failed: ${error.message}`);
      if (index < attempts) await pause();
    }
  }
  throw last;
}

function kubeClient(config) {
  const base = ["--kubeconfig", config, "--request-timeout=20s"];
  const env = { ...process.env };
  delete env.VULTR_API_KEY;
  return (args, output = "json", input) => {
    const result = spawnSync("kubectl", [...base, ...args, ...(output ? ["-o", output] : [])],
      { encoding: "utf8", env, input, timeout: 115_000, maxBuffer: 32 * 1024 * 1024 });
    requireState(!result.error && result.status === 0, `kubectl ${args.join(" ")} failed`);
    if (output !== "json") return result.stdout.trim();
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  };
}

function vultrClient(cluster, key) {
  const base = `https://api.vultr.com/v2/kubernetes/clusters/${cluster}/node-pools`;
  async function request(url, method = "GET", body) {
    const response = await fetch(url, {
      method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    if (method === "DELETE" && response.status === 404) return null;
    if (!response.ok) {
      throw Object.assign(new Error(`Vultr ${method} returned HTTP ${response.status}`), { httpStatus: response.status });
    }
    const bodyText = await response.text();
    return bodyText ? JSON.parse(bodyText) : null;
  }
  return {
    async list() {
      const result = await request(`${base}?per_page=500`);
      requireState(Array.isArray(result.node_pools) && !result.meta?.links?.next,
        "Vultr did not return a complete node-pool inventory.");
      return result.node_pools;
    },
    async create(label, plan) {
      await request(base, "POST", {
        label, tag: label, plan, node_quantity: 1, auto_scaler: false,
        labels: { [purposeKey]: purposeValue, [reapableKey]: "true" },
        taints: [{ key: taintKey, value: "release", effect: "NoSchedule" }],
      });
    },
    async remove(id) {
      await request(`${base}/${encodeURIComponent(id)}`, "DELETE");
    },
  };
}

let interrupted = null;

async function wait(read, message) {
  const deadline = Date.now() + 15 * 60_000;
  do {
    if (interrupted && !releasing) throw new Error(`Interrupted by ${interrupted}`);
    const value = await read();
    if (value) return value;
    await delay(10_000);
  } while (Date.now() < deadline);
  throw new Error(message);
}

let releasing = false;

function runChild(command, args, env) {
  return new Promise((resolveChild) => {
    // The build runs in its own process group and a forwarded signal goes to the whole
    // group: killing only the shell leaves its background children holding the inherited
    // stdio, and 'close' would not arrive until they exit on their own.
    const child = spawn(command, args, { stdio: "inherit", env, detached: true });
    const forward = (signal) => {
      if (child.exitCode !== null) return;
      try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
    };
    const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => {
      const handler = () => forward(signal);
      process.on(signal, handler);
      return [signal, handler];
    });
    const timer = setTimeout(() => forward("SIGTERM"), 6 * 60 * 60_000);
    child.on("error", () => {});
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      for (const [name, handler] of handlers) process.off(name, handler);
      resolveChild(code === 0 && !signal);
    });
  });
}

async function main([mode, kubeconfig, ...args]) {
  if (mode === "release-empty") mode = "abort";
  requireState(["status", "run", "release", "abort"].includes(mode) && kubeconfig &&
    (mode === "run" ? args.length > 1 && args[0] === "--" : args.length === 0),
  "Usage: vke-release-pool.mjs status|release|abort KUBECONFIG | run KUBECONFIG -- COMMAND [ARGS]");
  // Never die mid-provisioning or mid-release on a signal: record it and release.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (!interrupted) console.error(`Received ${signal}; releasing the build pool before exit.`);
      interrupted ??= signal;
    });
  }
  const config = resolve(kubeconfig);
  const call = kubeClient(config);
  const kube = (...command) => call(command, command[0] === "delete" ? null : "json");
  const deleteLock = (uid) => {
    call(["delete", "--raw", `/api/v1/namespaces/${namespace}`, "-f", "-"], null,
      JSON.stringify({ apiVersion: "v1", kind: "DeleteOptions", preconditions: { uid } }));
  };
  const server = call(["config", "view", "--minify"], "jsonpath={.clusters[0].cluster.server}");
  const match = /^https:\/\/([a-f0-9-]{36})\.vultr-k8s\.com:6443$/.exec(server);
  requireState(match, "The selected kubeconfig must point to the Vultr VKE API.");
  const nodes = (await kube("get", "nodes")).items;
  requireTataraCluster(nodes);
  const pools = [...new Set(nodes.map((node) => node.metadata.labels?.[labelKey]).filter(Boolean))];
  const getLock = async () => call(["get", "namespace", namespace, "--ignore-not-found"], "json");
  if (mode === "status") {
    const lock = call(["get", "namespace", namespace, "--ignore-not-found"], "jsonpath={.metadata.annotations.awai\\.network/vke-run}");
    console.log(JSON.stringify({ cluster: match[1], pools, tataraRoles: tataraRoles(nodes), releaseRun: lock || null }));
    return;
  }
  requireState(process.env.VULTR_API_KEY, "Load VULTR_API_KEY from the authorized secret store.");
  const vultr = vultrClient(match[1], process.env.VULTR_API_KEY);
  const deleteJobs = async () => {
    call(["-n", namespace, "delete", "jobs", "--all", "--cascade=foreground", "--wait=true", "--timeout=5m"], null);
  };
  const abortRun = (expect = process.env.AWAI_VKE_EXPECT_RUN?.trim() || undefined) =>
    abort({ getLock, kube, vultr, wait, deleteLock, deleteJobs, settle: () => delay(60_000), expect });
  const releaseOrReport = async (label, attempt) => {
    releasing = true;
    try {
      const result = await releaseWithRetry(attempt);
      console.error(result?.released === false ? result.reason : `Released build pool ${result?.label ?? label}.`);
    } catch (error) {
      console.error(`RELEASE FAILED: build pool ${label ?? "(unknown)"} may still be billing: ${error.message} ` +
        "Run `node scripts/operator/vke-release-pool.mjs abort KUBECONFIG` now. " +
        "The in-cluster build-reaper deletes an idle release pool after 30 minutes.");
      process.exitCode = 3;
      throw error;
    }
  };
  if (mode === "abort") {
    await releaseOrReport(null, () => abortRun());
    return;
  }
  if (mode === "release") {
    const lock = await kube("get", "namespace", namespace);
    const label = lock.metadata.annotations?.[ownerKey];
    requireState(/^awai-pc-release-[0-9a-f]{12}$/.test(label ?? ""), "No owned release pool is recorded.");
    const plan = lock.metadata.annotations?.[planKey] ?? defaultPlan;
    requireState(plans.has(plan), "The release plan is outside the supported VKE plans.");
    await teardown({ kube, vultr, wait, deleteLock, empty: mode === "release-empty", run: { label, plan, uid: lock.metadata.uid } });
    return;
  }

  requireState(!(await vultr.list()).some(({ label, labels }) =>
    label?.startsWith("awai-pc-release-") || labels?.[purposeKey] === purposeValue),
    "An existing release pool must be reconciled before starting a new run.");
  const plan = process.env.AWAI_VKE_RELEASE_PLAN ?? defaultPlan;
  requireState(plans.has(plan), "The release plan is outside the supported VKE plans.");
  const label = `awai-pc-release-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const lock = call(["create", "-f", "-"], "json", JSON.stringify({
    apiVersion: "v1", kind: "Namespace",
    metadata: { name: namespace, annotations: { [ownerKey]: label, [planKey]: plan } },
  }));
  const run = { label, plan, uid: lock.metadata.uid };
  if (process.env.AWAI_VKE_RUN_FILE) writeFileSync(process.env.AWAI_VKE_RUN_FILE, `${label}\n`, { mode: 0o600 });
  console.error(`Release run ${label}. If interrupted, inspect the recorded namespace before resuming.`);

  // Persist ownership before the POST so a lost response never starts another paid pool.
  try {
    await vultr.create(label, plan);
  } catch (error) {
    if ([400, 401, 403, 404, 422].includes(error.httpStatus)) {
      deleteLock(run.uid);
      throw error;
    }
    console.error(`Pool create response was ambiguous: ${error.message}`);
    await releaseOrReport(label, () => abortRun(label));
    throw error;
  }
  let succeeded = false;
  try {
    const worker = await wait(async () => {
      const matches = (await kube("get", "nodes", "-l", `${labelKey}=${label}`)).items;
      requireState(matches.length <= 1, "More than one node joined the dedicated pool.");
      return matches.find((node) => node.status.conditions.some(({ type, status }) => type === "Ready" && status === "True"));
    }, "The dedicated release node did not become Ready");
    const pool = (await vultr.list()).find((item) => item.label === label);
    requireState(pool?.tag === label && pool.plan === plan && pool.labels?.[purposeKey] === purposeValue &&
      worker.metadata.labels["vke.vultr.com/node-pool-id"] === pool.id &&
      worker.metadata.labels["node.kubernetes.io/instance-type"] === plan, "Unverified release node ownership.");
    call(["taint", "nodes", worker.metadata.name, `${taintKey}=release:NoSchedule`, "--overwrite"], null);
    requireState(!interrupted, `Interrupted by ${interrupted}`);

    const env = { ...process.env, KUBECONFIG: config, AWAI_VKE_NAMESPACE: namespace, AWAI_VKE_NODE_POOL: label };
    delete env.VULTR_API_KEY;
    const [command, ...commandArgs] = args.slice(1);
    succeeded = await runChild(command, commandArgs, env) && !interrupted;
    if (!succeeded) console.error(`The build/restore command failed or was interrupted. Releasing ${label}.`);
  } finally {
    // Always release: completed runs through the strict check, everything else
    // (failure, signal, verification error) through the idempotent abort.
    await releaseOrReport(label, async (attempt) => {
      if (succeeded && attempt === 1) {
        await teardown({ kube, vultr, run, wait, deleteLock });
        return { released: true, label };
      }
      return abortRun(label);
    });
  }
  requireState(succeeded, "The build/restore command failed; its pool was released.");
  console.log(`Release pool ${label} removed. Check the final line in Vultr Billing.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
