import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  claimOrigin, claimSigningInput, heartbeatSigningInput, loadIdentity,
  pollClaim, provision, sendHeartbeat,
} from '../device-claim.mjs';

async function fixture(fn, origin = 'http://127.0.0.1:8181') {
  const dir = await mkdtemp(join(tmpdir(), 'murakumo-claim-'));
  try {
    const state = join(dir, 'identity.json');
    const printed = await provision({
      state, model: 'Murakumo 2609', origin,
    });
    return await fn({ state, printed, identity: await loadIdentity(state) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('factory provision creates one private device key and canonical buyer label', async () => {
  await fixture(async ({ state, printed, identity }) => {
    assert.equal((await stat(state)).mode & 0o777, 0o600);
    assert.match(printed.did, /^did:key:z6Mk/);
    assert.equal(printed.registration.state, 'factory');
    assert.equal(printed.registration.did, printed.did);
    const payload = decodeURIComponent(new URL(printed.labelUrl).hash.split('q=')[1]);
    assert.equal(payload, `aiueos:1;did=${printed.did};model=Murakumo 2609;endpoint=http://127.0.0.1:8181/api/devices/claim;token=${printed.registration.token}`);
    assert.equal(identity.did, printed.did);
    await assert.rejects(() => provision({ state, model: 'Murakumo 2609',
                                          origin: 'http://127.0.0.1:8181' }), /EEXIST/);
  });
});

test('factory CLI runs through the symlink used by NixOS /etc', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'murakumo-symlink-'));
  try {
    const entry = join(dir, 'device-claim.mjs');
    const state = join(dir, 'identity.json');
    await symlink(fileURLToPath(new URL('../device-claim.mjs', import.meta.url)), entry);
    const run = spawnSync(process.execPath, [entry, 'provision', '--state', state,
      '--model', 'Murakumo 2609', '--origin', 'http://127.0.0.1:8741'],
    { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal((await stat(state)).mode & 0o777, 0o600);
    assert.match(JSON.parse(run.stdout).did, /^did:key:z6Mk/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('device answers a claim and sends a signed heartbeat over loopback HTTP', async () => {
  let identity;
  let attestCount = 0;
  let heartbeatCount = 0;
  const nonce = 'http-nonce';
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, undefined);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const publicKey = createPublicKey(identity.key);
    let status = 200;
    let result;
    if (request.url.endsWith('/challenge')) {
      result = { challenge: 'http-claim', nonce,
                 expiresAtMs: Date.now() + 300000 };
    } else if (request.url.endsWith('/attest')) {
      attestCount++;
      const body = JSON.parse(raw);
      assert.equal(body.challenge, 'http-claim');
      assert.ok(verify(null,
        Buffer.from(claimSigningInput(identity.did, identity.origin, nonce)),
        publicKey, Buffer.from(body.signature, 'base64url')));
      result = { verified: true };
    } else if (request.url.endsWith('/heartbeat')) {
      heartbeatCount++;
      status = 202;
      assert.ok(verify(null,
        Buffer.from(heartbeatSigningInput(identity.did, identity.origin, raw)),
        publicKey, Buffer.from(request.headers['x-aiueos-signature'], 'base64url')));
      result = { accepted: true };
    } else {
      throw new Error(`unexpected path: ${request.url}`);
    }
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await fixture(async ({ identity: device }) => {
      identity = device;
      assert.equal((await pollClaim(device)).state, 'attested');
      assert.equal((await sendHeartbeat(device)).accepted, true);
    }, origin);
    assert.equal(attestCount, 1);
    assert.equal(heartbeatCount, 1);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('a device signs the exact site challenge and heartbeat contracts', async () => {
  await fixture(async ({ identity }) => {
    const publicKey = createPublicKey(identity.key);
    const now = Date.now();
    let attestCount = 0;
    const fetcher = async (url, options) => {
      if (url.endsWith('/challenge')) {
        return Response.json({ challenge: 'claim-1', nonce: 'nonce-1',
                               expiresAtMs: now + 300000 });
      }
      if (url.endsWith('/attest')) {
        attestCount++;
        const body = JSON.parse(options.body);
        assert.equal(body.challenge, 'claim-1');
        assert.ok(verify(null,
          Buffer.from(claimSigningInput(identity.did, identity.origin, 'nonce-1')),
          publicKey, Buffer.from(body.signature, 'base64url')));
        return Response.json({ verified: true });
      }
      if (url.endsWith('/heartbeat')) {
        assert.equal(JSON.parse(options.body)['observed-at-ms'], now);
        assert.ok(verify(null,
          Buffer.from(heartbeatSigningInput(identity.did, identity.origin, options.body)),
          publicKey, Buffer.from(options.headers['x-aiueos-signature'], 'base64url')));
        return Response.json({ accepted: true }, { status: 202 });
      }
      throw new Error(`unexpected URL: ${url}`);
    };
    assert.deepEqual(await pollClaim(identity, fetcher, now),
                     { state: 'attested', challenge: 'claim-1' });
    assert.equal(attestCount, 1);
    assert.equal((await sendHeartbeat(identity, fetcher, now)).accepted, true);
  });
});

test('expired, absent and unreachable challenges cannot be signed', async () => {
  await fixture(async ({ identity }) => {
    const now = Date.now();
    assert.deepEqual(await pollClaim(identity,
      async () => Response.json({ challenge: null }, { status: 404 }), now),
      { state: 'idle' });
    assert.deepEqual(await pollClaim(identity,
      async () => Response.json({ challenge: 'old', nonce: 'n',
                                  expiresAtMs: now }), now),
      { state: 'invalid-challenge' });
    assert.deepEqual(await pollClaim(identity,
      async () => Response.json({ error: 'unavailable' }, { status: 503 }), now),
      { state: 'error', status: 503 });
  });
  assert.throws(() => claimOrigin('http://remote.example'), /HTTPS/);
});
