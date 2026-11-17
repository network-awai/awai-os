// Payment instruction drafts (ISO 20022 pain.001.001.09) for the account
// holder's own transfers. Pure functions: no network, bank connection or signing.
//
// The XML is the element subset that kotoba-lang/kotoba lib/kotoba.swift
// (kotoba.swift.iso20022/pain001-doc + xml->str) emits, byte for byte, so a
// draft made here and one made by the awai-banking-ops itonami profile are the
// same document (test/fixtures holds the profile's fixture). The checks are
// ADR 0042 level L1 (the XSD facets and element order of that subset). L2
// (usage guidelines such as CBPR+) and L3 (acceptance by a bank) are not
// checked here; they wait on the owner decisions O3 and O5.
export const STATE_SCHEMA = 'itonami.paymentdrafts.drafts.v1';
export const MESSAGE_ID = 'pain.001.001.09';
export const NAMESPACE = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09';
export const MAX_DRAFTS = 50;
export const CHARGE_BEARERS = Object.freeze(['SLEV', 'SHAR', 'DEBT', 'CRED']);
// Currencies drafted without minor units; every other currency uses 2 decimals.
const ZERO_DECIMAL = new Set(['JPY', 'KRW']);

// External operations a later version may need. Declared for display only:
// none is in the runtime descriptor, so the broker cannot perform any of them.
export const PLANNED_OPERATIONS = Object.freeze([
  {id: 'bank.submit', service: "the holder's own bank", data: ['payment instruction'], waitsOn: 'ADR 0042 O1, O2'},
  {id: 'bank.statement', service: "the holder's own bank", data: ['account statement'], waitsOn: 'ADR 0042 O2'},
  {id: 'itonami.receive', service: "the holder's awai-banking-ops profile", data: ['payment instruction draft'], waitsOn: 'a declared local transport'}
].map(Object.freeze));

