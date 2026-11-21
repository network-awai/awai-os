import assert from "node:assert/strict";
import test from "node:test";
import { teardown } from "./vke-release-pool.mjs";

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
