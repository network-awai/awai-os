import assert from "node:assert/strict";
import test from "node:test";
import { abort, releaseWithRetry, requireTataraCluster, tataraRoles, teardown } from "./vke-release-pool.mjs";
import { secretManifest } from "./release-artifacts-secret.mjs";

const label = "awai-pc-release-012345abcdef";
const namespace = "awai-pc-release-build";
const run = { label, uid: "namespace-uid" };
const providerPool = { label, id: "dedicated-pool-id", tag: label, plan: "voc-m-16c-128gb-800s-amd" };
const build = {
  metadata: { name: "awai-pc-release-build" },
  spec: { template: { spec: { nodeSelector: { "vke.vultr.com/node-pool": label } } } },
  status: { conditions: [{ type: "Complete", status: "True" }] },
};
const restore = { ...build, metadata: { name: "awai-pc-release-restore" } };

function fixture({ jobs = [build, restore], pods = [], pvc = [], uid = run.uid, pool = providerPool } = {}) {
  const operations = [];
  let removed = !pool;
  const kube = async (...args) => {
    switch (args.join(" ")) {
      case `get namespace ${namespace}`: return { metadata: { uid, annotations: { "awai.network/vke-run": label } } };
      case `-n ${namespace} get jobs`: return { items: jobs };
      case `get nodes -l vke.vultr.com/node-pool=${label}`: return {
        items: removed ? [] : [{ metadata: { name: "release-node", labels: { "vke.vultr.com/node-pool-id": providerPool.id } } }],
      };
      case "get pods -A": return { items: pods };
      case `-n ${namespace} get pvc`: return { items: pvc };
      default: throw new Error(`Unexpected kubectl arguments: ${args.join(" ")}`);
    }
  };
  const vultr = {
    list: async () => removed ? [] : [pool],
    remove: async (id) => { operations.push(["pool", id]); removed = true; },
  };
  const wait = async (check) => assert.equal(await check(), true);
  const deleteLock = async (uid) => operations.push(["namespace", uid]);
  return { options: { kube, vultr, run, wait, deleteLock }, operations };
}

test("releases only the owned pool and clears the lock by UID after readback", async () => {
  const { options, operations } = fixture();
  await teardown(options);
  assert.deepEqual(operations, [["pool", providerPool.id], ["namespace", run.uid]]);
});

test("resumes teardown after a previously successful provider deletion", async () => {
  const { options, operations } = fixture({ pool: null });
  await teardown(options);
  assert.deepEqual(operations, [["namespace", run.uid]]);
});