// ---- field checks (XSD facets of pain.001.001.09) ----
const max = n => s => s.length >= 1 && s.length <= n;
const MAX35 = max(35), MAX140 = max(140);
export const BIC_RE = /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
export const IBAN_RE = /^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$/;
export const UETR_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** ISO 13616 / ISO 7064 MOD 97-10 check digits. */
export function ibanChecksumOk(iban) {
  const s = iban.slice(4) + iban.slice(0, 4);
  let r = 0;
  for (const c of s.toUpperCase()) {
    const v = c >= 'A' && c <= 'Z' ? String(c.charCodeAt(0) - 55) : c;
    for (const d of v) r = (r * 10 + Number(d)) % 97;
  }
  return r === 1;
}
const calendarDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
export function isoDateOk(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return !!m && calendarDay(+m[1], +m[2], +m[3]);
}
export function isoDateTimeOk(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(s);
  if (!m || !calendarDay(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59) return false;
  return m[8] === 'Z' || (+m[10] < 60 && (+m[9] < 14 || (+m[9] === 14 && +m[10] === 0)));
}
export const decimalsFor = currency => ZERO_DECIMAL.has(currency) ? 0 : 2;

/** "1250" / "1250.5" -> "1250.50" for EUR, "1500" for JPY. Returns {amount} or {error}. */
export function parseAmount(text, currency) {
  const s = String(text ?? '').trim(), dec = decimalsFor(currency);
  if (!s) return {error: 'amount.empty'};
  const m = /^(\d{1,13})(?:\.(\d+))?$/.exec(s);
  if (!m) return {error: 'amount.format'};
  const frac = m[2] ?? '';
  if (frac.length > dec) return {error: dec ? 'amount.decimals' : 'amount.whole'};
  const whole = m[1].replace(/^0+(?=\d)/, ''), padded = frac.padEnd(dec, '0');
  if (BigInt(whole + padded) === 0n) return {error: 'amount.zero'};
  return {amount: dec ? `${whole}.${padded}` : whole};
}

const text = v => String(v ?? '').trim();
const upper = v => text(v).toUpperCase().replace(/\s+/g, '');

/** The holder's form -> one instruction, or {problems}. meta carries the generated ids and time. */
export function buildInstruction(form, meta) {
  const problems = [];
  const currency = upper(form.currency);
  const i = {
    msgId: text(meta.msgId), creationDateTime: text(meta.creationDateTime), paymentInfoId: text(meta.paymentInfoId),
    executionDate: text(form.executionDate), chargeBearer: text(form.chargeBearer) || 'SLEV',
    debtorName: text(form.debtorName), debtorIban: upper(form.debtorIban), debtorBic: upper(form.debtorBic),
    creditorName: text(form.creditorName), creditorIban: upper(form.creditorIban), creditorBic: upper(form.creditorBic),
    currency, endToEndId: text(form.endToEndId), instructionId: text(form.instructionId),
    uetr: text(form.uetr).toLowerCase(), remittance: text(form.remittance)};
  for (const [k, who] of [['debtorName', 'debtor'], ['creditorName', 'creditor']]) {
    if (!i[k]) problems.push(`${who}Name.empty`); else if (!MAX140(i[k])) problems.push(`${who}Name.long`);
  }
  for (const [k, who] of [['debtorIban', 'debtor'], ['creditorIban', 'creditor']]) {
    if (!IBAN_RE.test(i[k])) problems.push(`${who}Iban.format`); else if (!ibanChecksumOk(i[k])) problems.push(`${who}Iban.checksum`);
  }
  for (const [k, who] of [['debtorBic', 'debtor'], ['creditorBic', 'creditor']]) if (!BIC_RE.test(i[k])) problems.push(`${who}Bic.format`);
  if (!/^[A-Z]{3}$/.test(currency)) problems.push('currency.format');
  const a = parseAmount(form.amount, currency); if (a.error) problems.push(a.error); else i.amount = a.amount;
  if (!isoDateOk(i.executionDate)) problems.push('executionDate.format');
  if (!CHARGE_BEARERS.includes(i.chargeBearer)) problems.push('chargeBearer.code');
  if (!i.endToEndId) problems.push('endToEndId.empty'); else if (!MAX35(i.endToEndId)) problems.push('endToEndId.long');
  if (i.instructionId && !MAX35(i.instructionId)) problems.push('instructionId.long');
  if (i.uetr && !UETR_RE.test(i.uetr)) problems.push('uetr.format');
  if (i.remittance && !MAX140(i.remittance)) problems.push('remittance.long');
  if (!MAX35(i.msgId) || !MAX35(i.paymentInfoId) || !isoDateTimeOk(i.creationDateTime)) problems.push('meta.invalid');
  if (problems.length) return {problems};
  for (const k of ['instructionId', 'uetr', 'remittance']) if (!i[k]) delete i[k];
  return {instruction: i};
}

/** Every L1 problem of a stored or imported instruction ([] when it is valid). */
export function instructionProblems(i) {
  if (!i || typeof i !== 'object') return ['instruction.shape'];
  const r = buildInstruction({...i}, i);
  if (r.problems) return r.problems;
  for (const k of Object.keys(r.instruction)) if (r.instruction[k] !== i[k]) return ['instruction.normalized'];
  if (Object.keys(i).length !== Object.keys(r.instruction).length) return ['instruction.shape'];
  return [];
}

// ---- XML (the kotoba.swift subset, compact, no whitespace added) ----
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');
// [tag, attrs?, ...children]; a string child is text; null children are dropped.
function render(node) {
  if (typeof node === 'string') return esc(node);
  const [tag, ...rest] = node;
  const attrs = rest.length && rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0]) ? rest.shift() : null;
  const kids = rest.filter(k => k !== null && k !== undefined);
  const a = attrs ? Object.entries(attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('') : '';
  return kids.length ? `<${tag}${a}>${kids.map(render).join('')}</${tag}>` : `<${tag}${a}/>`;
}
export function tree(i) {
  return ['Document', {xmlns: NAMESPACE},
    ['CstmrCdtTrfInitn',
      ['GrpHdr', ['MsgId', i.msgId], ['CreDtTm', i.creationDateTime], ['NbOfTxs', '1'], ['CtrlSum', i.amount],
        ['InitgPty', ['Nm', i.debtorName]]],
      ['PmtInf', ['PmtInfId', i.paymentInfoId], ['PmtMtd', 'TRF'], ['NbOfTxs', '1'], ['CtrlSum', i.amount],
        ['ReqdExctnDt', ['Dt', i.executionDate]],
        ['Dbtr', ['Nm', i.debtorName]], ['DbtrAcct', ['Id', ['IBAN', i.debtorIban]]],
        ['DbtrAgt', ['FinInstnId', ['BICFI', i.debtorBic]]], ['ChrgBr', i.chargeBearer],
        ['CdtTrfTxInf',
          ['PmtId', i.instructionId ? ['InstrId', i.instructionId] : null, ['EndToEndId', i.endToEndId], i.uetr ? ['UETR', i.uetr] : null],
          ['Amt', ['InstdAmt', {Ccy: i.currency}, i.amount]],
          ['CdtrAgt', ['FinInstnId', ['BICFI', i.creditorBic]]], ['Cdtr', ['Nm', i.creditorName]],
          ['CdtrAcct', ['Id', ['IBAN', i.creditorIban]]],
          i.remittance ? ['RmtInf', ['Ustrd', i.remittance]] : null]]]];
}
export const toXml = i => '<?xml version="1.0" encoding="UTF-8"?>\n' + render(tree(i));

