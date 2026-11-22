#!/usr/bin/env node
// build-reaper: deletes idle on-demand node pools (Awai PC release builds, Tatara
// APK burst lanes) from the Awai Tatara VKE cluster. It runs in-cluster on the tatara-system pool every 10 minutes so
// a paid pool is released even when the operator's worker died (SIGKILL, sleep).
//
// A pool is a candidate only when its Vultr node-pool labels include
// awai.network/reapable=true. Independently, a pool is never touched when it is
// named tatara-system or tatara-ci-runners-*, or when the pool or any of its
// nodes carries tatara.network/role. A candidate is deleted only after 30
// minutes with no active Job or Pod on or selecting it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const reapableKey = "awai.network/reapable";
export const tataraRoleKey = "tatara.network/role";
export const protectedName = /^(tatara-system|tatara-ci-runners-.*)$/;
export const idleMs = 30 * 60_000;
const poolIdLabel = "vke.vultr.com/node-pool-id";
const poolNameLabel = "vke.vultr.com/node-pool";
const finished = new Set(["Succeeded", "Failed"]);

const time = (value) => (value ? Date.parse(value) : Number.NaN);
const latest = (values) => Math.max(...values.filter(Number.isFinite));

// Cluster add-ons follow every node (Calico Typha is a Deployment with per-host
// anti-affinity), so they do not count as build activity.
const systemPods = /^(calico-node|calico-typha|csi-vultr-node|konnectivity-agent|kube-proxy|coredns)-/;

function isDaemon(pod) {
  return (pod.metadata.ownerReferences?.some(({ kind }) => kind === "DaemonSet") ?? false) ||
    (pod.metadata.namespace === "kube-system" && systemPods.test(pod.metadata.name ?? ""));
}

function selectsPool(spec, pool) {
  return spec?.nodeSelector?.[poolNameLabel] === pool.label || spec?.nodeSelector?.[poolIdLabel] === pool.id;
}

function jobDone(job) {
  return job.status?.conditions?.some(({ type, status }) => (type === "Complete" || type === "Failed") && status === "True");
}

// Pure decision function: returns one decision per Vultr pool.
export function plan({ pools, nodes, pods, jobs, now }) {
  return pools.map((pool) => {
    const base = { pool: pool.label, id: pool.id, plan: pool.plan };
    const poolNodes = nodes.filter((node) => node.metadata.labels?.[poolIdLabel] === pool.id);
    if (protectedName.test(pool.label ?? "") || /^tatara/i.test(pool.label ?? "") || pool.labels?.[tataraRoleKey] ||
        Object.values(pool.labels ?? {}).some((value) => protectedName.test(String(value))) ||
        poolNodes.some((node) => node.metadata.labels?.[tataraRoleKey])) {
      return { ...base, action: "protect", reason: "Tatara pool" };
    }
    if (pool.labels?.[reapableKey] !== "true") {
      return { ...base, action: "ignore", reason: `not labelled ${reapableKey}=true` };
    }
    const nodeNames = new Set(poolNodes.map((node) => node.metadata.name));
    const poolPods = pods.filter((pod) => !isDaemon(pod) &&
      (nodeNames.has(pod.spec?.nodeName) || selectsPool(pod.spec, pool)));
    const poolJobs = jobs.filter((job) => selectsPool(job.spec?.template?.spec, pool));
    const activePods = poolPods.filter((pod) => !finished.has(pod.status?.phase));
    const activeJobs = poolJobs.filter((job) => !jobDone(job));
    if (activePods.length || activeJobs.length) {
      return { ...base, action: "keep", reason: "active build", pods: activePods.length, jobs: activeJobs.length };
    }
    const last = latest([
      time(pool.date_created), time(pool.date_updated),
      ...poolNodes.map((node) => time(node.metadata.creationTimestamp)),
      ...poolPods.flatMap((pod) => [time(pod.status?.startTime),
        ...(pod.status?.containerStatuses ?? []).map((status) => time(status.state?.terminated?.finishedAt))]),
      ...poolJobs.flatMap((job) => [time(job.status?.startTime), time(job.status?.completionTime),
        ...(job.status?.conditions ?? []).map((condition) => time(condition.lastTransitionTime))]),
    ]);
    if (!Number.isFinite(last)) return { ...base, action: "keep", reason: "no activity timestamp" };
    const idleFor = now - last;
    return { ...base, action: idleFor >= idleMs ? "delete" : "keep",
      reason: idleFor >= idleMs ? "idle" : "idle, within grace", idleMinutes: Math.floor(idleFor / 60_000) };
  });
}

// The reaper key must be limited to VKE. A key that can also read instances or
// billing could do far more damage than deleting one idle pool, so refuse to run.
export const scopeProbes = ["/v2/instances?per_page=1", "/v2/billing/history?per_page=1"];

