// Data Contributions model (AWAI-3209). Pure: no DOM, no network, no clock (callers pass `now`).
//
// A contribution is the participant's own declaration of one item (image, video, text document or post):
// its content CID, the rights basis and license, the contributors and their shares, the people depicted
// and their consents, and the explicit "no personal data / no sensitive data" answers. The checks below
// mirror cloud-murakumo-api `training-contribution-rights/record-decision` (ADR-261118, AWAI-3210) for
// what the participant can know. The server decides: it reads the rights statement and consents back
// and writes every `-verified?`/`-reviewed?` marker itself. This app never sets one.
import {parseEdn} from './edn.js';

export const STATE_SCHEMA = 'itonami.datacontribution.state.v1';
export const RECORD_SCHEMA = 'murakumo.training-contribution-rights/v1';
export const STATEMENT_SCHEMA = 'awai.rights-statement/1';
export const RESULT_SCHEMA = 'awai.training-reward-result/1';
export const CONSENT_VERSION = 'training-data-consent/1';
export const MEDIA_KINDS = Object.freeze(['image', 'video', 'text', 'post']);
export const RIGHTS_BASES = Object.freeze(['own-work', 'third-party-licensed']);
export const LICENSES = Object.freeze(['USER-TRAINING-GRANT-v1', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0']);
export const TOTAL_SHARE_BPS = 10000;
export const MAX_CONTRIBUTORS = 32;
export const MAX_DEPICTED = 64;
export const MAX_CONTRIBUTIONS = 50;
export const MAX_REWARDS = 50;
export const MAX_CONTENT_BYTES = 16 * 1024 * 1024; // one Awai FS / yataverse.com block

// The one external operation: submit a contribution record to cloud-murakumo-api, once per approval.
export const API_ORIGIN = 'https://api.murakumo.cloud';
export const SELECTOR = Object.freeze({capability: 'itonami.datacontribution.submit', service: 'murakumo.training', operation: 'submit-contribution'});
export const OPERATION = Object.freeze({...SELECTOR, endpoint: {origin: API_ORIGIN, method: 'POST', path: '/training/contributions'},
  'data-categories': ['content-cid', 'content-sha256', 'rights-declaration', 'contributor-dids', 'contributor-shares', 'depicted-person-consent-cids'],
  consent: 'each-operation'});
export function runtimeDescriptor() {
  return {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
    'local-state': {adapter: 'localstorage', schema: STATE_SCHEMA, version: 1}, workers: [], operations: [OPERATION]};
}

// Operations a later version needs. Display only: none is declared in the descriptor.
export const PLANNED_OPERATIONS = Object.freeze([
  {id: 'upload-content', service: 'awai.fs', endpoint: 'https://yataverse.com', waits: 'bytes-plane'},
  {id: 'register-human', service: 'murakumo.training', endpoint: API_ORIGIN, waits: 'human-session'},
  {id: 'withdraw-at-server', service: 'murakumo.training', endpoint: API_ORIGIN, waits: 'withdraw-route'},
  {id: 'read-rewards', service: 'murakumo.training', endpoint: API_ORIGIN, waits: 'reward-route'}]);

const SHA256 = /^[0-9a-f]{64}$/;
const DID = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/i;
const ID = /^[A-Za-z0-9._:-]{1,160}$/;
const CID = /^b[a-z2-7]{58}$/;
const UNITS = /^(0|[1-9][0-9]{0,77})$/;

export function cidFromSha256(hex) {
  if (!SHA256.test(hex)) throw Error('invalid-sha256');
  const bytes = [0x01, 0x55, 0x12, 0x20, ...hex.match(/../g).map(h => parseInt(h, 16))];
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let out = 'b', value = 0, bits = 0;
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(bytes) { return hex(await crypto.subtle.digest('SHA-256', bytes)); }

export const validCid = v => typeof v === 'string' && CID.test(v);
export const validDid = v => typeof v === 'string' && DID.test(v);

// Problems as "field.rule" codes, in the order the server contract checks them.
export function contributionProblems(c) {
  const p = [];
  if (!MEDIA_KINDS.includes(c.mediaKind)) p.push('mediaKind.unsupported');
  if (!SHA256.test(c.contentSha256 ?? '') || c.contentCid !== cidFromSha256(c.contentSha256)) p.push('content.missing');
  if (c.personalData !== false) p.push('personalData.notAccepted');
  if (c.sensitiveData !== false) p.push('sensitiveData.notAccepted');
  if (!RIGHTS_BASES.includes(c.rightsBasis)) p.push('rightsBasis.missing');
  if (!LICENSES.includes(c.license)) p.push('license.unsupported');
  const cs = Array.isArray(c.contributors) ? c.contributors : [];
  if (cs.length < 1 || cs.length > MAX_CONTRIBUTORS) p.push('contributors.count');
  if (cs.some(x => !ID.test(x.humanId ?? ''))) p.push('contributors.humanId');
  if (cs.some(x => !validDid(x.did))) p.push('contributors.did');
  if (cs.some(x => !Number.isInteger(x.shareBps) || x.shareBps < 1 || x.shareBps > TOTAL_SHARE_BPS)) p.push('contributors.share');
  else if (cs.reduce((s, x) => s + x.shareBps, 0) !== TOTAL_SHARE_BPS) p.push('contributors.total');
  if (new Set(cs.map(x => x.humanId)).size !== cs.length) p.push('contributors.duplicateId');
  if (new Set(cs.map(x => x.did)).size !== cs.length) p.push('contributors.duplicateDid');
  if (c.rightsBasis === 'third-party-licensed' && !validCid(c.licenseGrantCid)) p.push('licenseGrant.missing');
  const consents = Array.isArray(c.depictedConsentCids) ? c.depictedConsentCids : [];
  if (!Number.isInteger(c.depictedPersons) || c.depictedPersons < 0 || c.depictedPersons > MAX_DEPICTED) p.push('depicted.count');
  else if (consents.length !== c.depictedPersons || consents.some(x => !validCid(x)) || new Set(consents).size !== consents.length) p.push('depicted.consents');
  if (c.trainingConsent !== CONSENT_VERSION) p.push('consent.missing');
  return p;
}

// The rights statement the participant signs off locally, as canonical JSON bytes. Its sha256 and raw
// CID go into the record; the bytes are kept in Awai FS so the server can read them back later.
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export function rightsStatement(c, declaredAt) {
  return {schema: STATEMENT_SCHEMA, contributionId: c.id, mediaKind: c.mediaKind, contentCid: c.contentCid, contentSha256: c.contentSha256,
    rightsBasis: c.rightsBasis, license: c.license, licenseGrantCid: c.rightsBasis === 'third-party-licensed' ? c.licenseGrantCid : null,
    contributors: c.contributors.map(x => ({humanId: x.humanId, did: x.did, shareBps: x.shareBps})),
    depictedPersons: c.depictedPersons, depictedConsentCids: c.depictedConsentCids,
    personalData: false, sensitiveData: false, consentVersion: CONSENT_VERSION, declaredAt};
}
export const statementBytes = s => new TextEncoder().encode(canonical(s) + '\n');

// The contract's v1 record without any server-written marker.
export function rightsRecord(c) {
  return {'contribution/schema': RECORD_SCHEMA, 'contribution/id': c.id, 'contribution/media-kind': c.mediaKind,
    'contribution/content-cid': c.contentCid, 'contribution/content-sha256': c.contentSha256, 'consent/version': CONSENT_VERSION,
    'rights/personal-data?': false, 'rights/sensitive-data?': false, 'rights/basis': c.rightsBasis, 'rights/license': c.license,
    'rights/statement-cid': c.statementCid, 'rights/statement-sha256': c.statementSha256,
    ...(c.rightsBasis === 'third-party-licensed' ? {'rights/license-grant-cid': c.licenseGrantCid} : {}),
    'rights/depicted-persons': c.depictedPersons, 'rights/depicted-person-consent-cids': c.depictedConsentCids,
    'contribution/contributors': c.contributors.map(x => ({'contributor/human-id': x.humanId, 'contributor/did': x.did, 'contributor/share-bps': x.shareBps}))};
}

// The request the broker shows and, after approval, sends. The legacy fields are what the current
// POST /training/contributions reads; `rightsRecord` is the v1 record it is to read once wired (AWAI-3210 follow-up).
// No credential: a registered human session is a later operation.
export function submissionPayload(c) {
  const first = c.contributors[0];
  const body = {cid: c.contentCid, license: c.license, rightsConfirmed: true, sensitiveData: false, consentVersion: CONSENT_VERSION,
    assetType: 'dataset', contributorDid: first.did, shareBps: first.shareBps, rightsRecord: rightsRecord(c)};
  return {input: API_ORIGIN + OPERATION.endpoint.path, init: {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}};
}

// A test-stage result written by the awai-data-contribution-rewards bot (EDN). Read only: it is shown,
// never paid. Refused unless it says :payout? false and its units add up.
export function importReward(text, now) {
  if (typeof text !== 'string' || text.length > 200000) throw Error('reward.size');
  let r; try { r = parseEdn(text); } catch { throw Error('reward.malformed'); }
  if (!r || typeof r !== 'object' || Array.isArray(r) || r.schema !== RESULT_SCHEMA) throw Error('reward.schema');
  if (r['payout?'] !== false) throw Error('reward.payout');
  if (r['ok?'] !== true || !Array.isArray(r.allocations) || r.allocations.length === 0) throw Error('reward.notOk');
  const units = [r['pool-units'], r['unallocated-units'], ...r.allocations.map(a => a['training/yata-units'])];
  if (!units.every(u => typeof u === 'string' && UNITS.test(u))) throw Error('reward.units');
  const sum = r.allocations.reduce((s, a) => s + BigInt(a['training/yata-units']), BigInt(r['unallocated-units']));
  if (sum !== BigInt(r['pool-units'])) throw Error('reward.units');
  if (!ID.test(r['request/id'] ?? '') || !ID.test(r['epoch/id'] ?? '')) throw Error('reward.schema');
  const allocations = r.allocations.map(a => ({humanId: a['training/human-id'], did: a['training/contributor-did'],
    contributionId: a['training/contribution-id'], shareBps: a['training/share-bps'], yataUnits: a['training/yata-units']}));
  if (allocations.some(a => !ID.test(a.humanId ?? '') || !validDid(a.did) || !ID.test(a.contributionId ?? '') || !Number.isInteger(a.shareBps))) throw Error('reward.schema');
  return {requestId: r['request/id'], epochId: r['epoch/id'], poolUnits: r['pool-units'], unallocatedUnits: r['unallocated-units'],
    allocations, importedAt: now, stage: 'test'};
}

// ---- stored state --------------------------------------------------------------------------------
export const emptyState = () => ({schema: STATE_SCHEMA, contributions: [], rewards: []});
const STATUSES = ['draft', 'submitted', 'withdrawn'];
export function decodeState(data) {
  if (data === null || data === undefined) return emptyState();
  const ok = data && data.schema === STATE_SCHEMA && Array.isArray(data.contributions) && Array.isArray(data.rewards)
    && data.contributions.length <= MAX_CONTRIBUTIONS && data.rewards.length <= MAX_REWARDS
    && data.contributions.every(c => c && ID.test(c.id ?? '') && STATUSES.includes(c.status) && contributionProblems(c).length === 0
      && validCid(c.statementCid) && SHA256.test(c.statementSha256 ?? '') && c.statementCid === cidFromSha256(c.statementSha256))
    && new Set(data.contributions.map(c => c.id)).size === data.contributions.length
    && data.rewards.every(r => r && r.stage === 'test' && Array.isArray(r.allocations));
  if (!ok) throw Error('state-unreadable');
  return data;
}
export function addContribution(state, c) {
  if (contributionProblems(c).length) throw Error('contribution-invalid');
  if (state.contributions.length >= MAX_CONTRIBUTIONS) throw Error('too-many-contributions');
  if (state.contributions.some(x => x.contentSha256 === c.contentSha256 && x.status !== 'withdrawn')) throw Error('duplicate-content');
  return {...state, contributions: [...state.contributions, {...c, status: 'draft'}]};
}
const update = (state, id, f) => {
  if (!state.contributions.some(c => c.id === id)) throw Error('unknown-contribution');
  return {...state, contributions: state.contributions.map(c => c.id === id ? f(c) : c)};
};
// outcome: {status: <HTTP status> | null, error: <code> | null}. Only a 2xx marks it submitted.
export const recordSubmission = (state, id, outcome, now) => update(state, id, c => {
  if (c.status !== 'draft') throw Error('not-a-draft');
  const accepted = Number.isInteger(outcome.status) && outcome.status >= 200 && outcome.status < 300;
  return {...c, status: accepted ? 'submitted' : 'draft', lastAttempt: {at: now, status: outcome.status ?? null, error: outcome.error ?? null}, ...(accepted ? {submittedAt: now} : {})};
});
// Withdrawal is recorded here at once. Epochs that start later must not use the item (ADR-261118);
// telling the server is a planned operation, and allocations of earlier epochs stand.
export const withdraw = (state, id, now) => update(state, id, c => {
  if (c.status === 'withdrawn') throw Error('already-withdrawn');
  return {...c, status: 'withdrawn', withdrawnAt: now};
});
export function addReward(state, reward) {
  if (state.rewards.length >= MAX_REWARDS) throw Error('too-many-rewards');
  const rest = state.rewards.filter(r => !(r.requestId === reward.requestId && r.epochId === reward.epochId));
  return {...state, rewards: [...rest, reward]};
}
