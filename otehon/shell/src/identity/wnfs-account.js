import { compressP256, fromBase64Url, p256Did, toBase64Url, verifyLink } from './link.js';

const schema = 'awai.wnfs.account-proof.v1';
const lifetime = 24 * 60 * 60 * 1000;
const appIds = ['network.awai.drive', 'network.awai.yataverse'];
const fingerprint = /^kv1:[A-Za-z0-9_-]{43}$/;
const digest = /^[a-f0-9]{64}$/;
const did = /^did:key:z[1-9A-HJ-NP-Za-km-z]{20,110}$/;

export function accountAction({ purpose, value, recipient }) {
  if (purpose === 'bind-wnfs-key' && fingerprint.test(value) && recipient === undefined) {
    return { purpose, value };
  }
  if (purpose === 'sign-wnfs-share' && digest.test(value) && did.test(recipient)) {
    return { purpose, value, recipient };
  }
  throw Error('invalid-account-action');
}

function payload(claim) {
  const { app, account, device, issued, expires, action } = claim;
  if (!appIds.includes(app) || !did.test(account) || !did.test(device) ||
      !Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) ||
      expires <= issued || expires - issued > lifetime) throw Error('invalid-account-proof');
  const { purpose, value, recipient } = accountAction(action);
  return new TextEncoder().encode(JSON.stringify([
    schema, app, account, device, issued, expires, purpose, value, recipient ?? null,
  ]));
}

function linkAccount(link, device, now) {
  if (link?.response?.method !== 'passkey' || typeof link.response.clientDataJSON !== 'string' ||
      link.response.clientDataJSON.length > 4096) throw Error('passkey-link-required');
  const client = JSON.parse(new TextDecoder().decode(fromBase64Url(link.response.clientDataJSON)));
  if (client.crossOrigin === true) throw Error('wrong-origin');
  return verifyLink({ ...link, deviceDid: device, now, atLink: false });
}

export async function issueWnfsAccountProof(pair, link, app, action, now = Date.now()) {
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const device = p256Did(compressP256(publicBytes));
  const session = linkAccount(link, device, now);
  const claim = { app, account: session.accountDid, device, issued: now,
    expires: Math.min(now + lifetime, Date.parse(session.expiresAt)), action: accountAction(action) };
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, payload(claim));
  const { request, response } = link;
  return { schema, claim, key: toBase64Url(publicBytes), signature: toBase64Url(new Uint8Array(signature)), link: { request, response } };
}

export async function verifyWnfsAccountProof(proof, expectedAction, now = Date.now()) {
  const { claim, link } = proof ?? {};
  if (proof?.schema !== schema || !claim || typeof proof.key !== 'string' || proof.key.length !== 87 ||
      typeof proof.signature !== 'string' || proof.signature.length !== 86 ||
      claim.issued > now + 30000 || claim.expires <= now) throw Error('invalid-account-proof');
  const expected = accountAction(expectedAction);
  const actual = accountAction(claim.action);
  if (expected.purpose !== actual.purpose || expected.value !== actual.value || expected.recipient !== actual.recipient) {
    throw Error('wrong-account-action');
  }
  const raw = fromBase64Url(proof.key);
  if (p256Did(compressP256(raw)) !== claim.device) throw Error('wrong-account-device');
  const session = linkAccount(link, claim.device, now);
  if (claim.account !== session.accountDid || claim.expires > Date.parse(session.expiresAt)) throw Error('wrong-account-subject');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
    fromBase64Url(proof.signature), payload(claim));
  if (!verified) throw Error('invalid-account-signature');
  return { account: claim.account, device: claim.device, app: claim.app, expires: claim.expires };
}