// A strict reader for this subset: one default namespace, elements, attributes
// and text; no comments, CDATA, processing instructions or DOCTYPE. Text is kept
// exactly; whitespace-only text between elements is formatting and is dropped.
const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
function unescape(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);|&/g, (m, n) => { if (!n) throw Error('import.entity'); return ENTITIES[n]; });
}
export function readXml(xml) {
  let s = String(xml);
  if (s.length > 20000) throw Error('import.size');
  s = s.replace(/^﻿/, '').replace(/^\s*<\?xml[^?]*\?>\s*/, '');
  if (/<!|<\?/.test(s)) throw Error('import.unsupported');
  const stack = [{kids: []}];
  const re = /<\/([A-Za-z][\w.-]*)\s*>|<([A-Za-z][\w.-]*)((?:\s+[A-Za-z][\w.-]*="[^"<]*")*)\s*(\/?)>|([^<]+)/gy;
  let m, end = 0;
  while ((m = re.exec(s))) {
    end = re.lastIndex;
    if (m[1]) {
      const top = stack.pop();
      if (!top.tag || top.tag !== m[1]) throw Error('import.malformed');
      stack[stack.length - 1].kids.push(top);
    } else if (m[2]) {
      const attrs = {};
      for (const [, k, v] of m[3].matchAll(/([A-Za-z][\w.-]*)="([^"]*)"/g)) { if (k in attrs) throw Error('import.malformed'); attrs[k] = unescape(v); }
      const node = {tag: m[2], attrs, kids: []};
      if (m[4]) stack[stack.length - 1].kids.push(node); else stack.push(node);
    } else if (m[5].trim()) stack[stack.length - 1].kids.push(unescape(m[5]));
  }
  if (end !== s.length || stack.length !== 1 || stack[0].kids.length !== 1 || typeof stack[0].kids[0] === 'string') throw Error('import.malformed');
  return stack[0].kids[0];
}
const same = (a, b) => {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.tag === b.tag && JSON.stringify(a.attrs) === JSON.stringify(b.attrs) && a.kids.length === b.kids.length && a.kids.every((k, n) => same(k, b.kids[n]));
};
function leaf(node, path) {
  let n = node;
  for (const t of path) { n = n?.kids?.find(k => typeof k !== 'string' && k.tag === t); if (!n) return undefined; }
  return n.kids.length === 1 && typeof n.kids[0] === 'string' ? n.kids[0] : undefined;
}

/**
 * Import a pain.001.001.09 document (for example one the awai-banking-ops
 * profile drafted). It is accepted only when it is exactly the document this
 * app would build from the same fields: the element subset, order and values
 * all match, and every value passes the L1 checks. Returns {instruction} or {problems}.
 */
export function importXml(xml) {
  let doc;
  try { doc = readXml(xml); } catch (e) { return {problems: [String(e.message).startsWith('import.') ? e.message : 'import.malformed']}; }
  if (doc.tag !== 'Document' || doc.attrs.xmlns !== NAMESPACE) return {problems: ['import.message']};
  const G = ['CstmrCdtTrfInitn', 'GrpHdr'], P = ['CstmrCdtTrfInitn', 'PmtInf'], T = [...P, 'CdtTrfTxInf'];
  const instr = leaf(doc, [...T, 'Amt', 'InstdAmt']);
  const amtNode = (() => { let n = doc; for (const t of [...T, 'Amt', 'InstdAmt']) n = n?.kids?.find(k => typeof k !== 'string' && k.tag === t); return n; })();
  const fields = {
    debtorName: leaf(doc, [...P, 'Dbtr', 'Nm']), debtorIban: leaf(doc, [...P, 'DbtrAcct', 'Id', 'IBAN']), debtorBic: leaf(doc, [...P, 'DbtrAgt', 'FinInstnId', 'BICFI']),
    creditorName: leaf(doc, [...T, 'Cdtr', 'Nm']), creditorIban: leaf(doc, [...T, 'CdtrAcct', 'Id', 'IBAN']), creditorBic: leaf(doc, [...T, 'CdtrAgt', 'FinInstnId', 'BICFI']),
    amount: instr, currency: amtNode?.attrs?.Ccy, executionDate: leaf(doc, [...P, 'ReqdExctnDt', 'Dt']),
    chargeBearer: leaf(doc, [...P, 'ChrgBr']), endToEndId: leaf(doc, [...T, 'PmtId', 'EndToEndId']),
    instructionId: leaf(doc, [...T, 'PmtId', 'InstrId']), uetr: leaf(doc, [...T, 'PmtId', 'UETR']), remittance: leaf(doc, [...T, 'RmtInf', 'Ustrd'])};
  const meta = {msgId: leaf(doc, [...G, 'MsgId']), creationDateTime: leaf(doc, [...G, 'CreDtTm']), paymentInfoId: leaf(doc, [...P, 'PmtInfId'])};
  // Values are taken as they are: no trimming or case folding, so a padded or
  // lower-case value fails the comparison below instead of being repaired.
  const raw = {};
  for (const [k, v] of Object.entries({...fields, ...meta})) if (v !== undefined) raw[k] = v;
  const built = buildInstruction(raw, raw);
  if (built.problems) return {problems: built.problems};
  for (const [k, v] of Object.entries(built.instruction)) if (raw[k] !== v) return {problems: ['import.normalized']};
  if (!same(doc, readXml(toXml(built.instruction)))) return {problems: ['import.subset']};
  return {instruction: built.instruction};
}

/** The L1 checks shown with a draft. Every check must pass before a draft is kept. */
export function l1Checks(i) {
  const xml = toXml(i), back = importXml(xml);
  return [
    {rule: 'xsd-facets', pass: instructionProblems(i).length === 0},
    {rule: 'round-trip', pass: !!back.instruction && JSON.stringify(back.instruction) === JSON.stringify(i)}];
}

// ---- local state ----
const STATUSES = new Set(['draft', 'approved']);
export const emptyState = () => ({schema: STATE_SCHEMA, drafts: []});
export function decodeState(data) {
  if (data === null || data === undefined) return emptyState();
  if (data?.schema !== STATE_SCHEMA || !Array.isArray(data.drafts)) throw Error('unreadable-drafts');
  for (const d of data.drafts) {
    if (typeof d?.id !== 'string' || typeof d.createdAt !== 'string' || !STATUSES.has(d.status) ||
        !['form', 'import'].includes(d.source) || (d.status === 'approved') !== (typeof d.approvedAt === 'string') ||
        instructionProblems(d.instruction).length) throw Error('unreadable-drafts');
  }
  // More than the limit is not truncated: a later write would drop the hidden drafts.
  if (data.drafts.length > MAX_DRAFTS) throw Error('unreadable-drafts');
  // Deleting by id removes every entry with that id, so ids must be unique.
  if (new Set(data.drafts.map(d => d.id)).size !== data.drafts.length) throw Error('unreadable-drafts');
  return {schema: STATE_SCHEMA, drafts: data.drafts.slice()};
}
export function addDraft(state, instruction, {id, now, source}) {
  if (instructionProblems(instruction).length || l1Checks(instruction).some(c => !c.pass)) throw Error('invalid-instruction');
  if (state.drafts.length >= MAX_DRAFTS) throw Error('too-many-drafts');
  return {schema: STATE_SCHEMA, drafts: [{id, createdAt: now, source, status: 'draft', instruction}, ...state.drafts]};
}
/** Approval records that the holder reviewed the draft. It sends nothing. */
export function setApproved(state, id, approved, now) {
  if (!state.drafts.some(d => d.id === id)) throw Error('no-such-draft');
  return {schema: STATE_SCHEMA, drafts: state.drafts.map(d => d.id !== id ? d
    : approved ? {...d, status: 'approved', approvedAt: now} : (({approvedAt, ...rest}) => ({...rest, status: 'draft'}))(d))};
}
export const removeDraft = (state, id) => ({schema: STATE_SCHEMA, drafts: state.drafts.filter(d => d.id !== id)});
