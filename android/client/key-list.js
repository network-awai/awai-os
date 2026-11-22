// The Store's signed key list, itonami.store.keys.v1 (AWAI-3774, AWAI-3775).
//
// Same rules and the same refusal codes as android/shared/src/network/awai/platform/KeyList.java.
// android/tests/key-list-vectors.tsv is checked by both implementations (KeyListVectorsTest.java and
// key-list.test.mjs). Runs in the browser and in Node (Web Crypto). Verification grants nothing.
export const SCHEMA = 'itonami.store.keys.v1';
export const CATALOG = 'catalog', POINTER = 'pointer';
export const MAX_BYTES = 16384, MAX_KEYS_PER_ROLE = 4, MIN_KEY_BITS = 2048;
export const MAX_LIFETIME_SECONDS = 190 * 24 * 60 * 60, CLOCK_SKEW_SECONDS = 300;

const ALGORITHM = {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'};
const refuse = code => { const e = new Error(code); e.code = code; throw e; };
const subtle = () => globalThis.crypto.subtle;

export function base64Bytes(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
function bytesBase64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function same(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }
async function sha256(bytes) { return bytesBase64(new Uint8Array(await subtle().digest('SHA-256', bytes))); }

// An RSA public key and its modulus length, or null when the bytes are not one.
async function rsa(spki) {
  try {
    const key = await subtle().importKey('spki', spki, ALGORITHM, false, ['verify']);
    return key.algorithm?.name === 'RSASSA-PKCS1-v1_5' ? key : null;
  } catch { return null; }
}

async function signedBy(key, signature, data) {
  try { return await subtle().verify('RSASSA-PKCS1-v1_5', key, signature, data); } catch { return false; }
}

function number(line, prefix) {
  if (!line.startsWith(prefix)) refuse('keys-format');
  const digits = line.slice(prefix.length);
  // Plain decimal, no sign, no leading zero, at most 15 digits.
  if (!/^[1-9][0-9]{0,14}$/.test(digits)) refuse('keys-number');
  return Number(digits);
}

/**
 * Verifies raw (bytes) with the root's signature (bytes) against rootSpki (bytes).
 * Returns {sequence, issuedAt, expiresAt, keys: {catalog: [CryptoKey], pointer: [CryptoKey]}}.
 * Every refusal is an Error whose message (and .code) is the same code KeyList.java uses.
 */
export async function verifyKeyList(raw, signature, rootSpki, now, sequenceFloor) {
  if (!raw || raw.length < 1 || raw.length > MAX_BYTES || !signature || !rootSpki) refuse('keys-size');
  const root = await rsa(rootSpki);
  if (!root || root.algorithm.modulusLength < MIN_KEY_BITS || !await signedBy(root, signature, raw)) refuse('keys-signature');
  for (const b of raw) if (b !== 0x0a && (b < 0x20 || b > 0x7e)) refuse('keys-format');
  if (raw[raw.length - 1] !== 0x0a) refuse('keys-format');
  const lines = new TextDecoder('ascii').decode(raw.subarray(0, raw.length - 1)).split('\n');
  if (lines.length < 4) refuse('keys-format');
  if (lines[0] !== SCHEMA) refuse('keys-schema');
  const sequence = number(lines[1], 'sequence '), issuedAt = number(lines[2], 'issued '), expiresAt = number(lines[3], 'expires ');
  if (sequence < 1 || sequence < sequenceFloor) refuse('keys-rollback');
  if (issuedAt < 1 || issuedAt > now + CLOCK_SKEW_SECONDS) refuse('keys-issued');
  if (expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_SECONDS) refuse('keys-expired');
  const keys = {[CATALOG]: [], [POINTER]: []};
  const seen = new Set();
  let previous = CATALOG;
  for (const line of lines.slice(4)) {
    const part = line.split(' ');
    if (part.length !== 3 || part[0] !== 'key') refuse('keys-format');
    const role = part[1];
    // Catalog keys first, then pointer keys: one spelling per list.
    if (!Object.hasOwn(keys, role) || (role === CATALOG && previous === POINTER)) refuse('keys-role');
    previous = role;
    let spki;
    try { spki = base64Bytes(part[2]); } catch { refuse('keys-key'); }
    if (bytesBase64(spki) !== part[2]) refuse('keys-key');
    const key = await rsa(spki);
    if (!key || key.algorithm.modulusLength < MIN_KEY_BITS) refuse('keys-key');
    // One key, one role: a key listed twice, in the same role or in both, is refused.
    const digest = await sha256(spki);
    if (seen.has(digest)) refuse('keys-duplicate');
    seen.add(digest);
    if (same(spki, rootSpki)) refuse('keys-duplicate');
    keys[role].push(key);
  }
  for (const role of Object.values(keys)) if (role.length < 1 || role.length > MAX_KEYS_PER_ROLE) refuse('keys-count');
  return {sequence, issuedAt, expiresAt, keys};
}

/** True when a key listed for this role signed the data (bytes). Unknown roles are never authentic. */
export async function authentic(list, role, data, signature) {
  if (!list || !Object.hasOwn(list.keys, role) || !data || !signature) return false;
  for (const key of list.keys[role]) if (await signedBy(key, signature, data)) return true;
  return false;
}
