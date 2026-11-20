// Full text of a law, fetched from Awai FS (the yataverse.com bytes plane) only after the user approves
// that one request (AWAI-3316, AWAI-3324). A law names its text by sha256. The CIDv1 (raw, sha2-256) is
// derived from that hash, so no lookup is needed. Bytes are shown or kept only when their sha256 and size
// match the law's record. On the device they are kept in the host's Awai FS block store.
export const GATEWAY = 'https://yataverse.com';
export const SELECTOR = Object.freeze({capability: 'itonami.horei.fulltext', service: 'awai.fs', operation: 'read-law-text'});
// yataverse.com serves blocks itself and never redirects, so no redirect origin is declared.
export const OPERATION = Object.freeze({...SELECTOR, endpoint: {origin: GATEWAY, routes: [{method: 'GET', 'path-prefix': '/ipfs/', 'query-params': ['format'], 'query-values': {format: 'raw'}}]},
  'data-categories': ['public-law-text-cid'], consent: 'each-operation'});
export function runtimeDescriptor() {
  return {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
    'local-state': {adapter: 'memory', schema: 'itonami.horei.state.v1', version: 1}, workers: [], operations: [OPERATION]};
}

const SHA256 = /^[0-9a-f]{64}$/;
export function cidFromSha256(hex) {
  if (!SHA256.test(hex)) throw Error('invalid-sha256');
  const bytes = [0x01, 0x55, 0x12, 0x20, ...hex.match(/../g).map(h => parseInt(h, 16))];
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let out = 'b', value = 0, bits = 0;
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export const requestUrl = cid => `${GATEWAY}/ipfs/${cid}?format=raw`;
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(bytes) { return hex(await crypto.subtle.digest('SHA-256', bytes)); }

async function readBounded(response, limit) {
  const reader = response.body.getReader(), parts = []; let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw Error('mismatch'); }
    parts.push(value);
  }
  const out = new Uint8Array(size); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}
async function matches(law, bytes) { return bytes.byteLength === law.textBytes && await sha256Hex(bytes) === law.textSha256; }

// invoke: the canonical broker's invoke (it shows consent and throws on denial before any request).
// cache: {get(cid) -> Uint8Array|null, put(cid, bytes)}.
// timeoutMs bounds the whole call, including the time the consent dialog is open; a timeout reports 'unavailable'.
export function createFullText({invoke, cache, timeoutMs = 90000}) {
  return {
    async cached(law) {
      const cid = cidFromSha256(law.textSha256), bytes = await cache.get(cid);
      if (!bytes) return null;
      if (await matches(law, bytes)) return {cid, bytes, source: 'cache'};
      await cache.delete(cid);
      return null;
    },
    async fetch(law) {
      const hit = await this.cached(law);
      if (hit) return hit;
      const cid = cidFromSha256(law.textSha256);
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      let bytes;
      try {
        const response = await invoke(SELECTOR, {input: requestUrl(cid), init: {headers: {Accept: 'application/vnd.ipld.raw'}}}, {signal: controller.signal});
        if (!response.ok) { await response.body?.cancel(); throw Error(response.status === 404 ? 'absent' : 'unavailable'); }
        bytes = await readBounded(response, law.textBytes);
      } catch (e) { throw timedOut ? Error('unavailable') : e; } finally { clearTimeout(timer); }
      if (!await matches(law, bytes)) throw Error('mismatch');
      await cache.put(cid, bytes);
      return {cid, bytes, source: 'network'};
    }};
}

// Awai FS block store in the Tauri host (src-tauri/src/awai_fs.rs). The host recomputes the CID on every put
// and get, refuses bytes that do not match and deletes a damaged block instead of returning it.
export function awaiFsCache(invoke) {
  return {
    async get(cid) { const b = new Uint8Array(await invoke('awai_fs_get', {cid})); return b.byteLength ? b : null; },
    put: (cid, bytes) => invoke('awai_fs_put', bytes, {headers: {'x-awai-cid': cid}}),
    delete: cid => invoke('awai_fs_delete', {cid})};
}
// Outside the Tauri host there is no Awai FS: texts are kept only for this page session.
export function memoryCache() {
  const m = new Map();
  return {persistent: false, get: async c => m.get(c) ?? null, put: async (c, b) => { m.set(c, b); }, delete: async c => { m.delete(c); }};
}

// e-Gov API v2 law_data: law_full_text is an element tree {tag, attr, children}. Flatten it to text,
// ending a line after block elements. Never parsed as HTML.
const BLOCK = new Set(['LawNum', 'LawTitle', 'EnactStatement', 'TOC', 'TOCChapter', 'TOCSection', 'TOCArticle', 'TOCSupplProvision', 'Preamble',
  'Part', 'PartTitle', 'Chapter', 'ChapterTitle', 'Section', 'SectionTitle', 'Subsection', 'SubsectionTitle', 'Division', 'DivisionTitle',
  'Article', 'ArticleCaption', 'ArticleTitle', 'Paragraph', 'ParagraphCaption', 'Item', 'Subitem1', 'Subitem2', 'Subitem3', 'Subitem4', 'Subitem5',
  'SupplProvision', 'SupplProvisionLabel', 'AppdxTable', 'AppdxTableTitle', 'TableRow', 'Remarks', 'List', 'Sentence']);
const LABEL = /^(?:ArticleTitle|ParagraphNum|ItemTitle|Subitem\dTitle)$/;
export function lawText(bytes) {
  let doc;
  try { doc = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); } catch { throw Error('format'); }
  const root = doc?.law_full_text;
  if (!root || typeof root !== 'object') throw Error('format');
  const out = [];
  const walk = (node, depth) => {
    if (depth > 64) throw Error('format');
    if (typeof node === 'string') { out.push(node); return; }
    if (!node || typeof node !== 'object') return;
    const start = out.length;
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child, depth + 1);
    if (LABEL.test(node.tag ?? '')) { if (out.length > start) out.push('\u3000'); }
    else if (BLOCK.has(node.tag) && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
  };
  walk(root, 0);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}
