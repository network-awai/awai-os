#!/usr/bin/env node
// Factory identity and buyer claim response for a NixOS Murakumo node.
// Account authentication and device registration remain on murakumo.cloud.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync,
         randomBytes, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
const defaultState = '/var/lib/murakumo/device-identity.json';
const defaultOrigin = 'https://murakumo.cloud';

function base58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = alphabet[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function didFromPublicKey(publicKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  if (!spki.subarray(0, spkiPrefix.length).equals(spkiPrefix) ||
      spki.length !== spkiPrefix.length + 32) {
    throw new Error('expected an Ed25519 public key');
  }
  return 'did:key:z' + base58(Buffer.concat([
    Buffer.from([0xed, 0x01]), spki.subarray(spkiPrefix.length),
  ]));
}

export function claimOrigin(value = defaultOrigin) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('claim origin must be HTTPS or a local test endpoint');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('claim origin must contain only a scheme and host');
  }
  return url.origin;
}

function labelField(value) {
  if (typeof value !== 'string' || !value || /[;=\r\n]/.test(value)) {
    throw new Error('invalid claim label field');
  }
  return value;
}

export function labelPayload({ did, model, endpoint, token }) {
  return 'aiueos:1;' +
    `did=${labelField(did)};model=${labelField(model)};` +
    `endpoint=${labelField(endpoint)};token=${labelField(token)}`;
}

export function claimLabelUrl(origin, fields) {
  return `${claimOrigin(origin)}/#claim?q=${encodeURIComponent(labelPayload(fields))}`;
}

export async function provision({ state = defaultState, model, origin = defaultOrigin }) {
  if (!model) throw new Error('provision requires --model');
  const base = claimOrigin(origin);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const did = didFromPublicKey(publicKey);
  const token = randomBytes(32).toString('base64url');
  const identity = {
    version: 1, did, model: labelField(model), origin: base,
    token,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  await mkdir(dirname(state), { recursive: true, mode: 0o700 });
  await writeFile(state, JSON.stringify(identity) + '\n', { flag: 'wx', mode: 0o600 });
  const endpoint = `${base}/api/devices/claim`;
  return {
    did, model,
    labelUrl: claimLabelUrl(base, { did, model, endpoint, token }),
    registration: { did, kind: 'aiueos', name: model, model,
                    state: 'factory', token },
  };
}

export async function loadIdentity(state = defaultState) {
  const identity = JSON.parse(await readFile(state, 'utf8'));
  if (identity.version !== 1 || !/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/.test(identity.did) ||
      typeof identity.token !== 'string' || !identity.token) {
    throw new Error('invalid device identity');
  }
  const key = createPrivateKey(identity.privateKeyPem);
  if (didFromPublicKey(createPublicKey(key)) !== identity.did) {
    throw new Error('device identity does not match its private key');
  }
  return { ...identity, key, origin: claimOrigin(identity.origin) };
}

function framed(domain, ...fields) {
  if (fields.some(v => typeof v !== 'string' || !v || /[\r\n]/.test(v))) {
    throw new Error('invalid signed claim field');
  }
  return [domain, ...fields, ''].join('\n');
}

export function claimSigningInput(did, origin, nonce) {
  return framed('aiueos-device-attest-v1', did, claimOrigin(origin), nonce);
}

export function heartbeatSigningInput(did, origin, body) {
  const digest = createHash('sha256').update(body).digest('hex');
  return framed('aiueos-device-heartbeat-v1', did, claimOrigin(origin), digest);
}

export async function pollClaim(identity, fetcher = fetch, now = Date.now()) {
  const url = `${identity.origin}/api/devices/${identity.did}/challenge`;
  const response = await fetcher(url);
  const body = await response.json();
  if (response.status === 404 && body.challenge === null) return { state: 'idle' };
  if (response.status !== 200) return { state: 'error', status: response.status };
  const { challenge, nonce, expiresAtMs } = body;
  if (typeof challenge !== 'string' || !challenge ||
      typeof nonce !== 'string' || !nonce ||
      !Number.isFinite(expiresAtMs) || now >= expiresAtMs) {
    return { state: 'invalid-challenge' };
  }
  const input = claimSigningInput(identity.did, identity.origin, nonce);
  const signature = sign(null, Buffer.from(input), identity.key).toString('base64url');
  const attested = await fetcher(
    `${identity.origin}/api/devices/${identity.did}/attest`,
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge, signature }) },
  );
  const result = await attested.json();
  return attested.status === 200 && result.verified === true
    ? { state: 'attested', challenge }
    : { state: 'rejected', status: attested.status };
}

export async function sendHeartbeat(identity, fetcher = fetch, now = Date.now()) {
  const body = JSON.stringify({
    'observed-at-ms': now,
    metrics: { agent: 'murakumo-device-claim-v1' },
  });
  const input = heartbeatSigningInput(identity.did, identity.origin, body);
  const signature = sign(null, Buffer.from(input), identity.key).toString('base64url');
  const response = await fetcher(
    `${identity.origin}/api/devices/${identity.did}/heartbeat`,
    { method: 'POST', headers: {
      'content-type': 'application/json', 'x-aiueos-signature': signature,
    }, body },
  );
  const result = await response.json();
  return { accepted: response.status === 202 && result.accepted === true,
           status: response.status, reason: result.reason };
}

export async function serve(identity, fetcher = fetch, { intervalMs = 5000,
                                                       heartbeatMs = 60000 } = {}) {
  let lastHeartbeat = 0;
  for (;;) {
    try {
      const result = await pollClaim(identity, fetcher);
      if (result.state !== 'idle') console.log('claim:', result.state);
    } catch (error) {
      console.error('device claim transport:', error.message);
    }
    if (Date.now() - lastHeartbeat >= heartbeatMs) {
      try {
        const beat = await sendHeartbeat(identity, fetcher);
        if (beat.accepted) console.log('device heartbeat accepted');
      } catch (error) {
        console.error('device heartbeat transport:', error.message);
      }
      lastHeartbeat = Date.now();
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

function option(args, key, fallback) {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : fallback;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const state = option(args, '--state', defaultState);
  if (command === 'provision') {
    const result = await provision({
      state, model: option(args, '--model'),
      origin: option(args, '--origin', defaultOrigin),
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'serve') {
    await serve(await loadIdentity(state));
  } else if (command === 'label') {
    const identity = await loadIdentity(state);
    console.log(JSON.stringify({
      did: identity.did,
      labelUrl: claimLabelUrl(identity.origin, {
        did: identity.did, model: identity.model,
        endpoint: `${identity.origin}/api/devices/claim`,
        token: identity.token,
      }),
      registration: {
        did: identity.did, kind: 'aiueos', name: identity.model,
        model: identity.model, state: 'factory', token: identity.token,
      },
    }, null, 2));
  } else if (command === 'check') {
    const identity = await loadIdentity(state);
    console.log(JSON.stringify({
      did: identity.did,
      claim: await pollClaim(identity),
      heartbeat: await sendHeartbeat(identity),
    }));
  } else {
    throw new Error('usage: device-claim.mjs provision --model NAME [--state FILE] | label | serve | check [--state FILE]');
  }
}

if (process.argv[1] &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
