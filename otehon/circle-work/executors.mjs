// Executor placement and controller health for the Circle Goal controller (AWAI-3494).
//
// The controller stopped for 30 hours on 2026-11-17 for two reasons: its Muse pin
// covered a launcher that updates itself, and its ledger client pointed at an
// etcdctl inside a task worktree's .agent-output that was later removed. Runtime
// binaries now live under the controller's own state root and the pin covers the
// binary that actually runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {sha} from './common.mjs';

const exists = async p => { try { return (await fs.stat(p)).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

// The Muse launcher keeps the active version in `.muse-version` next to itself and
// execs `muse-bin-<version>`. Given the launcher, return that binary; given a
// binary, return it unchanged.
export async function resolveMuseBinary(given) {
  const dir = path.dirname(given);
  let version;
  try { version = (await fs.readFile(path.join(dir, '.muse-version'), 'utf8')).trim(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; return given; }
  if (!/^[0-9A-Za-z.-]{1,64}$/.test(version)) throw Error('muse version marker is not a version');
  const binary = path.join(dir, 'muse-bin-' + version);
  if (path.basename(given).startsWith('muse-bin-')) return given;
  if (!(await exists(binary))) throw Error('muse launcher has no active binary');
  return binary;
}

// Copy an approved binary into STATE_ROOT/executors under a name that carries its
// digest. `approvedSha256` is the operator's approval: a different binary is refused.
export async function installExecutor(stateRoot, name, source, approvedSha256) {
  if (!/^[a-z0-9-]{1,32}$/.test(name)) throw Error('executor name');
  if (!/^[a-f0-9]{64}$/.test(approvedSha256 ?? '')) throw Error('approved executor digest required');
  const bytes = await fs.readFile(source);
  if (sha(bytes) !== approvedSha256) throw Error('executor is not the approved binary: ' + name);
  const dir = path.join(stateRoot, 'executors');
  await fs.mkdir(dir, {recursive: true, mode: 0o700});
  const target = path.join(dir, name + '-' + approvedSha256.slice(0, 16));
  if (await exists(target)) {
    if (sha(await fs.readFile(target)) !== approvedSha256) throw Error('existing executor copy differs; preserve and reconcile');
  } else {
    const tmp = target + '.' + process.pid + '.pending';
    await fs.writeFile(tmp, bytes, {mode: 0o500, flag: 'wx'});
    await fs.rename(tmp, target);
  }
  return {path: target, sha256: approvedSha256};
}

// A path the controller depends on at run time must not sit where task cleanup or
// the OS removes files.
export function volatilePath(p) {
  const parts = path.resolve(p).split(path.sep);
  if (parts.includes('.agent-output')) return 'task-output';
  const tmp = [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].map(t => path.resolve(t));
  if (tmp.some(t => path.resolve(p) === t || path.resolve(p).startsWith(t + path.sep))) return 'temporary';
  return null;
}

// The ledger client configuration is EDN read by control.clj. Only the etcdctl
// path is needed here, so no EDN reader is pulled in.
export function etcdctlPath(ednText) {
  const m = /:etcdctl\s+"((?:[^"\\]|\\.)*)"/.exec(ednText);
  if (!m) throw Error('ledger client has no etcdctl path');
  return JSON.parse('"' + m[1] + '"');
}

export async function assertDurableLedgerClient(file) {
  const p = etcdctlPath(await fs.readFile(file, 'utf8')), why = volatilePath(p);
  if (why) throw Error('ledger client etcdctl is in a ' + why + ' path; copy it beside the client configuration');
  if (!(await exists(p))) throw Error('ledger client etcdctl is missing');
  return p;
}

// One line for the daily check. Counts and times come from the controller's own
// files; a value that cannot be read is 'unknown', never 0.
export async function health(stateRoot, now = Date.now()) {
  const json = async f => { try { return JSON.parse(await fs.readFile(path.join(stateRoot, f), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const cycle = await json('controller-cycle.json'), tick = await json('last-tick.json');
  const state = cycle?.state ?? 'unknown', observedAt = cycle?.at ?? 'unknown';
  // last-tick.json is written only after the pins verified, so while the controller
  // is held it marks when it last worked.
  const lastTickAt = tick?.at ?? 'unknown';
  const hours = (a, b) => Number.isFinite(Date.parse(a)) ? Math.round((b - Date.parse(a)) / 360000) / 10 : 'unknown';
  let receipts24h = 0, lastReceiptAt = null, receiptCoverage = 'complete';
  try {
    for (const run of await fs.readdir(path.join(stateRoot, 'runs'))) {
      let r;
      try { r = JSON.parse(await fs.readFile(path.join(stateRoot, 'runs', run, 'receipt.json'), 'utf8')); }
      catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') continue; receiptCoverage = 'partial'; continue; }
      const at = Date.parse((r.payload ?? r).completedAt);
      if (!Number.isFinite(at)) { receiptCoverage = 'partial'; continue; }
      if (now - at <= 86400000 && at <= now) receipts24h++;
      if (lastReceiptAt === null || at > lastReceiptAt) lastReceiptAt = at;
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; receipts24h = 'unknown'; receiptCoverage = 'none'; }
  return {
    schema: 'itonami.circle-work-health.v1', at: new Date(now).toISOString(), state,
    reason: state === 'held' ? (cycle.reason ?? 'unknown') : null,
    observedAt, observationAgeHours: hours(observedAt, now),
    lastTickAt, heldHours: state === 'held' ? hours(lastTickAt, now) : null,
    receipts24h, lastReceiptAt: lastReceiptAt === null ? 'unknown' : new Date(lastReceiptAt).toISOString(), receiptCoverage,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, stateRoot] = process.argv.slice(2);
  if (mode !== 'health' || !stateRoot) throw Error('usage: executors.mjs health STATE_ROOT');
  console.log(JSON.stringify(await health(stateRoot)));
}
