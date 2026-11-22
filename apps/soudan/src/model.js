// Soudan: put a user's own consultation into a fixed memo template, on the device (AWAI-3321, parent AWAI-3236).
// ADR 0001 (cloud-itonami-isic-6910-legalsupport) D1 and D9 bound this module:
// - template-selection and document-assembly only. The memo repeats what the user typed under fixed headings.
//   Nothing here analyses the matter, rates a risk or proposes wording.
// - The lawyer the memo goes to is typed by the user. This module holds no list of lawyers and never suggests one.
// - No default jurisdiction (owner decision O7 is open). Only jurisdictions with a template can be chosen.

export const JURISDICTIONS = Object.freeze({JPN: Object.freeze({template: 'consultation-memo.jpn.v1'})});
// Categories only pick the memo's heading wording (template selection). They do not change what is said about the matter.
export const CATEGORIES = Object.freeze(['money', 'contract', 'work', 'family', 'housing', 'traffic', 'other']);
export const LIMITS = Object.freeze({summary: 2000, wish: 1000, deadline: 500, otherParty: 200, name: 100, contact: 200,
  event: 300, document: 200, timeline: 20, documents: 20, office: 200,
  evidence: 30, evidenceUrl: 2000, evidenceField: 200, evidenceFile: 20971520});

export function emptyDraft() {
  return {jurisdiction: null, category: null, summary: '', timeline: [], otherParty: '', wish: '', deadline: '', documents: [],
    evidence: [], name: '', contact: '', recipient: {name: '', office: '', contact: ''}};
}

// One evidence row: only what the user typed or picked (O11 scope 3). The app never judges
// whether the post is infringing or whether disclosure 5(1) items apply, and never writes
// petition text. capturedAt/sha256 are recorded when the user picks an image; the image bytes
// themselves are not persisted (the host state bound is 128KB and the app holds no filesystem
// permission), so the original stays in the user's own device storage.
export function newEvidence() {
  return {url: '', postedAt: '', authorName: '', authorId: '', shotName: '', shotSize: 0, sha256: '', capturedAt: ''};
}

