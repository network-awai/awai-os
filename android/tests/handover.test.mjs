// AWAI-4071: compiled handover domain — challenge binding, expiry,
// revocation, cancellation, phone-loss recovery and truthful
// unavailable/defer. Exercises the CLJC source through the generated
// domain bundle (same pattern as domain.test.mjs / setup.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../client/generated/domain.js', import.meta.url), 'utf8'), context);
const domain = context.window.ItonamiDomain;

const now = 1760000000000;
const DID = 'did:key:z6MkhaXgBZDvotDkHzwyEj7KPSnxFWaQY5UNCBJU4x8dgVd6';
const OTHER = 'did:key:z6MkhaXgBZDvotDkHzwyEj7KPSnxFWaQY5UNCBJU4x8d6Vd6';

function challenge(overrides = {}) {
  return {
    schema: domain.handoverSchema,
    device: DID,
    deviceName: 'My Android',
    nonce: '0123456789abcdef01234567',
    topic: '0123456789abcdef0123456789abcdef',
    ek: 'ephemeral-public',
    exp: now + 10 * 60 * 1000,
    scope: ['profile:settings', 'profile:home-state'],
    ...overrides,
  };
}

const verify = (input) => JSON.parse(domain.verifyChallenge(JSON.stringify(input)));

test('compiled handover schema and descriptor', () => {
  assert.equal(domain.handoverSchema, 'awai.handover.v1');
  const desc = domain.handoverDescriptor;
  assert.equal(desc.schema, 'kotoba.app.client-runtime.v1');
  assert.ok(Array.isArray(desc.operations));
  assert.ok(desc.operations.some(o => o.capability === 'awai-handover' && o.operation === 'await-handover-approval'));
});

test('challenge shape and expiry are enforced by the shared domain', () => {
  assert.equal(domain.validChallenge(JSON.stringify(challenge())), true);
  assert.equal(domain.validChallenge(JSON.stringify(challenge({ device: 'bad' }))), false);
  assert.equal(domain.validChallenge(JSON.stringify(challenge({ deviceName: '' }))), false);
  assert.equal(domain.validChallenge(JSON.stringify(challenge({ scope: [] }))), false);
  assert.equal(domain.validChallenge(JSON.stringify(challenge({ scope: ['profile:evil'] }))), false);
  assert.equal(domain.challengeExpired(JSON.stringify(challenge({ exp: now })), now), true);
  assert.equal(domain.challengeExpired(JSON.stringify(challenge()), now), false);
});

test('verify-challenge rejects wrong device, expiry, scope, revocation and cancellation', () => {
  assert.deepEqual(verify({ challenge: challenge(), device: DID, scope: ['profile:settings', 'profile:home-state'], now }), {
    ok: true, device: DID, scope: ['profile:settings', 'profile:home-state'], status: 'ready',
  });
  assert.equal(verify({ challenge: challenge(), device: OTHER, scope: ['profile:settings'], now }).error, 'wrong-device');
  assert.equal(verify({ challenge: challenge({ exp: now }), device: DID, scope: ['profile:settings'], now }).error, 'expired');
  assert.equal(verify({ challenge: challenge(), device: DID, scope: ['profile:settings'], now }).error, 'scope-not-approved');
  assert.equal(verify({ challenge: challenge(), device: DID, scope: ['profile:settings'], now, revoked: [DID] }).error, 'revoked');
  // revoked is a set in CLJC; JSON arrays arrive as lists — domain treats
  // a vector like a set for lookup. Verify via the next-status path too.
  assert.equal(verify({ challenge: challenge(), device: DID, scope: ['profile:settings'], now, cancelled: true }).error, 'cancelled');
});

test('phone-loss recovery: lost key revoked, fresh key verified', () => {
  const fresh = challenge({ device: OTHER });
  const lostVerdict = verify({ challenge: challenge(), device: DID, scope: ['profile:settings'], now, revoked: [DID] });
  assert.equal(lostVerdict.error, 'revoked');
  const freshVerdict = verify({ challenge: fresh, device: OTHER, scope: ['profile:settings', 'profile:home-state'], now, revoked: [DID] });
  assert.equal(freshVerdict.ok, true);
});

test('unimplemented scopes are truthful unavailable, never completed', () => {
  assert.equal(domain.transferStatus(JSON.stringify(['profile:settings'])), 'ready');
  assert.equal(domain.transferStatus(JSON.stringify(['profile:wnfs-snapshot'])), 'unavailable');
  const v = verify({ challenge: challenge({ scope: ['profile:wnfs-snapshot'] }), device: DID, scope: ['profile:wnfs-snapshot'], now });
  assert.equal(v.status, 'unavailable');
  assert.equal(domain.handoverNextStatus(JSON.stringify({ status: 'pending', verdict: v })), 'unavailable');
  assert.notEqual(domain.handoverNextStatus(JSON.stringify({ status: 'pending', verdict: v })), 'completed');
  assert.equal(domain.handoverNextStatus(JSON.stringify({ status: 'pending', verdict: { ok: true, status: 'ready', device: DID, scope: ['profile:settings'] } })), 'transferring');
  assert.equal(domain.handoverNextStatus(JSON.stringify({ status: 'cancelled', verdict: { ok: true, status: 'ready' } })), 'cancelled');
});

test('forbidden credential fields and envelope shape', () => {
  assert.equal(domain.forbiddenKeysPresent(JSON.stringify({ seed: 'abc' })), true);
  assert.equal(domain.forbiddenKeysPresent(JSON.stringify({ privateKey: 'x', scope: 'profile:settings' })), true);
  assert.equal(domain.forbiddenKeysPresent(JSON.stringify({ locale: 'ja-JP' })), false);
  assert.equal(domain.validEnvelope(JSON.stringify({
    schema: domain.handoverSchema, scope: ['profile:settings'], device: DID, exp: now + 60000, ek: 'e', iv: 'i', ct: 'c',
  })), true);
  assert.equal(domain.validEnvelope(JSON.stringify({
    schema: domain.handoverSchema, scope: [], device: DID, exp: now + 1, ek: 'e', iv: 'i', ct: 'c',
  })), false);
});
