import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectHandler, summarize, pairingInfo, systemDependencies, PORT } from './connect-bridge.mjs';

function fakeDeps(calls = []) {
  return {
    status: async () => { calls.push('status'); return { state: 'Running', authURL: null, name: 'awai', addresses: ['100.64.0.9'] }; },
    connect: async () => { calls.push('connect'); return { state: 'NeedsLogin' }; },
    disconnect: async () => { calls.push('disconnect'); return { state: 'Stopped' }; },
    logout: async () => { calls.push('logout'); return { state: 'Stopped' }; },
    pairing: async () => { calls.push('pairing'); return { available: true, code: '12345678' }; },
    pairingAction: async (v) => { calls.push(v); return v.fingerprint === 'changed' ? { error: 'operation_failed' } : {}; },
  };
}

async function call(deps, { method = 'GET', path = '/status', headers = {}, body } = {}) {
  const server = http.createServer(connectHandler(deps));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path,
        headers: Object.fromEntries(Object.entries({ host: `127.0.0.1:${PORT}`, origin: 'null', 'x-otehon-connect': '1', ...headers }).filter(([, value]) => value !== undefined)) }, (res) => {
        let text = '';
        res.on('data', (d) => { text += d; });
        res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null, cors: res.headers['access-control-allow-origin'] }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  } finally { server.close(); }
}

test('status refuses to disclose pairing and tailnet information', async () => {
  const calls = [];
  const response = await call(fakeDeps(calls));
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'trusted_host_authorization_unavailable' });
  assert.deepEqual(calls, []);
  assert.equal((await call(fakeDeps(), { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await call(fakeDeps(), { headers: { host: 'localhost:8791' } })).status, 403);
});

test('forged, absent, and opaque origins cannot invoke privileged operations', async () => {
  const calls = [];
  for (const p of ['/tailscale/connect', '/tailscale/disconnect', '/tailscale/logout', '/kekkai/open', '/kekkai/close', '/kekkai/revoke', '/kekkai/approve']) {
    for (const headers of [{}, { origin: undefined }, { 'x-otehon-connect': '' }, { 'x-otehon-connect': '1' }]) {
      const response = await call(fakeDeps(calls), { method: 'POST', path: p, headers, body: { fingerprint: 'SHA256:abc', kekkaiFingerprint: 'a'.repeat(64) } });
      assert.equal(response.status, 503, p);
      assert.equal(response.body.error, 'trusted_host_authorization_unavailable');
    }
  }
  assert.equal((await call(fakeDeps(calls), { method: 'OPTIONS', path: '/tailscale/connect' })).status, 204);
  assert.equal((await call(fakeDeps(calls), { method: 'POST', path: '/tailscale/connect', headers: { origin: 'https://awai.network' } })).status, 403);
  assert.deepEqual(calls, []);
});

test('summaries drop peers and keep only an https sign-in URL', () => {
  const s = summarize({ BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/x', Self: { DNSName: 'awai.tail.ts.net.', TailscaleIPs: ['100.64.0.9'] }, Peer: { k: {} } });
  assert.deepEqual(s, { state: 'NeedsLogin', authURL: 'https://login.tailscale.com/a/x', name: 'awai.tail.ts.net', addresses: ['100.64.0.9'] });
  assert.equal(summarize({ AuthURL: 'javascript:alert(1)' }).authURL, null);
  assert.deepEqual(pairingInfo({ error: 'operation_failed' }), { available: false });
  assert.equal(pairingInfo({ window: { code: '00000001', expires: 5 } }).code, '00000001');
});

test('connect writes the start condition before starting tailscaled', async () => {
  const state = await mkdtemp(join(tmpdir(), 'otehon-connect-'));
  const order = [];
  const deps = systemDependencies({
    state,
    run: async (cmd, args) => {
      if (cmd === 'systemctl' && args[0] === 'start') assert.equal(existsSync(join(state, 'tailscale-enabled')), true);
      order.push([cmd, ...args].join(' '));
      if (cmd === 'systemctl' && args[0] === 'is-active') return { stdout: 'active\n' };
      if (cmd === 'tailscale' && args[0] === 'status') return { stdout: JSON.stringify({ BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/x' }) };
      if (cmd === 'tailscale' && args[0] === 'up') throw Error('timeout');
      return { stdout: '' };
    },
    ask: async () => ({}),
  });
  const result = await deps.connect();
  assert.deepEqual(order.slice(0, 2), ['systemctl start tailscaled.service', 'tailscale up --timeout=10s']);
  assert.equal(result.authURL, 'https://login.tailscale.com/a/x');
  await deps.disconnect();
  assert.equal(existsSync(join(state, 'tailscale-enabled')), false);
  assert.ok(order.includes('systemctl stop tailscaled.service'));
});