test("reconciles a timed-out deletion against Vultr and Kubernetes", async () => {
  const { options, operations } = fixture();
  const remove = options.vultr.remove;
  options.vultr.remove = async (id) => {
    await remove(id);
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  await teardown({ ...options });
  assert.deepEqual(operations, [["pool", providerPool.id], ["namespace", run.uid]]);
});

test("leaves the pool when the restore receipt Job is missing", async () => {
  const { options, operations } = fixture({ jobs: [build] });
  await assert.rejects(teardown(options), /restore Jobs/);
  assert.deepEqual(operations, []);
});

test("refuses an active worker, unexpected node workload, or persistent volume", async () => {
  for (const overrides of [
    { pods: [{ metadata: { namespace, name: "worker" }, spec: {}, status: { phase: "Pending" } }] },
    { pods: [{ metadata: { namespace: "unrelated", name: "worker" }, spec: { nodeName: "release-node" } }] },
    { pvc: [{}] },
  ]) {
    const { options, operations } = fixture(overrides);
    await assert.rejects(teardown(options));
    assert.deepEqual(operations, []);
  }
});

test("refuses a different namespace UID or provider ownership tag", async () => {
  for (const overrides of [{ uid: "replacement" }, { pool: { ...providerPool, tag: "other-run" } }]) {
    const { options, operations } = fixture(overrides);
    await assert.rejects(teardown(options));
    assert.deepEqual(operations, []);
  }
});

test("an explicit empty release can remove a provisioned pool before jobs start", async () => {
  const { options, operations } = fixture({ jobs: [] });
  await teardown({ ...options, empty: true });
  assert.deepEqual(operations, [["pool", providerPool.id], ["namespace", run.uid]]);
});

test("an ambiguous create retains the lock", async () => {
  const { options, operations } = fixture({ jobs: [], pool: null });
  await assert.rejects(teardown({ ...options, empty: true }), /ambiguous create/);
  assert.deepEqual(operations, []);
});

test("releases the alternative plan only when the run recorded that plan", async () => {
  const alternative = { ...providerPool, plan: "vc2-16c-64gb" };
  const { options, operations } = fixture({ pool: alternative });
  await assert.rejects(teardown(options), /provider pool/);
  await teardown({ ...options, run: { ...run, plan: alternative.plan } });
  assert.deepEqual(operations, [["pool", providerPool.id], ["namespace", run.uid]]);
});

test("identifies the Tatara cluster by node role labels, not pool names", () => {
  const live = [
    { metadata: { labels: { "vke.vultr.com/node-pool": "tatara-ci-runners-1c", "tatara.network/role": "runner" } } },
    { metadata: { labels: { "vke.vultr.com/node-pool": "tatara-system", "tatara.network/role": "system" } } },
  ];
  assert.deepEqual(tataraRoles(live), ["runner", "system"]);
  requireTataraCluster(live);
  const renamed = live.map((node) => ({ metadata: { labels: { ...node.metadata.labels, "vke.vultr.com/node-pool": "x" } } }));
  requireTataraCluster(renamed);
  assert.throws(() => requireTataraCluster([{ metadata: { labels: { "vke.vultr.com/node-pool": "tatara-runners" } } }]),
    /tatara.network\/role=system/);
});

function abortFixture({ lock = true, pool = providerPool, pods = [] } = {}) {
  const { options, operations } = fixture({ jobs: [], pool });
  let podItems = pods;
  const kube = options.kube;
  options.kube = async (...args) => args.join(" ") === `-n ${namespace} get pods` ? { items: podItems } : kube(...args);
  const getLock = async () => lock ? { metadata: { uid: run.uid, annotations: { "awai.network/vke-run": label } } } : null;
  const deleteJobs = async () => { operations.push(["jobs"]); podItems = []; };
  return { options: { ...options, getLock, deleteJobs }, operations };
}

test("abort deletes the Jobs, then the owned pool, then the lock", async () => {
  const worker = { metadata: { namespace, name: "awai-pc-release-build-2rnp9" }, spec: { nodeName: "release-node" }, status: { phase: "Running" } };
  const { options, operations } = abortFixture({ pods: [worker] });
  assert.deepEqual(await abort(options), { released: true, label });
  assert.deepEqual(operations, [["jobs"], ["pool", providerPool.id], ["namespace", run.uid]]);
});

test("abort is idempotent: no lock means nothing to release", async () => {
  const { options, operations } = abortFixture({ lock: false });
  assert.equal((await abort(options)).released, false);
  assert.deepEqual(operations, []);
});

test("abort never releases a different run than the caller owns", async () => {
  const { options, operations } = abortFixture();
  assert.equal((await abort({ ...options, expect: "awai-pc-release-ffffffffffff" })).released, false);
  assert.deepEqual(operations, []);
});

test("abort clears the lock when the pool was already removed (reaper or earlier release)", async () => {
  let settled = 0;
  const { options, operations } = abortFixture({ pool: null });
  await abort({ ...options, settle: async () => { settled += 1; } });
  assert.equal(settled, 1);
  assert.deepEqual(operations, [["jobs"], ["namespace", run.uid]]);
});

test("teardown refuses a pool carrying a Tatara role label", async () => {
  const { options, operations } = fixture({ pool: { ...providerPool, labels: { "tatara.network/role": "system" } } });
  await assert.rejects(teardown(options), /Tatara pool/);
  assert.deepEqual(operations, []);
});

test("release retries and then reports the last failure", async () => {
  const messages = [];
  let calls = 0;
  await assert.rejects(releaseWithRetry(async () => { calls += 1; throw new Error(`boom ${calls}`); },
    { pause: async () => {}, log: (line) => messages.push(line) }), /boom 3/);
  assert.equal(calls, 3);
  assert.equal(messages.length, 3);
  assert.equal(await releaseWithRetry(async (n) => (n < 2 ? Promise.reject(new Error("x")) : "ok"),
    { pause: async () => {}, log: () => {} }), "ok");
});

test("the B2 Secret manifest carries the key only in stringData and rejects malformed input", () => {
  const keyId = "0051234567890ab0000000042";
  const appKey = "K005abcdefghijklmnopqrstuvwxyz0";
  const secret = secretManifest("awai-pc-release-build", "release-artifacts-b2", `${keyId}:${appKey}\n`);
  assert.deepEqual(secret.stringData, { RCLONE_CONFIG_ART_TYPE: "b2", RCLONE_CONFIG_ART_ACCOUNT: keyId, RCLONE_CONFIG_ART_KEY: appKey });
  assert.throws(() => secretManifest("n", "s", "not a key"), (error) => !error.message.includes("not a key"));
});
