// AWAI-3255: the awai-drive bot's readback check against an in-memory WebDAV stand-in.
import assert from 'node:assert/strict';
import test from 'node:test';
import { check, originOf, NAMESPACE } from '../bot/awai-drive/scripts/readback-check.mjs';

function fakeDav({ corrupt = false, zero = false, availability = 'cached' } = {}) {
  const files = new Map(), dirs = new Set(), log = [];
  const fetchImpl = async (url, { method, body }) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.slice(1));
    log.push(`${method} ${path}`);
    const res = (status, b = '') => new Response(status === 204 ? null : b, { status });
    if (path === '__availability') return res(200, JSON.stringify({ state: files.has(u.searchParams.get('path')) ? availability : 'unknown' }));
    if (method === 'MKCOL') { const d = path.replace(/\/$/, ''); if (dirs.has(d)) return res(405); dirs.add(d); return res(201); }
    if (method === 'PUT') { files.set(path, Buffer.from(body)); return res(201); }
    if (method === 'GET') {
      if (!files.has(path)) return res(404);
      const b = Buffer.from(files.get(path));
      if (corrupt) b[0] ^= 1;
      return res(200, zero ? Buffer.alloc(b.length) : b);
    }
    if (method === 'DELETE') {
      const d = path.replace(/\/$/, '');
      if (files.delete(d)) return res(204);
      if (dirs.delete(d)) return res(204);
      return res(404);
    }
    return res(405);
  };
  return { fetchImpl, files, dirs, log };
}

test('origin must be loopback http with a port', () => {
  assert.equal(originOf(undefined), null);
  assert.equal(originOf('http://127.0.0.1:18587'), 'http://127.0.0.1:18587');
  for (const bad of ['https://127.0.0.1:1', 'http://example.com:80', 'http://127.0.0.1', 'http://127.0.0.1:1/x', 'http://10.0.0.1:80'])
    assert.throws(() => originOf(bad), /loopback/, bad);
});

test('writes one probe in its own namespace, reads it back and removes only what it made', async () => {
  const dav = fakeDav();
  const r = await check('http://127.0.0.1:1', { fetchImpl: dav.fetchImpl, runId: 'run-1' });
  assert.equal(r.ok, true);
  assert.equal(r.match, true);
  assert.equal(r.zeroFilled, false);
  assert.equal(r.availability, 'cached');
  assert.equal(r.cleanup, 'done');
  assert.equal(r.object, `${NAMESPACE}/run-1/probe.bin`);
  assert.equal(dav.files.size, 0);
  assert.equal(dav.dirs.size, 0);
  assert.ok(dav.log.every(l => l.includes(NAMESPACE) || l.startsWith('GET __availability')), dav.log.join('\n'));
});

test('keeps a namespace folder it did not create', async () => {
  const dav = fakeDav();
  dav.dirs.add(NAMESPACE);
  const r = await check('http://127.0.0.1:1', { fetchImpl: dav.fetchImpl, runId: 'run-2' });
  assert.equal(r.ok, true);
  assert.deepEqual([...dav.dirs], [NAMESPACE]);
});

test('a changed byte or a zero-filled read fails the check', async () => {
  const bad = await check('http://127.0.0.1:1', { fetchImpl: fakeDav({ corrupt: true }).fetchImpl, runId: 'run-3' });
  assert.equal(bad.ok, false);
  assert.equal(bad.match, false);
  const zero = await check('http://127.0.0.1:1', { fetchImpl: fakeDav({ zero: true }).fetchImpl, runId: 'run-4' });
  assert.equal(zero.ok, false);
  assert.equal(zero.zeroFilled, true);
});

test('an unreachable daemon is reported, not passed, and unmeasured values stay unknown', async () => {
  const fetchImpl = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const r = await check('http://127.0.0.1:1', { fetchImpl, runId: 'run-5' });
  assert.equal(r.ok, false);
  assert.equal(r.match, 'unknown');
  assert.equal(r.availability, 'unknown');
  assert.match(r.put.status, /ECONNREFUSED/);
});
