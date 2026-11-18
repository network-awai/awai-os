import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cidFromSha256, contributionProblems, rightsStatement, statementBytes, rightsRecord, submissionPayload, importReward, runtimeDescriptor,
  SELECTOR, OPERATION, decodeState, emptyState, addContribution, recordSubmission, withdraw, addReward, sha256Hex, CONSENT_VERSION} from '../src/model.js';
import {clientRuntimeProblems, clientEndpointAllowsRequest, effectiveClientOperations} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';

const sha = c => c.repeat(64);
function contribution(over = {}) {
  return {id: 'c-test-1', mediaKind: 'image', contentSha256: sha('a'), contentCid: cidFromSha256(sha('a')), contentBytes: 10, title: 'a.png',
    rightsBasis: 'own-work', license: 'USER-TRAINING-GRANT-v1', licenseGrantCid: null, personalData: false, sensitiveData: false,
    depictedPersons: 0, depictedConsentCids: [], trainingConsent: CONSENT_VERSION, createdAt: '2026-11-18T00:00:00Z',
    contributors: [{humanId: 'test-human-1', did: 'did:web:contributor-1.example', shareBps: 7500}, {humanId: 'test-human-2', did: 'did:web:contributor-2.example', shareBps: 2500}],
    statementSha256: sha('b'), statementCid: cidFromSha256(sha('b')), ...over};
}

test('CID derivation matches the server contract (the bot fixture for sha256 aa…a)', () => {
  assert.equal(cidFromSha256(sha('a')), 'bafkreifkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvi');
  assert.throws(() => cidFromSha256('xyz'));
});

test('a complete own-work contribution has no problems; every media kind is accepted', () => {
  assert.deepEqual(contributionProblems(contribution()), []);
  for (const k of ['image', 'video', 'text', 'post']) assert.deepEqual(contributionProblems(contribution({mediaKind: k})), []);
});

test('missing rights basis, consent and the explicit no-personal/no-sensitive answers are refused', () => {
  assert.ok(contributionProblems(contribution({rightsBasis: ''})).includes('rightsBasis.missing'));
  assert.ok(contributionProblems(contribution({rightsBasis: 'public-domain'})).includes('rightsBasis.missing'));
  assert.ok(contributionProblems(contribution({trainingConsent: null})).includes('consent.missing'));
  assert.ok(contributionProblems(contribution({personalData: true})).includes('personalData.notAccepted'));
  assert.ok(contributionProblems(contribution({sensitiveData: undefined})).includes('sensitiveData.notAccepted'));
  assert.ok(contributionProblems(contribution({license: 'All-Rights-Reserved'})).includes('license.unsupported'));
});

test('shares must be integers that sum to exactly 10,000 bps; ids and DIDs unique', () => {
  const two = (a, b) => [{humanId: 'h1', did: 'did:web:a.example', shareBps: a}, {humanId: 'h2', did: 'did:web:b.example', shareBps: b}];
  assert.ok(contributionProblems(contribution({contributors: two(7500, 2499)})).includes('contributors.total'));
  assert.ok(contributionProblems(contribution({contributors: two(5000.5, 4999.5)})).includes('contributors.share'));
  assert.ok(contributionProblems(contribution({contributors: two(10000, 0)})).includes('contributors.share'));
  assert.ok(contributionProblems(contribution({contributors: []})).includes('contributors.count'));
  const dupId = two(5000, 5000); dupId[1].humanId = 'h1';
  assert.ok(contributionProblems(contribution({contributors: dupId})).includes('contributors.duplicateId'));
  const dupDid = two(5000, 5000); dupDid[1].did = 'did:web:a.example';
  assert.ok(contributionProblems(contribution({contributors: dupDid})).includes('contributors.duplicateDid'));
});

test('third-party works need a grant CID; each depicted person needs a distinct consent CID', () => {
  assert.ok(contributionProblems(contribution({rightsBasis: 'third-party-licensed'})).includes('licenseGrant.missing'));
  assert.deepEqual(contributionProblems(contribution({rightsBasis: 'third-party-licensed', licenseGrantCid: cidFromSha256(sha('e'))})), []);
  const c1 = cidFromSha256(sha('1')), c2 = cidFromSha256(sha('2'));
  assert.deepEqual(contributionProblems(contribution({depictedPersons: 2, depictedConsentCids: [c1, c2]})), []);
  assert.ok(contributionProblems(contribution({depictedPersons: 2, depictedConsentCids: [c1]})).includes('depicted.consents'));
  assert.ok(contributionProblems(contribution({depictedPersons: 2, depictedConsentCids: [c1, c1]})).includes('depicted.consents'));
});

