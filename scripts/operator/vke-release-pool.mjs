#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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

function requireState(ok, message) {
  if (!ok) throw new Error(message);
}

export async function teardown({ kube, vultr, run, wait, deleteLock, empty = false }) {
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
  requireState(!empty || matches.length === 1,
    "The empty release needs a provider pool. Investigate a missing or ambiguous create before removing the lock.");
  if (matches.length === 1) {
    const [pool] = matches;
    requireState(pool.plan === (run.plan ?? defaultPlan) && pool.tag === run.label,
      "The provider pool does not match the release owner and plan.");
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

function kubeClient(config) {
  const base = ["--kubeconfig", config, "--request-timeout=20s"];
  const env = { ...process.env };
  delete env.VULTR_API_KEY;
  return (args, output = "json", input) => {
    const result = spawnSync("kubectl", [...base, ...args, ...(output ? ["-o", output] : [])],
      { encoding: "utf8", env, input, timeout: 115_000, maxBuffer: 32 * 1024 * 1024 });
    requireState(!result.error && result.status === 0, `kubectl ${args.join(" ")} failed`);
    return output === "json" ? JSON.parse(result.stdout) : result.stdout.trim();
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
      await request(base, "POST", { label, tag: label, plan, node_quantity: 1, auto_scaler: false });
    },
    async remove(id) {
      await request(`${base}/${encodeURIComponent(id)}`, "DELETE");
    },
  };
}

async function wait(read, message) {
  const deadline = Date.now() + 15 * 60_000;
  do {
    const value = await read();
    if (value) return value;
    await delay(10_000);
  } while (Date.now() < deadline);
  throw new Error(message);
}

async function main([mode, kubeconfig, ...args]) {
  requireState(["status", "run", "release", "release-empty"].includes(mode) && kubeconfig &&
    (mode === "run" ? args.length > 1 && args[0] === "--" : args.length === 0),
  "Usage: vke-release-pool.mjs status|release|release-empty KUBECONFIG | run KUBECONFIG -- COMMAND [ARGS]");
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
  const pools = nodes.map((node) => node.metadata.labels?.[labelKey]).filter(Boolean);
  requireState(pools.includes("tatara-runners"), "The kubeconfig must target the Awai Tatara cluster.");
  if (mode === "status") {
    const lock = call(["get", "namespace", namespace, "--ignore-not-found"], "jsonpath={.metadata.annotations.awai\\.network/vke-run}");
    console.log(JSON.stringify({ cluster: match[1], pools, releaseRun: lock || null }));
    return;
  }
  requireState(process.env.VULTR_API_KEY, "Load VULTR_API_KEY from the authorized secret store.");
  const vultr = vultrClient(match[1], process.env.VULTR_API_KEY);
  if (mode === "release" || mode === "release-empty") {
    const lock = await kube("get", "namespace", namespace);
    const label = lock.metadata.annotations?.[ownerKey];
    requireState(/^awai-pc-release-[0-9a-f]{12}$/.test(label ?? ""), "No owned release pool is recorded.");
    const plan = lock.metadata.annotations?.[planKey] ?? defaultPlan;
    requireState(plans.has(plan), "The release plan is outside the supported VKE plans.");
    await teardown({ kube, vultr, wait, deleteLock, empty: mode === "release-empty", run: { label, plan, uid: lock.metadata.uid } });
    return;
  }

  requireState(!(await vultr.list()).some(({ label }) => label?.startsWith("awai-pc-release-")),
    "An existing release pool must be reconciled before starting a new run.");
  const plan = process.env.AWAI_VKE_RELEASE_PLAN ?? defaultPlan;
  requireState(plans.has(plan), "The release plan is outside the supported VKE plans.");
  const label = `awai-pc-release-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const lock = call(["create", "-f", "-"], "json", JSON.stringify({
    apiVersion: "v1", kind: "Namespace",
    metadata: { name: namespace, annotations: { [ownerKey]: label, [planKey]: plan } },
  }));
  const run = { label, plan, uid: lock.metadata.uid };
  console.error(`Release run ${label}. If interrupted, inspect the recorded namespace before resuming.`);

  // Persist ownership before the POST so a lost response never starts another paid pool.
  try {
    await vultr.create(label, plan);
  } catch (error) {
    if ([400, 401, 403, 404, 422].includes(error.httpStatus)) deleteLock(run.uid);
    throw error;
  }
  const worker = await wait(async () => {
    const matches = (await kube("get", "nodes", "-l", `${labelKey}=${label}`)).items;
    requireState(matches.length <= 1, "More than one node joined the dedicated pool.");
    return matches.find((node) => node.status.conditions.some(({ type, status }) => type === "Ready" && status === "True"));
  }, "The dedicated release node did not become Ready");
  const pool = (await vultr.list()).find((item) => item.label === label);
  requireState(pool?.tag === label && pool.plan === plan &&
    worker.metadata.labels["vke.vultr.com/node-pool-id"] === pool.id &&
    worker.metadata.labels["node.kubernetes.io/instance-type"] === plan, "Unverified release node ownership.");
  call(["taint", "nodes", worker.metadata.name, `${taintKey}=release:NoSchedule`], null);

  const env = { ...process.env, KUBECONFIG: config, AWAI_VKE_NAMESPACE: namespace, AWAI_VKE_NODE_POOL: label };
  delete env.VULTR_API_KEY;
  const [command, ...commandArgs] = args.slice(1);
  const result = spawnSync(command, commandArgs, { stdio: "inherit", env, timeout: 6 * 60 * 60_000 });
  requireState(!result.error && result.status === 0,
    "The build/restore command failed. The recorded pool was retained to preserve its workspace. Inspect it promptly.");
  await teardown({ kube, vultr, run, wait, deleteLock });
  console.log(`Release pool ${label} removed. Check the final line in Vultr Billing.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
