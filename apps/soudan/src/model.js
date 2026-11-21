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
  event: 300, document: 200, timeline: 20, documents: 20, office: 200});

export function emptyDraft() {
  return {jurisdiction: null, category: null, summary: '', timeline: [], otherParty: '', wish: '', deadline: '', documents: [],
    name: '', contact: '', recipient: {name: '', office: '', contact: ''}};
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
  if (data.recipient && typeof data.recipient === 'object') for (const k of ['name', 'office', 'contact'])
    if (typeof data.recipient[k] === 'string') d.recipient[k] = data.recipient[k];
  return d;
}