test('the rights statement is canonical bytes; the record carries no server marker', async () => {
  const s = rightsStatement(contribution(), '2026-11-18T00:00:00Z');
  const a = statementBytes(s), b = statementBytes(JSON.parse(JSON.stringify(s)));
  assert.equal(await sha256Hex(a), await sha256Hex(b));
  const r = rightsRecord(contribution());
  assert.equal(r['contribution/schema'], 'murakumo.training-contribution-rights/v1');
  assert.equal(Object.keys(r).filter(k => /verified\?|reviewed\?/.test(k)).length, 0);
  assert.equal(r['rights/personal-data?'], false);
});

test('the descriptor declares exactly one each-operation submit, and the payload matches it', () => {
  const d = runtimeDescriptor();
  assert.deepEqual(clientRuntimeProblems(d, [SELECTOR.capability], 'https://tauri.localhost'), []);
  assert.equal(d.operations.length, 1);
  assert.equal(d.operations[0].consent, 'each-operation');
  const p = submissionPayload(contribution());
  assert.ok(clientEndpointAllowsRequest(OPERATION.endpoint, p.input, p.init.method));
  assert.ok(!clientEndpointAllowsRequest(OPERATION.endpoint, 'https://api.murakumo.cloud/training/payouts/pending', 'POST'));
  assert.ok(!clientEndpointAllowsRequest(OPERATION.endpoint, p.input, 'GET'));
  const body = JSON.parse(p.init.body);
  assert.equal(body.cid, contribution().contentCid);
  assert.equal(body.rightsRecord['rights/basis'], 'own-work');
  assert.ok(!('authorization' in p.init.headers));
  // Without the participant's explicit approval set the broker has no eligible operation at all.
  assert.deepEqual(effectiveClientOperations(d, {requestedCapabilities: [SELECTOR.capability], approvedOperations: [], hostSupportedOperations: [[SELECTOR.capability, SELECTOR.service, SELECTOR.operation]]}), []);
});

test('the bot\'s test-stage result is read; paid or inconsistent results are refused', async () => {
  const text = await readFile(new URL('./fixtures/bot-result.edn', import.meta.url), 'utf8');
  const r = importReward(text, 'now');
  assert.deepEqual(r.allocations.map(a => [a.humanId, a.yataUnits]), [['test-human-1', '750000'], ['test-human-2', '250000']]);
  assert.equal(r.stage, 'test');
  assert.throws(() => importReward(text.replace(':payout? false', ':payout? true'), 'now'), /reward.payout/);
  assert.throws(() => importReward(text.replace(':yata-units "250000"', ':yata-units "250001"'), 'now'), /reward.units/);
  assert.throws(() => importReward(text.replace('awai.training-reward-result/1', 'other/1'), 'now'), /reward.schema/);
  assert.throws(() => importReward('{', 'now'), /reward.malformed/);
});

test('state: add, refuse duplicates, record a send, withdraw; unreadable state is refused', () => {
  let s = addContribution(emptyState(), contribution());
  assert.equal(decodeState(s), s);
  assert.throws(() => addContribution(s, contribution({id: 'c-test-2'})), /duplicate-content/);
  assert.throws(() => addContribution(s, contribution({id: 'c-x', rightsBasis: ''})), /contribution-invalid/);
  const refused = recordSubmission(s, 'c-test-1', {status: 404, error: null}, 't1');
  assert.equal(refused.contributions[0].status, 'draft');
  const sent = recordSubmission(s, 'c-test-1', {status: 201, error: null}, 't2');
  assert.equal(sent.contributions[0].status, 'submitted');
  assert.throws(() => recordSubmission(sent, 'c-test-1', {status: 201}, 't3'), /not-a-draft/);
  const w = withdraw(sent, 'c-test-1', 't4');
  assert.equal(w.contributions[0].status, 'withdrawn');
  assert.throws(() => withdraw(w, 'c-test-1', 't5'), /already-withdrawn/);
  assert.throws(() => decodeState({schema: 'other', contributions: [], rewards: []}), /state-unreadable/);
  assert.throws(() => decodeState({...s, contributions: [{...s.contributions[0], status: 'paid'}]}), /state-unreadable/);
  assert.equal(addReward(emptyState(), {requestId: 'r', epochId: 'e', stage: 'test', allocations: []}).rewards.length, 1);
});
