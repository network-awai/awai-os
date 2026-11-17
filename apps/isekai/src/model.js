// Isekai game-fork commit drafts. Pure functions: no network, publishing or payment.
// The commit shape follows network-awai/network-isekai src/isekai/fork_git.cljk
// (commit-fork: :parents = parent fork commit CIDs, [] for a root game; :author =
// the creator's did:key; :message). The tree CID is computed when the fork is
// published, so a draft carries no tree and no commit CID.
export const STATE_SCHEMA = 'itonami.isekai.drafts.v1';
export const DRAFT_SCHEMA = 'isekai.fork.commit-draft.v1';
export const MAX_DRAFTS = 50;
export const MAX_MESSAGE = 200;

// External operations this app will need later. Declared here for display only:
// none is in the runtime descriptor, so the broker cannot perform any of them.
export const PLANNED_OPERATIONS = Object.freeze([
  {id: 'kotobase.publish', service: 'kotoba-git on kotobase (Isekai fork ledger)', data: ['fork commit', 'scene and logic bundle', 'did:key signature']},
  {id: 'x402.pay', service: 'x402.nexus facilitator', data: ['signed payment payload']},
  {id: 'gem.mint', service: 'isekai.network gem economy', data: ['fork commit CID', 'did:key']}
].map(Object.freeze));

const GAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CID = /^b[a-z2-7]{50,100}$/;                       // CIDv1, base32 lower-case
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,60}$/;  // multibase base58btc

export function gameProblem(game) {
  return GAME.test(String(game ?? '').trim()) ? null : 'game.format';
}
export function parentProblem(parent) {
  const s = String(parent ?? '').trim();
  return !s || CID.test(s) ? null : 'parent.format';
}
export function authorProblem(author) {
  return DID_KEY.test(String(author ?? '').trim()) ? null : 'author.format';
}
export function messageProblem(message) {
  const s = String(message ?? '').trim();
  if (!s) return 'message.empty';
  return s.length > MAX_MESSAGE ? 'message.long' : null;
}

/** Build one fork commit draft. Returns {draft} or {problems}. */
export function buildDraft({game, parent = '', author, message}) {
  const problems = [gameProblem(game), parentProblem(parent), authorProblem(author), messageProblem(message)].filter(Boolean);
  if (problems.length) return {problems};
  const p = String(parent).trim();
  return {draft: {schema: DRAFT_SCHEMA, game: String(game).trim(), parents: p ? [p] : [], author: String(author).trim(),
    message: String(message).trim(), moderation: 'pending', published: false}};
}

export function draftProblems(d) {
  if (!d || typeof d !== 'object') return ['draft.shape'];
  const problems = [];
  if (d.schema !== DRAFT_SCHEMA) problems.push('draft.schema');
  if (gameProblem(d.game)) problems.push('draft.game');
  if (!Array.isArray(d.parents) || d.parents.length > 1 || d.parents.some(x => parentProblem(x) || !x)) problems.push('draft.parents');
  if (authorProblem(d.author)) problems.push('draft.author');
  if (messageProblem(d.message)) problems.push('draft.message');
  if (d.moderation !== 'pending' || d.published !== false) problems.push('draft.state');
  return problems;
}

// ---- local state ----
export const emptyState = () => ({schema: STATE_SCHEMA, drafts: []});
export function decodeState(data) {
  if (data === null || data === undefined) return emptyState();
  if (data?.schema !== STATE_SCHEMA || !Array.isArray(data.drafts)) throw Error('unreadable-drafts');
  for (const e of data.drafts) {
    if (typeof e?.id !== 'string' || typeof e.createdAt !== 'string' || draftProblems(e.draft).length) throw Error('unreadable-drafts');
  }
  return {schema: STATE_SCHEMA, drafts: data.drafts.slice(0, MAX_DRAFTS)};
}
export function addDraft(state, draft, {id, now}) {
  if (draftProblems(draft).length) throw Error('invalid-draft');
  if (state.drafts.length >= MAX_DRAFTS) throw Error('too-many-drafts');
  return {schema: STATE_SCHEMA, drafts: [{id, createdAt: now, draft}, ...state.drafts]};
}
export const removeDraft = (state, id) => ({schema: STATE_SCHEMA, drafts: state.drafts.filter(e => e.id !== id)});
