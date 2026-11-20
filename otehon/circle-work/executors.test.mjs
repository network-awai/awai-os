import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sha, verifyPins} from './common.mjs';
import {resolveMuseBinary, installExecutor, volatilePath, etcdctlPath, assertDurableLedgerClient, health} from './executors.mjs';

// Fixtures go under the user's home, not .agent-output or the OS temp directory:
// those are exactly the places the durable-path check rejects.
const fixture = async () => { const d = path.join(process.env.HOME, '.cache', 'awai-circle-work-test', randomUUID()); await fs.mkdir(d, {recursive: true}); return d; };

// A launcher installation as the Muse updater lays it out.
async function museInstall(dir, version, body) {
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, 'muse'), '#!/bin/sh\n# launcher 3\n', {mode: 0o755});
  await fs.writeFile(path.join(dir, '.muse-version'), version + '\n');
  await fs.writeFile(path.join(dir, 'muse-bin-' + version), body, {mode: 0o755});
}

test('the pin follows the binary that runs, and survives a launcher and binary update', async () => {
  const root = await fixture(), bin = path.join(root, 'bin'), state = path.join(root, 'state');
  try {
    await museInstall(bin, '1.0.0-R1', 'approved binary');
    const orca = path.join(bin, 'orca'); await fs.writeFile(orca, 'orca wrapper');
    const binary = await resolveMuseBinary(path.join(bin, 'muse'));
    assert.equal(path.basename(binary), 'muse-bin-1.0.0-R1');
    const muse = await installExecutor(state, 'muse', binary, sha('approved binary'));
    assert.equal(path.dirname(muse.path), path.join(state, 'executors'));
    const cfg = {codePins: [], muse: muse.path, museSha256: muse.sha256, orca, orcaSha256: sha('orca wrapper')};
    await verifyPins(cfg);

    // The updater rewrites the launcher, installs a new binary and removes the old one.
    await fs.writeFile(path.join(bin, 'muse'), '#!/bin/sh\n# launcher 4\n');
    await fs.writeFile(path.join(bin, '.muse-version'), '1.0.1-R2\n');
    await fs.writeFile(path.join(bin, 'muse-bin-1.0.1-R2'), 'unreviewed binary');
    await fs.unlink(path.join(bin, 'muse-bin-1.0.0-R1'));
    await verifyPins(cfg);
    assert.equal(await fs.readFile(muse.path, 'utf8'), 'approved binary');

    // Negative controls: the updated binary is not adopted, and a changed copy stops the controller.
    await assert.rejects(installExecutor(state, 'muse', await resolveMuseBinary(path.join(bin, 'muse')), muse.sha256), /not the approved binary/);
    await assert.rejects(verifyPins({...cfg, muse: path.join(bin, 'muse')}), /executor pin mismatch/);
    await fs.chmod(muse.path, 0o700); await fs.writeFile(muse.path, 'tampered');
    await assert.rejects(verifyPins(cfg), /executor pin mismatch/);
    await assert.rejects(installExecutor(state, 'muse', muse.path, muse.sha256), /not the approved binary/);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test('an approval is required, and an existing copy that differs is preserved', async () => {
  const root = await fixture();
  try {
    const src = path.join(root, 'tool'); await fs.writeFile(src, 'tool bytes');
    await assert.rejects(installExecutor(root, 'tool', src, undefined), /approved executor digest required/);
    const a = await installExecutor(root, 'tool', src, sha('tool bytes')), b = await installExecutor(root, 'tool', src, sha('tool bytes'));
    assert.equal(a.path, b.path);
    await fs.chmod(a.path, 0o700); await fs.writeFile(a.path, 'changed');
    await assert.rejects(installExecutor(root, 'tool', src, sha('tool bytes')), /preserve and reconcile/);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test('a ledger client whose etcdctl sits in task output or is missing is refused', async () => {
  const root = await fixture();
  try {
    assert.equal(volatilePath('/Users/x/github/wt/codex/task/.agent-output/etcd-package/etcdctl'), 'task-output');
    assert.equal(volatilePath('/private/tmp/etcdctl'), 'temporary');
    assert.equal(volatilePath('/Users/x/.itonami/control-plane/etcd/awai-circle-goals-v1/bin/etcdctl'), null);
    const edn = p => `{:endpoints ["https://127.0.0.1:1"] :etcdctl ${JSON.stringify(p)} :etcdctl-sha256 "${'a'.repeat(64)}"}`;
    assert.equal(etcdctlPath(edn('/a b/etcdctl')), '/a b/etcdctl');
    assert.throws(() => etcdctlPath('{:endpoints []}'), /no etcdctl path/);
    const client = path.join(root, 'client.edn'), good = path.join(root, 'bin', 'etcdctl');
    await fs.writeFile(client, edn(path.join(root, '.agent-output', 'etcd-package', 'etcdctl')));
    await assert.rejects(assertDurableLedgerClient(client), /task-output path/);
    await fs.writeFile(client, edn(good));
    await assert.rejects(assertDurableLedgerClient(client), /etcdctl is missing/);
    await fs.mkdir(path.dirname(good)); await fs.writeFile(good, 'etcdctl');
    assert.equal(await assertDurableLedgerClient(client), good);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test('health reports a hold with its reason and duration, and unknown instead of zero', async () => {
  const root = await fixture(), now = Date.parse('2026-11-18T10:00:00Z');
  try {
    const empty = await health(root, now);
    assert.equal(empty.state, 'unknown'); assert.equal(empty.receipts24h, 'unknown'); assert.equal(empty.lastReceiptAt, 'unknown'); assert.equal(empty.heldHours, null);

    await fs.writeFile(path.join(root, 'controller-cycle.json'), JSON.stringify({state: 'held', at: '2026-11-18T09:59:00Z', reason: 'executor pin mismatch'}));
    await fs.writeFile(path.join(root, 'last-tick.json'), JSON.stringify({at: '2026-11-17T04:00:00Z', results: []}));
    for (const [id, at] of [['old', '2026-11-17T00:28:00Z'], ['recent', '2026-11-18T09:00:00Z'], ['bad', 'not a time']]) {
      await fs.mkdir(path.join(root, 'runs', id), {recursive: true});
      await fs.writeFile(path.join(root, 'runs', id, 'receipt.json'), JSON.stringify({state: 'completed', completedAt: at}));
    }
    await fs.mkdir(path.join(root, 'runs', 'no-receipt'));
    const held = await health(root, now);
    assert.equal(held.state, 'held'); assert.equal(held.reason, 'executor pin mismatch'); assert.equal(held.heldHours, 30);
    assert.equal(held.receipts24h, 1); assert.equal(held.lastReceiptAt, '2026-11-18T09:00:00.000Z'); assert.equal(held.receiptCoverage, 'partial');

    await fs.writeFile(path.join(root, 'controller-cycle.json'), JSON.stringify({state: 'healthy', at: '2026-11-18T09:59:00Z'}));
    const ok = await health(root, now);
    assert.equal(ok.state, 'healthy'); assert.equal(ok.reason, null); assert.equal(ok.heldHours, null);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});
