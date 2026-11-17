// x402 payment requirement drafts. Pure functions: no network, wallet or signing.
// The wire shape follows network-awai/nexus-x402 src/nexus/discovery.cljk
// (PaymentRequirements: scheme "transaction", network "base"|"base-sepolia",
// maxAmountRequired in USDC base units, 6 decimals). This app drafts Base Sepolia only.
export const STATE_SCHEMA = 'itonami.x402.drafts.v1';
export const NETWORK = Object.freeze({id: 'base-sepolia', chainId: 84532, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', testMoney: true});
export const SCHEME = 'transaction';
export const DECIMALS = 6;
export const MAX_MICROS = 1000n * 10n ** 6n;   // USD 1,000 ceiling for a draft
export const MAX_DRAFTS = 50;
export const MAX_TIMEOUT_SECONDS = 300;
const ZERO = '0x0000000000000000000000000000000000000000';

// External operations this app will need later. Declared here for display only:
// none is in the runtime descriptor, so the broker cannot perform any of them.
export const PLANNED_OPERATIONS = Object.freeze([
  {id: 'seller.challenge', service: 'seller resource (HTTP 402)', data: ['payment requirement']},
  {id: 'wallet.sign', service: "the user's own wallet", data: ['payTo', 'amount', 'network']},
  {id: 'facilitator.verify-settle', service: 'x402.nexus facilitator', data: ['signed payment payload']}
].map(Object.freeze));

/** "0.01" -> "10000". Returns {micros} or {error}. */
export function parseUsd(text) {
  const s = String(text ?? '').trim();
  if (!s) return {error: 'amount.empty'};
  const m = /^(\d{1,7})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return {error: 'amount.format'};
  const micros = BigInt(m[1]) * 10n ** 6n + BigInt((m[2] ?? '').padEnd(DECIMALS, '0'));
  if (micros <= 0n) return {error: 'amount.zero'};
  if (micros > MAX_MICROS) return {error: 'amount.max'};
  return {micros: micros.toString()};
}
/** "10000" -> "0.01" */
export function formatUsd(micros) {
  const v = BigInt(micros), whole = v / 10n ** 6n, frac = (v % 10n ** 6n).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
export function payToProblem(address) {
  const s = String(address ?? '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return 'payTo.format';
  if (s.toLowerCase() === ZERO) return 'payTo.zero';
  return null;
}
export function resourceProblem(resource) {
  const s = String(resource ?? '').trim();
  if (!s) return 'resource.empty';
  if (s.length > 512 || /\s/.test(s)) return 'resource.format';
  if (s.startsWith('/') && !s.startsWith('//')) return null;
  try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? null : 'resource.format'; } catch { return 'resource.format'; }
}

/** Build one PaymentRequirements entry. Returns {requirement} or {problems}. */
export function buildRequirement({amount, payTo, resource, description = ''}) {
  const problems = [];
  const price = parseUsd(amount); if (price.error) problems.push(price.error);
  const p = payToProblem(payTo); if (p) problems.push(p);
  const r = resourceProblem(resource); if (r) problems.push(r);
  const d = String(description).trim(); if (d.length > 200) problems.push('description.long');
  if (problems.length) return {problems};
  const requirement = {scheme: SCHEME, network: NETWORK.id, payTo: String(payTo).trim(), maxAmountRequired: price.micros,
    asset: NETWORK.usdc, resource: String(resource).trim(), mimeType: 'application/json', maxTimeoutSeconds: MAX_TIMEOUT_SECONDS};
  if (d) requirement.description = d;
  return {requirement};
}
/** The 402 response body a seller would return for this requirement. */
export const challenge = requirement => ({x402Version: 1, accepts: [requirement]});

export function requirementProblems(q) {
  if (!q || typeof q !== 'object') return ['requirement.shape'];
  const problems = [];
  if (q.scheme !== SCHEME) problems.push('requirement.scheme');
  if (q.network !== NETWORK.id) problems.push('requirement.network');
  if (q.asset !== NETWORK.usdc) problems.push('requirement.asset');
  if (payToProblem(q.payTo)) problems.push('requirement.payTo');
  if (typeof q.maxAmountRequired !== 'string' || !/^[1-9][0-9]*$/.test(q.maxAmountRequired) || BigInt(q.maxAmountRequired) > MAX_MICROS) problems.push('requirement.amount');
  if (resourceProblem(q.resource)) problems.push('requirement.resource');
  return problems;
}

// ---- local state ----
export const emptyState = () => ({schema: STATE_SCHEMA, drafts: []});
export function decodeState(data) {
  if (data === null || data === undefined) return emptyState();
  if (data?.schema !== STATE_SCHEMA || !Array.isArray(data.drafts)) throw Error('unreadable-drafts');
  for (const d of data.drafts) {
    if (typeof d?.id !== 'string' || typeof d.createdAt !== 'string' || requirementProblems(d.requirement).length) throw Error('unreadable-drafts');
  }
  return {schema: STATE_SCHEMA, drafts: data.drafts.slice(0, MAX_DRAFTS)};
}
export function addDraft(state, requirement, {id, now}) {
  if (requirementProblems(requirement).length) throw Error('invalid-requirement');
  if (state.drafts.length >= MAX_DRAFTS) throw Error('too-many-drafts');
  return {schema: STATE_SCHEMA, drafts: [{id, createdAt: now, requirement}, ...state.drafts]};
}
export const removeDraft = (state, id) => ({schema: STATE_SCHEMA, drafts: state.drafts.filter(d => d.id !== id)});
