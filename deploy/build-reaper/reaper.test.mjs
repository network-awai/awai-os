import assert from "node:assert/strict";
import test from "node:test";
import { checkKeyScope, heartbeatData, idleMs, plan, reap } from "./reaper.mjs";

const now = Date.parse("2026-11-22T12:00:00Z");
const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();

// Shapes copied from the live awai-tatara-ci inventory on 2026-11-22.
const tataraSystem = { id: "09294d99-403b-4473-bbfe-d186674fd90d", label: "tatara-system", tag: "awai-3799",
  plan: "vc2-2c-4gb", labels: { "tatara.network/role": "system" }, date_created: ago(600), date_updated: ago(600) };
const tataraRunners = { id: "4d93bbd3-1111-4236-ac8c-8d59a0ca5675", label: "tatara-ci-runners-1c", tag: "awai-3799",
  plan: "vc2-1c-2gb", labels: { "tatara.network/role": "runner" }, date_created: ago(600), date_updated: ago(600) };
const release = { id: "11111111-2222-3333-4444-555555555555", label: "awai-pc-release-90e9e16ad5e1",
  tag: "awai-pc-release-90e9e16ad5e1", plan: "vc2-16c-64gb", labels: { "awai.network/purpose": "release-build", "awai.network/reapable": "true" },
  date_created: ago(600), date_updated: ago(600) };

const node = (pool, name, created = ago(590), labels = {}) => ({
  metadata: { name, creationTimestamp: created,
    labels: { "vke.vultr.com/node-pool": pool.label, "vke.vultr.com/node-pool-id": pool.id, ...labels } },
});
const nodes = [
  node(tataraSystem, "tatara-system-4d59ba9f42db", ago(600), { "tatara.network/role": "system" }),
  node(tataraRunners, "tatara-ci-runners-1c-b8cd56c43e08", ago(600), { "tatara.network/role": "runner" }),
  node(release, "release-node"),
];
// Idle Tatara pools: no workload at all for hours. They must still never be deleted.
const systemPods = [
  { metadata: { namespace: "kube-system", name: "calico-typha-abc12" }, spec: { nodeName: "release-node" }, status: { phase: "Running" } },
  { metadata: { namespace: "kube-system", name: "calico-node-x", ownerReferences: [{ kind: "DaemonSet" }] },
    spec: { nodeName: "release-node" }, status: { phase: "Running" } },
];
const buildJob = (status) => ({ metadata: { namespace: "awai-pc-release-build", name: "awai-pc-release-build" },
  spec: { template: { spec: { nodeSelector: { "vke.vultr.com/node-pool": release.label } } } }, status });

function harness(pools, { pods = systemPods, jobs = [] } = {}) {
  const removed = [];
  const logs = [];
  const vultr = { list: async () => pools.filter((pool) => !removed.includes(pool.id)), remove: async (id) => { removed.push(id); },
    probe: async () => 403 };
  const kube = async (path) => ({ "/api/v1/nodes": nodes, "/api/v1/pods": pods, "/apis/batch/v1/jobs": jobs })[path];
  return { vultr, kube, removed, logs, log: (entry) => logs.push(entry) };
}

test("deletes the idle release pool left by the 90e9e16ad5e1 incident", async () => {
  const h = harness([tataraSystem, tataraRunners, release]);
  await reap({ ...h, now });
  assert.deepEqual(h.removed, [release.id]);
  assert.deepEqual(h.logs.filter(({ event }) => event === "deleted").map(({ pool }) => pool), [release.label]);
});

test("dry run logs the deletion and removes nothing", async () => {
  const h = harness([tataraSystem, tataraRunners, release]);
  await reap({ ...h, now, dryRun: true });
  assert.deepEqual(h.removed, []);
  assert.deepEqual(h.logs.filter(({ event }) => event === "would-delete").map(({ pool }) => pool), [release.label]);
});

test("never touches Tatara pools, even idle, relabelled or mistakenly marked reapable", async () => {
  const reapable = { "awai.network/reapable": "true" };
  const impostors = [
    tataraSystem,
    tataraRunners,
    { ...tataraSystem, labels: { ...tataraSystem.labels, ...reapable } },
    { ...tataraRunners, id: "bbbbbbbb-0000-0000-0000-000000000002", labels: reapable },
    { ...tataraRunners, id: "cccccccc-0000-0000-0000-000000000003", label: "tatara-ci-runners-4c", labels: reapable },
    // A release-shaped name on a pool that still carries the Tatara role.
    { ...tataraSystem, id: "aaaaaaaa-0000-0000-0000-000000000001", label: "awai-pc-release-aaaaaaaaaaaa",
      tag: "awai-pc-release-aaaaaaaaaaaa", labels: { "tatara.network/role": "system", ...reapable } },
    // A renamed Tatara pool whose nodes still carry the role label.
    { ...tataraRunners, label: "renamed-runners", labels: reapable },
  ];
  const h = harness(impostors, { pods: [] });
  const decisions = await reap({ ...h, now: now + 100 * idleMs });
  assert.deepEqual(h.removed, []);
  assert.ok(decisions.every(({ action }) => action === "protect" || action === "ignore"), JSON.stringify(decisions));
  assert.equal(decisions.filter(({ action }) => action === "protect").length, impostors.length);
});

