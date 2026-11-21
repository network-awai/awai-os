import { compressP256, fromBase64Url, p256Did, toBase64Url } from './link.js';

export const HOST_ACCOUNT_SCHEMA = 'awai.host-account.v1';
export const ITONAMI_PACKAGE = 'network.itonami.app';
const lifetime = 30_000;
const encoder = new TextEncoder();

function payload({ app, uid, nonce, accountDid, method, deviceDid, issued, expires }) {
  return encoder.encode(JSON.stringify([
    HOST_ACCOUNT_SCHEMA, app, uid, nonce, accountDid, method, deviceDid, issued, expires,
  ]));
}

export async function issueHostAccountProof(pair, session, request, now = Date.now()) {
  const { app, uid, nonce } = request;
  if (app !== ITONAMI_PACKAGE || !Number.isSafeInteger(uid) || uid < 0 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(nonce)) {
    throw Error('invalid-host-account-request');
  }
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const claim = {
    app, uid, nonce, accountDid: session.accountDid, method: session.method,
    deviceDid: p256Did(compressP256(raw)), issued: now,
    expires: Math.min(now + lifetime, Date.parse(session.expiresAt)),
  };
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, payload(claim));
  return { schema: HOST_ACCOUNT_SCHEMA, claim, key: toBase64Url(raw), signature: toBase64Url(new Uint8Array(signature)) };
}

// Call only on the live response from the signer- and Android-user-checked IPC.
// The key binding alone does not establish that an arbitrary caller is Awai Home.
export async function verifyHostAccountProof(proof, nonce, uid, now = Date.now()) {
  const claim = proof?.claim;
  if (proof?.schema !== HOST_ACCOUNT_SCHEMA || !claim || claim.app !== ITONAMI_PACKAGE ||
      !Number.isSafeInteger(uid) || claim.uid !== uid || claim.nonce !== nonce ||
      !Number.isSafeInteger(claim.issued) || !Number.isSafeInteger(claim.expires) ||
      claim.issued > now || claim.expires <= now || claim.expires <= claim.issued ||
      claim.expires - claim.issued > lifetime ||
      typeof proof.key !== 'string' || proof.key.length !== 87 ||
      typeof proof.signature !== 'string' || proof.signature.length !== 86 ||
      !(claim.method === 'passkey' && /^did:key:z[1-9A-HJ-NP-Za-km-z]{20,110}$/.test(claim.accountDid) ||
        claim.method === 'wallet' && /^did:pkh:eip155:\d+:0x[0-9a-fA-F]{40}$/.test(claim.accountDid))) {
    throw Error('invalid-host-account-proof');
  }
  const raw = fromBase64Url(proof.key);
  if (p256Did(compressP256(raw)) !== claim.deviceDid) throw Error('wrong-host-account-device');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
    fromBase64Url(proof.signature), payload(claim));
  if (!verified) throw Error('invalid-host-account-signature');
  return { accountDid: claim.accountDid, method: claim.method, expiresAt: new Date(claim.expires).toISOString() };
}

export async function readHostAccount() {
  const nonce = crypto.randomUUID();
  const { uid, proof } = await globalThis.__TAURI_INTERNALS__.invoke('awai_host_account', { nonce });
  return verifyHostAccountProof(JSON.parse(proof), nonce, uid);
}