export async function checkKeyScope(probe) {
  const broad = [];
  for (const path of scopeProbes) {
    const status = await probe(path);
    if (status !== 401 && status !== 403) broad.push({ path: path.split("?")[0], status });
  }
  if (broad.length) {
    throw Object.assign(new Error("REFUSING TO RUN: the Vultr key reaches beyond VKE. Replace it with a [vke]-only sub-user key."),
      { event: "key-too-broad", broad });
  }
}

export async function reap({ vultr, kube, now = Date.now(), dryRun, log }) {
  await checkKeyScope(vultr.probe);
  const pools = await vultr.list();
  const [nodes, pods, jobs] = await Promise.all([kube("/api/v1/nodes"), kube("/api/v1/pods"), kube("/apis/batch/v1/jobs")]);
  const decisions = plan({ pools, nodes, pods, jobs, now });
  for (const decision of decisions) {
    if (decision.action !== "delete") {
      log({ event: "skip", ...decision });
      continue;
    }
    if (dryRun) {
      log({ event: "would-delete", dryRun: true, ...decision });
      continue;
    }
    // Re-read the single pool right before deleting so a pool that changed
    // ownership markers in the meantime is never removed.
    const current = (await vultr.list()).find((pool) => pool.id === decision.id);
    const recheck = current && plan({ pools: [current], nodes, pods, jobs, now })[0];
    if (recheck?.action !== "delete") {
      log({ event: "skip", ...decision, reason: "changed before delete" });
      continue;
    }
    await vultr.remove(decision.id);
    log({ event: "deleted", ...decision });
  }
  return decisions;
}

function vultrClient(cluster, key) {
  const base = `https://api.vultr.com/v2/kubernetes/clusters/${encodeURIComponent(cluster)}/node-pools`;
  async function request(url, method = "GET") {
    const response = await fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${key}` } });
    if (method === "DELETE" && response.status === 404) return null;
    if (!response.ok) throw new Error(`Vultr ${method} returned HTTP ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    async list() {
      const result = await request(`${base}?per_page=500`);
      if (!Array.isArray(result?.node_pools) || result.meta?.links?.next) {
        throw new Error("Vultr did not return a complete node-pool inventory.");
      }
      return result.node_pools;
    },
    remove: (id) => request(`${base}/${encodeURIComponent(id)}`, "DELETE"),
    async probe(path) {
      const response = await fetch(`https://api.vultr.com${path}`, { redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${key}` } });
      await response.body?.cancel();
      return response.status;
    },
  };
}

function kubeClient() {
  const root = "/var/run/secrets/kubernetes.io/serviceaccount";
  const token = readFileSync(`${root}/token`, "utf8").trim();
  const server = `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`;
  const get = async (path) => {
    const response = await fetch(`${server}${path}?limit=5000`, { redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Kubernetes GET ${path} returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.metadata?.continue) throw new Error(`Kubernetes ${path} inventory is incomplete.`);
    return body.items;
  };
  // Heartbeat: one ConfigMap the coordinator's health check can read.
  get.heartbeat = async (data) => {
    const response = await fetch(`${server}/api/v1/namespaces/build-reaper/configmaps/build-reaper-heartbeat`, {
      method: "PATCH", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/merge-patch+json" },
      body: JSON.stringify({ data }),
    });
    if (!response.ok) throw new Error(`Heartbeat PATCH returned HTTP ${response.status}`);
  };
  return get;
}

export function heartbeatData({ started, decisions, error, dryRun }) {
  return {
    lastRun: new Date(started).toISOString(),
    result: error ? "error" : "ok",
    dryRun: String(Boolean(dryRun)),
    error: error ? String(error.event ?? "error") + ": " + error.message : "",
    pools: String(decisions?.length ?? 0),
    deleted: (decisions ?? []).filter(({ action }) => action === "delete").map(({ pool }) => pool).join(","),
  };
}

async function main() {
  const { VULTR_API_KEY: key, VKE_CLUSTER_ID: cluster } = process.env;
  if (!key || !/^[a-f0-9-]{36}$/.test(cluster ?? "")) throw new Error("VULTR_API_KEY and VKE_CLUSTER_ID are required.");
  const dryRun = process.env.REAPER_DRY_RUN === "1" || process.argv.includes("--dry-run");
  const log = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));
  const kube = kubeClient();
  const started = Date.now();
  let decisions;
  let failure;
  try {
    decisions = await reap({ vultr: vultrClient(cluster, key), kube, dryRun, log });
  } catch (error) {
    failure = error;
  }
  try {
    await kube.heartbeat(heartbeatData({ started, decisions, error: failure, dryRun }));
  } catch (error) {
    log({ event: "heartbeat-failed", message: error.message });
  }
  if (failure) throw failure;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ time: new Date().toISOString(), event: error.event ?? "error", message: error.message,
      ...(error.broad ? { broad: error.broad } : {}) }));
    process.exitCode = 1;
  });
}