test("ignores pools without awai.network/reapable=true", () => {
  const variants = [
    { ...release, labels: {} },
    { ...release, labels: { "awai.network/purpose": "release-build" } },
    { ...release, labels: { "awai.network/reapable": "yes" } },
    { ...release, id: "x", label: "cs-deep-runner-20261119", tag: "", labels: undefined },
  ];
  for (const pool of variants) {
    assert.equal(plan({ pools: [pool], nodes, pods: [], jobs: [], now })[0].action, "ignore", JSON.stringify(pool));
  }
});

test("keeps a pool with a running or pending build Job or Pod", () => {
  const running = { metadata: { namespace: "awai-pc-release-build", name: "awai-pc-release-build-2rnp9" },
    spec: { nodeName: "release-node" }, status: { phase: "Running", startTime: ago(400) } };
  const pending = { metadata: { namespace: "awai-pc-release-build", name: "awai-pc-release-restore-x" },
    spec: { nodeSelector: { "vke.vultr.com/node-pool": release.label } }, status: { phase: "Pending" } };
  for (const extra of [{ pods: [running] }, { pods: [pending] }, { jobs: [buildJob({ active: 1, startTime: ago(400) })] }]) {
    const [decision] = plan({ pools: [release], nodes, pods: [...systemPods, ...(extra.pods ?? [])], jobs: extra.jobs ?? [], now });
    assert.equal(decision.action, "keep");
  }
});

test("waits 30 minutes after the last build activity", () => {
  const recent = buildJob({ startTime: ago(400), completionTime: ago(29),
    conditions: [{ type: "Complete", status: "True", lastTransitionTime: ago(29) }] });
  assert.equal(plan({ pools: [release], nodes, pods: systemPods, jobs: [recent], now })[0].action, "keep");
  const old = buildJob({ startTime: ago(400), completionTime: ago(31),
    conditions: [{ type: "Failed", status: "True", lastTransitionTime: ago(31) }] });
  assert.equal(plan({ pools: [release], nodes, pods: systemPods, jobs: [old], now })[0].action, "delete");
  // A freshly created pool whose node is still joining is within its grace period.
  const fresh = { ...release, date_created: ago(5), date_updated: ago(5) };
  assert.equal(plan({ pools: [fresh], nodes: [], pods: [], jobs: [], now })[0].action, "keep");
});

test("skips a pool whose markers changed between planning and deletion", async () => {
  const pools = [release];
  const h = harness(pools);
  const list = h.vultr.list;
  let calls = 0;
  h.vultr.list = async () => (++calls === 1 ? list() : [{ ...release, labels: { "tatara.network/role": "system" } }]);
  await reap({ ...h, now });
  assert.deepEqual(h.removed, []);
});

test("reaps an APK burst pool that carries only the reapable label", async () => {
  const apk = { id: "dddddddd-0000-0000-0000-000000000004", label: "tatara-apk-burst-01".replace("tatara-", "apk-"),
    tag: "awai-3834", plan: "vc2-8c-32gb", labels: { "awai.network/reapable": "true" }, date_created: ago(120), date_updated: ago(120) };
  const h = harness([tataraSystem, tataraRunners, apk]);
  await reap({ ...h, now });
  assert.deepEqual(h.removed, [apk.id]);
});

test("refuses to run, deleting nothing, when the key reaches beyond VKE", async () => {
  const h = harness([tataraSystem, tataraRunners, release]);
  h.vultr.probe = async (path) => (path.startsWith("/v2/instances") ? 200 : 403);
  await assert.rejects(reap({ ...h, now }), (error) => error.event === "key-too-broad" && /REFUSING/.test(error.message));
  assert.deepEqual(h.removed, []);
  await checkKeyScope(async () => 401);
});

test("heartbeat records the run time, result and deleted pools without secrets", () => {
  const started = Date.parse("2026-11-22T12:00:00Z");
  const ok = heartbeatData({ started, decisions: [{ pool: release.label, action: "delete" }, { pool: "tatara-system", action: "protect" }] });
  assert.deepEqual(ok, { lastRun: "2026-11-22T12:00:00.000Z", result: "ok", dryRun: "false", error: "", pools: "2", deleted: release.label });
  const failed = heartbeatData({ started, error: Object.assign(new Error("REFUSING TO RUN"), { event: "key-too-broad" }) });
  assert.equal(failed.result, "error");
  assert.equal(failed.error, "key-too-broad: REFUSING TO RUN");
});
