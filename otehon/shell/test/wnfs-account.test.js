import test from 'node:test';
import assert from 'node:assert/strict';
import { compressP256, createLinkRequest, p256Did, verifyLink } from '../src/identity/link.js';
import { issueWnfsAccountProof, verifyWnfsAccountProof } from '../src/identity/wnfs-account.js';
import { passkeyResponse } from './signers.js';

const now = Date.parse('2026-11-18T02:00:00Z');
const binding = { purpose: 'bind-wnfs-key', value: 'kv1:' + 'A'.repeat(43) };

async function linkedDevice(passkey) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const key = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const device = p256Did(compressP256(key));
  const { request } = await createLinkRequest(device, now);
  const response = passkeyResponse(passkey, request, now);
  return { pair, link: { request, response }, account: verifyLink({ request, response, deviceDid: device, now }).accountDid };
}

test('one Passkey establishes the same account in Drive and Itonami across independently held device keys', async () => {
  const passkey = crypto.getRandomValues(new Uint8Array(32));
  const [drive, itonami] = await Promise.all([linkedDevice(passkey), linkedDevice(passkey)]);
  const a = await issueWnfsAccountProof(drive.pair, drive.link, 'network.awai.drive', binding, now);
  const b = await issueWnfsAccountProof(itonami.pair, itonami.link, 'network.awai.yataverse', binding, now);
  const first = await verifyWnfsAccountProof(a, binding, now);
  const second = await verifyWnfsAccountProof(b, binding, now);
  assert.equal(first.account, second.account);
  assert.notEqual(first.device, second.device);
  assert.notEqual(first.app, second.app);
});

test('the device proof is bound to purpose, sender, receiver, app, original link and expiry', async () => {
  const first = await linkedDevice(crypto.getRandomValues(new Uint8Array(32)));
  const other = await linkedDevice(crypto.getRandomValues(new Uint8Array(32)));
  assert.notEqual(first.account, other.account);
  const share = { purpose: 'sign-wnfs-share', value: 'a'.repeat(64), recipient: other.account };
  const issued = await issueWnfsAccountProof(first.pair, first.link, 'network.awai.drive', share, now);
  assert.equal((await verifyWnfsAccountProof(issued, share, now)).account, first.account);
  await assert.rejects(verifyWnfsAccountProof(issued, binding, now), /wrong-account-action/);
  await assert.rejects(verifyWnfsAccountProof(issued, { ...share, recipient: first.account }, now), /wrong-account-action/);
  await assert.rejects(verifyWnfsAccountProof({ ...issued, claim: { ...issued.claim, app: 'network.awai.yataverse' } }, share, now), /invalid-account-signature/);
  await assert.rejects(verifyWnfsAccountProof({ ...issued, claim: { ...issued.claim, account: other.account } }, share, now), /wrong-account-subject/);
  await assert.rejects(verifyWnfsAccountProof({ ...issued, link: other.link }, share, now), /wrong-device/);
  await assert.rejects(verifyWnfsAccountProof(issued, share, issued.claim.expires), /invalid-account-proof/);
  await assert.rejects(issueWnfsAccountProof(other.pair, first.link, 'network.awai.drive', share, now), /wrong-device/);
});
