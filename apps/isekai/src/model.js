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

// ---- multiformats: decode, not just match the alphabet ----
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** RFC 4648 base32, lower-case, no padding. null when not decodable. */
export function base32Decode(text) {
  const out = []; let bits = 0, value = 0;
  for (const ch of text) {
    const i = B32.indexOf(ch); if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 0xff); }
  }
  if (bits >= 5 || (value & ((1 << bits) - 1)) !== 0) return null;   // non-canonical tail
  return Uint8Array.from(out);
}
/** Bitcoin base58. null when not decodable. */
export function base58Decode(text) {
  let n = 0n;
  for (const ch of text) { const i = B58.indexOf(ch); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of text) { if (ch !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}
/** Unsigned varint at offset; [value, nextOffset] or null. */
function varint(bytes, at) {
  let value = 0, shift = 0;
  for (let i = at; i < bytes.length && i < at + 4; i++) {
    value |= (bytes[i] & 0x7f) << shift;
    if (!(bytes[i] & 0x80)) return [value, i + 1];
    shift += 7;
  }
  return null;
}
// Content codecs a fork block may use (raw, dag-pb, dag-cbor, dag-json) and the
// sha2-256 multihash that kotoba-git blocks use.
const CID_CODECS = new Set([0x55, 0x70, 0x71, 0x0129]);
const SHA2_256 = 0x12;
/** true for a CIDv1 in base32 ("b…") with a known codec and a sha2-256 digest. */
export function isCidV1(text) {
  if (!/^b[a-z2-7]+$/.test(text)) return false;
  const bytes = base32Decode(text.slice(1)); if (!bytes || bytes[0] !== 1) return false;
  const codec = varint(bytes, 1); if (!codec || !CID_CODECS.has(codec[0])) return false;
  const hash = varint(bytes, codec[1]); if (!hash || hash[0] !== SHA2_256) return false;
  const len = varint(bytes, hash[1]);
  return !!len && len[0] === 32 && bytes.length === len[1] + 32;
}
// did:key public-key multicodecs and their key lengths: ed25519, secp256k1 and
// P-256 (compressed).
const DID_KEY_CODECS = new Map([[0xed, 32], [0xe7, 33], [0x1200, 33]]);
/** true for did:key:z… whose base58btc payload is a known key multicodec of the right length. */
export function isDidKey(text) {
  const m = /^did:key:z([1-9A-HJ-NP-Za-km-z]+)$/.exec(text); if (!m) return false;
  const bytes = base58Decode(m[1]); if (!bytes) return false;
  const codec = varint(bytes, 0); if (!codec || !DID_KEY_CODECS.has(codec[0])) return false;
  return bytes.length - codec[1] === DID_KEY_CODECS.get(codec[0]);
}

export function gameProblem(game) {
  return GAME.test(String(game ?? '').trim()) ? null : 'game.format';
}
export function parentProblem(parent) {
  const s = String(parent ?? '').trim();
  return !s || isCidV1(s) ? null : 'parent.format';
}
export function authorProblem(author) {
  return isDidKey(String(author ?? '').trim()) ? null : 'author.format';
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