const text = (v, max) => typeof v === 'string' && [...v].length <= max;
const filled = v => typeof v === 'string' && v.trim().length > 0;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(v) {
  if (v === '') return true;
  if (!DATE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
// Posting date-time the user typed: '' or a calendar date, or a datetime-local value
// (YYYY-MM-DDTHH:mm). No remaining-days arithmetic is ever derived from it.
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
function validPostedAt(v) {
  if (v === '') return true;
  if (DATE.test(v)) return validDate(v);
  const m = DATETIME.exec(v);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return false;
  const dt = new Date(y, mo - 1, d, h, mi);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && dt.getHours() === h && dt.getMinutes() === mi;
}
function validEvidenceUrl(v) {
  if (typeof v !== 'string') return false;
  const n = [...v].length;
  if (n === 0 || n > LIMITS.evidenceUrl) return false;
  return /^https?:\/\/\S+$/u.test(v);
}
const SHA256 = /^[0-9a-f]{64}$/;
function validShot(e) {
  if (!e || typeof e !== 'object') return false;
  if (typeof (e.shotName ?? '') !== 'string' || [...(e.shotName ?? '')].length > LIMITS.evidenceField) return false;
  if (!Number.isSafeInteger(e.shotSize ?? 0) || (e.shotSize ?? 0) < 0) return false;
  const h = e.sha256 ?? '';
  if (h !== '' && (typeof h !== 'string' || !SHA256.test(h))) return false;
  return true;
}
function validCapturedAt(v) {
  if (v === '' || v == null) return true;
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}
const shortText = (v, max) => typeof v === 'string' && [...v].length <= max;

// Problems as stable message keys, in form order. An empty list means the memo can be assembled.
export function draftProblems(d) {
  const p = [];
  if (!d || typeof d !== 'object') return ['draft.invalid'];
  if (!Object.hasOwn(JURISDICTIONS, d.jurisdiction ?? '')) p.push('jurisdiction.required');
  if (!CATEGORIES.includes(d.category)) p.push('category.required');
  if (!filled(d.summary)) p.push('summary.required'); else if (!text(d.summary, LIMITS.summary)) p.push('summary.tooLong');
  if (!Array.isArray(d.timeline) || d.timeline.length > LIMITS.timeline) p.push('timeline.tooMany');
  else for (const e of d.timeline) {
    if (!e || typeof e !== 'object' || !validDate(e.date ?? '')) { p.push('timeline.date'); break; }
    if (!filled(e.event) || !text(e.event, LIMITS.event)) { p.push('timeline.event'); break; }
  }
  if (!text(d.otherParty ?? '', LIMITS.otherParty)) p.push('otherParty.tooLong');
  if (!filled(d.wish)) p.push('wish.required'); else if (!text(d.wish, LIMITS.wish)) p.push('wish.tooLong');
  if (!text(d.deadline ?? '', LIMITS.deadline)) p.push('deadline.tooLong');
  if (!Array.isArray(d.documents) || d.documents.length > LIMITS.documents) p.push('documents.tooMany');
  else if (d.documents.some(x => !filled(x) || !text(x, LIMITS.document))) p.push('documents.item');
  // Evidence rows (O11 scope 3): every row needs its URL; the rest is optional but shaped.
  if (!Array.isArray(d.evidence) || d.evidence.length > LIMITS.evidence) p.push('evidence.tooMany');
  else for (const e of d.evidence) {
    if (!e || typeof e !== 'object' || !validEvidenceUrl((e.url ?? '').trim())) { p.push('evidence.urlProblem'); break; }
    if (!validPostedAt(e.postedAt ?? '')) { p.push('evidence.postedAtProblem'); break; }
    if (!shortText(e.authorName ?? '', LIMITS.evidenceField) || !shortText(e.authorId ?? '', LIMITS.evidenceField)) { p.push('evidence.authorProblem'); break; }
    if (!validShot(e)) { p.push('evidence.shotProblem'); break; }
    if (!validCapturedAt(e.capturedAt ?? '')) { p.push('evidence.capturedAtProblem'); break; }
  }
  if (!filled(d.name) || !text(d.name, LIMITS.name)) p.push('name.required');
  if (!filled(d.contact) || !text(d.contact, LIMITS.contact)) p.push('contact.required');
  return p;
}

// The lawyer is whoever the user names. Only shape is checked; nothing is looked up.
export function recipientProblems(r) {
  const p = [];
  if (!r || typeof r !== 'object') return ['recipient.invalid'];
  if (!filled(r.name) || !text(r.name, LIMITS.name)) p.push('recipient.nameProblem');
  if (!text(r.office ?? '', LIMITS.office)) p.push('recipient.officeProblem');
  if (!filled(r.contact) || !text(r.contact, LIMITS.contact)) p.push('recipient.contactProblem');
  return p;
}

// One evidence row as memo lines: fixed labels plus the user's own words. No judgment
// wording is added here: whether anything is infringing or meets any disclosure condition
// is never stated, and no petition text is produced.
export function formatEvidence(list, t) {
  const none = t('evidence.f.none');
  return list.map((e, i) => {
    const lines = ['(' + (i + 1) + ') ' + t('evidence.f.url') + ': ' + (e.url ?? '').trim()];
    lines.push(t('evidence.f.postedAt') + ': ' + ((e.postedAt ?? '').trim() || none));
    lines.push(t('evidence.f.author') + ': ' + (((e.authorName ?? '').trim()) || none) +
      ' / ' + t('evidence.f.id') + ': ' + (((e.authorId ?? '').trim()) || none));
    const shot = (e.shotName ?? '').trim();
    lines.push(t('evidence.f.shot') + ': ' + (shot ? shot + ' (' + e.shotSize + ' ' + t('evidence.f.bytes') + ')' : none));
    lines.push(t('evidence.f.capturedAt') + ': ' + (((e.capturedAt ?? '').trim()) || none) +
      ' / SHA-256: ' + (((e.sha256 ?? '').trim()) || none));
    return lines.join('\n');
  }).join('\n');
}

// Assemble the memo: fixed headings (by key) filled with the user's own words, in a fixed order.
// t translates the heading keys; user text is copied as typed (trimmed), never rewritten.
export function assembleMemo(d, t) {
  const problems = draftProblems(d);
  if (problems.length) throw Object.assign(Error('draft-incomplete'), {problems});
  const sections = [];
  const add = (key, body) => { if (body) sections.push({heading: t(key), body}); };
  add('memo.category', t('category.' + d.category));
  add('memo.summary', d.summary.trim());
  add('memo.timeline', d.timeline.map(e => (e.date ? e.date + '　' : '') + e.event.trim()).join('\n'));
  add('memo.otherParty', d.otherParty.trim());
  add('memo.wish', d.wish.trim());
  add('memo.deadline', d.deadline.trim());
  add('memo.documents', d.documents.map(x => '・' + x.trim()).join('\n'));
  if (Array.isArray(d.evidence) && d.evidence.length) add('memo.evidence', formatEvidence(d.evidence, t));
  add('memo.from', [d.name.trim(), d.contact.trim()].join('\n'));
  const title = t('memo.title', {category: t('category.' + d.category)});
  const notice = t('memo.notice');
  const textOut = [title, '', ...sections.flatMap(s => ['■ ' + s.heading, s.body, '']), notice].join('\n');
  return {template: JURISDICTIONS[d.jurisdiction].template, title, sections, notice, text: textOut};
}

// The sent body heads with the destination line: the lawyer the user typed,
// nothing else (ADR D9: user-typed only, no list, no suggestion, no lookup).
// User text is copied as typed (trimmed), never rewritten or translated.
export function addressedMemo(memoText, recipient, t) {
  const parts = [recipient?.name, recipient?.office, recipient?.contact]
    .map(v => (typeof v === 'string' ? v.trim() : '')).filter(v => v.length > 0);
  return t('memo.to') + ': ' + parts.join(' / ') + '\n' + memoText;
}

// Restore a stored draft, keeping only known fields of the right type. Anything else starts empty.
export function restoreDraft(data) {
  const d = emptyDraft();
  if (!data || typeof data !== 'object') return d;
  for (const k of ['summary', 'otherParty', 'wish', 'deadline', 'name', 'contact']) if (typeof data[k] === 'string') d[k] = data[k];
  if (Object.hasOwn(JURISDICTIONS, data.jurisdiction ?? '')) d.jurisdiction = data.jurisdiction;
  if (CATEGORIES.includes(data.category)) d.category = data.category;
  if (Array.isArray(data.timeline)) d.timeline = data.timeline.slice(0, LIMITS.timeline)
    .filter(e => e && typeof e.date === 'string' && typeof e.event === 'string').map(e => ({date: e.date, event: e.event}));
  if (Array.isArray(data.documents)) d.documents = data.documents.slice(0, LIMITS.documents).filter(x => typeof x === 'string');
  if (Array.isArray(data.evidence)) d.evidence = data.evidence.slice(0, LIMITS.evidence)
    .filter(e => e && typeof e === 'object')
    .map(e => ({url: typeof e.url === 'string' ? e.url : '', postedAt: typeof e.postedAt === 'string' ? e.postedAt : '',
      authorName: typeof e.authorName === 'string' ? e.authorName : '', authorId: typeof e.authorId === 'string' ? e.authorId : '',
      shotName: typeof e.shotName === 'string' ? e.shotName : '', shotSize: Number.isSafeInteger(e.shotSize) && e.shotSize >= 0 ? e.shotSize : 0,
      sha256: typeof e.sha256 === 'string' ? e.sha256 : '', capturedAt: typeof e.capturedAt === 'string' ? e.capturedAt : ''}));
  if (data.recipient && typeof data.recipient === 'object') for (const k of ['name', 'office', 'contact'])
    if (typeof data.recipient[k] === 'string') d.recipient[k] = data.recipient[k];
  return d;
}

// SHA-256 over bytes, dependency-free (works in the page, in tests, and where
// SubtleCrypto is unavailable). Used only to fingerprint a screenshot the user picked;
// the digest is recorded next to the URL and the capture time for later comparison.
const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
export function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw TypeError('bytes-required');
  const l = bytes.length, bitLen = l * 8;
  const withPad = (((l + 8) >> 6) + 1) * 64, msg = new Uint8Array(withPad);
  msg.set(bytes); msg[l] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(withPad - 4, bitLen >>> 0); dv.setUint32(withPad - 8, Math.floor(bitLen / 0x100000000));
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
