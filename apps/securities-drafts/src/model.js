// Securities settlement drafts (ISO 20022 sese.023.001.09) and custody-statement
// reviews (semt.002.001.10) for the account holder's own securities account.
// Pure functions: no network, custodian connection, market data or signing.
//
// The XML is the element subset that kotoba-lang/kotoba lib/kotoba.swift
// (kotoba.swift.securities, AWAI-3154) emits, byte for byte, so a draft made
// here and one made by the awai-securities-ops itonami profile are the same
// document; the holdings check gives the same lines as the profile's
// :reconcile-holdings (test/fixtures holds the profile's fixtures). The checks
// are ADR 0042 level L1 for that subset; L2 (market practice) and L3
// (acceptance by a custodian or CSD) wait on the owner decisions O3 and O5.
export const STATE_SCHEMA = 'itonami.securitiesdrafts.drafts.v1';
export const NS = Object.freeze({
  sese023: 'urn:iso:std:iso:20022:tech:xsd:sese.023.001.09',
  semt002: 'urn:iso:std:iso:20022:tech:xsd:semt.002.001.10'});
export const MAX_DRAFTS = 50;
// SecuritiesTransactionType codes accepted by sese.023.001.09 and sese.025.001.09 alike.
export const TRANSACTION_TYPES = Object.freeze(['TRAD', 'BSBK', 'BYIY', 'CNCB', 'COLI', 'COLO', 'CONV', 'FCTA', 'INSP', 'ISSU',
  'MKDW', 'MKUP', 'NETT', 'NSYN', 'OWNE', 'OWNI', 'PAIR', 'PLAC', 'PORT', 'REAL', 'REDI', 'REDM', 'RELE', 'REPU', 'RODE',
  'RVPO', 'SBBK', 'SBRE', 'SECB', 'SECL', 'SLRE', 'SUBS', 'SYND', 'TBAC', 'TRPO', 'TRVO', 'TURN', 'CLAI', 'CORP', 'AUTO',
  'SWIF', 'SWIT', 'ETFT']);
const FREQUENCIES = new Set(['YEAR', 'ADHO', 'MNTH', 'DAIL', 'INDA', 'WEEK', 'SEMI', 'QUTR', 'TOMN', 'TOWK', 'TWMN', 'OVNG', 'ONDE']);

export const PLANNED_OPERATIONS = Object.freeze([
  {id: 'custodian.submit', service: "the holder's own custodian", data: ['settlement instruction']},
  {id: 'custodian.statement', service: "the holder's own custodian", data: ['custody statement', 'settlement confirmation']},
  {id: 'itonami.receive', service: "the holder's awai-securities-ops profile", data: ['settlement instruction draft', 'custody statement']}
].map(Object.freeze));

// ---- field checks ----
const BIC_RE = /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const max = n => s => s.length >= 1 && s.length <= n;
const MAX35 = max(35), MAX140 = max(140);

/** ISIN (ISO 6166): [A-Z]{2}[A-Z0-9]{9}[0-9] and the Luhn check digit over the letter-expanded payload. */
export function isinOk(s) {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return false;
  const digits = [...s.slice(0, 11)].flatMap(c => c >= 'A' ? [...String(c.charCodeAt(0) - 55)] : [c]).map(Number).reverse();
  const total = digits.reduce((t, d, i) => t + (i % 2 === 0 ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d), 0);
  return (10 - total % 10) % 10 === Number(s[11]);
}
const calendarDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
export function isoDateOk(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return !!m && calendarDay(+m[1], +m[2], +m[3]); }
// xs:decimal within totalDigits/fractionDigits, as a plain positive number.
function decimalOk(s, total, frac) {
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(s);
  if (!m || !/[1-9]/.test(s)) return false;
  const i = m[1].replace(/^0+/, ''), f = (m[2] ?? '').replace(/0+$/, '');
  return f.length <= frac && i.length + f.length <= total;
}
export const quantityOk = s => decimalOk(s, 18, 17);   // DecimalNumber
export const amountOk = s => decimalOk(s, 18, 5);      // ActiveCurrencyAndAmount
/** "100.0", "100" and "0100" compare equal; anything else is returned as it is. */
export function canonicalDecimal(s) {
  const m = /^([0-9]+)(?:\.([0-9]*))?$/.exec(s ?? '');
  if (!m) return s;
  const w = m[1].replace(/^0+(?=\d)/, ''), f = (m[2] ?? '').replace(/0+$/, '');
  return f ? `${w}.${f}` : w;
}

const text = v => String(v ?? '').trim();
const upper = v => text(v).toUpperCase().replace(/\s+/g, '');

/** The holder's form -> one sese.023 instruction, or {problems}. */
export function buildInstruction(form) {
  const problems = [];
  const i = {txId: text(form.txId), direction: text(form.direction), paymentType: text(form.paymentType),
    settlementDate: text(form.settlementDate), isin: upper(form.isin), description: text(form.description),
    quantity: text(form.quantity), safekeepingAccount: text(form.safekeepingAccount), transactionType: text(form.transactionType) || 'TRAD',
    placeOfSettlement: upper(form.placeOfSettlement), agent: upper(form.agent)};
  if (!i.txId) problems.push('txId.empty'); else if (!MAX35(i.txId)) problems.push('txId.long');
  if (!['receive', 'deliver'].includes(i.direction)) problems.push('direction.code');
  if (!['free', 'against-payment'].includes(i.paymentType)) problems.push('paymentType.code');
  if (!isoDateOk(i.settlementDate)) problems.push('settlementDate.format');
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(i.isin)) problems.push('isin.format'); else if (!isinOk(i.isin)) problems.push('isin.checksum');
  if (i.description && !MAX140(i.description)) problems.push('description.long');
  if (!quantityOk(i.quantity)) problems.push('quantity.format');
  if (!i.safekeepingAccount) problems.push('safekeepingAccount.empty'); else if (!MAX35(i.safekeepingAccount)) problems.push('safekeepingAccount.long');
  if (!TRANSACTION_TYPES.includes(i.transactionType)) problems.push('transactionType.code');
  if (!BIC_RE.test(i.placeOfSettlement)) problems.push('placeOfSettlement.format');
  if (!BIC_RE.test(i.agent)) problems.push('agent.format');
  if (i.paymentType === 'against-payment') {
    const currency = upper(form.currency), value = text(form.amount);
    if (!/^[A-Z]{3}$/.test(currency)) problems.push('currency.format');
    if (!amountOk(value)) problems.push('amount.format');
    i.amount = {currency, value};
  }
  if (problems.length) return {problems};
  if (!i.description) delete i.description;
  return {instruction: i};
}

// ---- XML (the kotoba.swift subset, compact) ----
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');
function render(node) {
  if (typeof node === 'string') return esc(node);
  const [tag, ...rest] = node;
  const attrs = rest.length && rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0]) ? rest.shift() : null;
  const kids = rest.filter(k => k !== null && k !== undefined);
  const a = attrs ? Object.entries(attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('') : '';
  return kids.length ? `<${tag}${a}>${kids.map(render).join('')}</${tag}>` : `<${tag}${a}/>`;
}
const DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';
export function instructionTree(i) {
  const receive = i.direction === 'receive';
  return ['Document', {xmlns: NS.sese023}, ['SctiesSttlmTxInstr',
    ['TxId', i.txId],
    ['SttlmTpAndAddtlParams', ['SctiesMvmntTp', receive ? 'RECE' : 'DELI'], ['Pmt', i.paymentType === 'free' ? 'FREE' : 'APMT']],
    ['TradDtls', ['SttlmDt', ['Dt', ['Dt', i.settlementDate]]]],
    ['FinInstrmId', ['ISIN', i.isin], i.description ? ['Desc', i.description] : null],
    ['QtyAndAcctDtls', ['SttlmQty', ['Qty', ['Unit', i.quantity]]], ['SfkpgAcct', ['Id', i.safekeepingAccount]]],
    ['SttlmParams', ['SctiesTxTp', ['Cd', i.transactionType]]],
    // The counterparty side: delivering for a receipt, receiving for a delivery.
    [receive ? 'DlvrgSttlmPties' : 'RcvgSttlmPties', ['Dpstry', ['Id', ['AnyBIC', i.placeOfSettlement]]], ['Pty1', ['Id', ['AnyBIC', i.agent]]]],
    // Receiving securities against payment means paying cash (debit); delivering, receiving it (credit).
    i.amount ? ['SttlmAmt', ['Amt', {Ccy: i.amount.currency}, i.amount.value], ['CdtDbtInd', receive ? 'DBIT' : 'CRDT']] : null]];
}
export const instructionXml = i => DECL + render(instructionTree(i));
export function statementTree(s) {
  return ['Document', {xmlns: NS.semt002}, ['SctiesBalCtdyRpt',
    ['Pgntn', ['PgNb', '1'], ['LastPgInd', 'true']],
    ['StmtGnlDtls', ['StmtDtTm', ['Dt', s.statementDate]], ['Frqcy', ['Cd', s.frequency]], ['UpdTp', ['Cd', s.updateType]],
      ['StmtBsis', ['Cd', s.basis]], ['ActvtyInd', String(s.activity)], ['SubAcctInd', 'false']],
    ['SfkpgAcct', ['Id', s.safekeepingAccount]],
    ...s.balances.map(b => ['BalForAcct', ['FinInstrmId', ['ISIN', b.isin]],
      ['AggtBal', ['ShrtLngInd', b.short ? 'SHOR' : 'LONG'], ['Qty', ['Qty', ['Qty', ['Unit', b.quantity]]]]]])]];
}
export const statementXml = s => DECL + render(statementTree(s));

// ---- strict reader for this subset ----
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
const child = (n, t) => n?.kids?.find(k => typeof k !== 'string' && k.tag === t);
const children = (n, t) => (n?.kids ?? []).filter(k => typeof k !== 'string' && k.tag === t);
const at = (n, ...path) => path.reduce((x, t) => child(x, t), n);
const leaf = (n, ...path) => { const x = at(n, ...path); return x && x.kids.length === 1 && typeof x.kids[0] === 'string' ? x.kids[0] : undefined; };
const parse = xml => { try { return {doc: readXml(xml)}; } catch (e) { return {problems: [String(e.message).startsWith('import.') ? e.message : 'import.malformed']}; } };

/**
 * Import a sese.023.001.09 settlement instruction (for example one the
 * awai-securities-ops profile drafted). Accepted only when it is exactly the
 * document this app builds from the same fields, with valid values.
 */
export function importInstruction(xml) {
  const {doc, problems} = parse(xml); if (problems) return {problems};
  if (doc.tag !== 'Document' || doc.attrs.xmlns !== NS.sese023) return {problems: ['import.message']};
  const b = child(doc, 'SctiesSttlmTxInstr');
  const receive = leaf(b, 'SttlmTpAndAddtlParams', 'SctiesMvmntTp') === 'RECE';
  const side = child(b, receive ? 'DlvrgSttlmPties' : 'RcvgSttlmPties');
  const amt = at(b, 'SttlmAmt', 'Amt');
  const raw = {txId: leaf(b, 'TxId'), direction: receive ? 'receive' : leaf(b, 'SttlmTpAndAddtlParams', 'SctiesMvmntTp') === 'DELI' ? 'deliver' : '?',
    paymentType: {FREE: 'free', APMT: 'against-payment'}[leaf(b, 'SttlmTpAndAddtlParams', 'Pmt')] ?? '?',
    settlementDate: leaf(b, 'TradDtls', 'SttlmDt', 'Dt', 'Dt'), isin: leaf(b, 'FinInstrmId', 'ISIN'), description: leaf(b, 'FinInstrmId', 'Desc'),
    quantity: leaf(b, 'QtyAndAcctDtls', 'SttlmQty', 'Qty', 'Unit'), safekeepingAccount: leaf(b, 'QtyAndAcctDtls', 'SfkpgAcct', 'Id'),
    transactionType: leaf(b, 'SttlmParams', 'SctiesTxTp', 'Cd'), placeOfSettlement: leaf(side, 'Dpstry', 'Id', 'AnyBIC'),
    agent: leaf(side, 'Pty1', 'Id', 'AnyBIC'), currency: amt?.attrs?.Ccy, amount: leaf(b, 'SttlmAmt', 'Amt')};
  for (const k of Object.keys(raw)) if (raw[k] === undefined) delete raw[k];
  const built = buildInstruction(raw);
  if (built.problems) return {problems: built.problems};
  for (const k of ['txId', 'isin', 'quantity', 'safekeepingAccount', 'placeOfSettlement', 'agent', 'settlementDate', 'description'])
    if ((raw[k] ?? undefined) !== (built.instruction[k] ?? undefined)) return {problems: ['import.normalized']};
  if (built.instruction.amount && (raw.currency !== built.instruction.amount.currency || raw.amount !== built.instruction.amount.value)) return {problems: ['import.normalized']};
  if (!same(doc, readXml(instructionXml(built.instruction)))) return {problems: ['import.subset']};
  return {instruction: built.instruction};
}

/** Every problem of a stored or imported instruction ([] when valid and in normal form). */
export function instructionProblems(i) {
  if (!i || typeof i !== 'object') return ['instruction.shape'];
  const form = {...i, currency: i.amount?.currency, amount: i.amount?.value};
  const r = buildInstruction(form);
  if (r.problems) return r.problems;
  return JSON.stringify(r.instruction) === JSON.stringify(i) ? [] : ['instruction.normalized'];
}

/** Import a semt.002.001.10 custody statement (one page of aggregate balances). */
export function importStatement(xml) {
  const {doc, problems} = parse(xml); if (problems) return {problems};
  if (doc.tag !== 'Document' || doc.attrs.xmlns !== NS.semt002) return {problems: ['import.message']};
  const b = child(doc, 'SctiesBalCtdyRpt'), g = child(b, 'StmtGnlDtls');
  const s = {statementDate: leaf(g, 'StmtDtTm', 'Dt'), frequency: leaf(g, 'Frqcy', 'Cd'), updateType: leaf(g, 'UpdTp', 'Cd'),
    basis: leaf(g, 'StmtBsis', 'Cd'), activity: leaf(g, 'ActvtyInd') === 'true', safekeepingAccount: leaf(b, 'SfkpgAcct', 'Id'),
    balances: children(b, 'BalForAcct').map(x => ({isin: leaf(x, 'FinInstrmId', 'ISIN'), quantity: leaf(x, 'AggtBal', 'Qty', 'Qty', 'Qty', 'Unit'),
      short: leaf(x, 'AggtBal', 'ShrtLngInd') === 'SHOR'}))};
  const p = statementProblems(s);
  if (p.length) return {problems: p};
  if (!same(doc, readXml(statementXml(s)))) return {problems: ['import.subset']};
  return {statement: s};
}
export function statementProblems(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.balances)) return ['statement.shape'];
  const p = [];
  if (!isoDateOk(s.statementDate ?? '')) p.push('statement.date');
  if (!FREQUENCIES.has(s.frequency) || !['COMP', 'DELT'].includes(s.updateType) || !['CONT', 'SETT', 'TRAD'].includes(s.basis)) p.push('statement.code');
  if (typeof s.activity !== 'boolean') p.push('statement.shape');
  if (!MAX35(s.safekeepingAccount ?? '')) p.push('statement.account');
  if (s.balances.length > 200) p.push('statement.size');
  for (const x of s.balances) if (!isinOk(x?.isin ?? '') || !quantityOk(x?.quantity ?? '') || typeof x.short !== 'boolean') { p.push('statement.balance'); break; }
  return p;
}

/** "ISIN quantity" per line; a negative quantity is a short position. Returns {positions} or {problems}. */
export function parsePositions(textValue) {
  const positions = [], problems = [];
  for (const [n, raw] of String(textValue ?? '').split('\n').entries()) {
    const line = raw.trim(); if (!line) continue;
    const m = /^([A-Za-z0-9]{12})\s+(-?)([0-9]+(?:\.[0-9]+)?)$/.exec(line);
    if (!m || !isinOk(m[1].toUpperCase()) || !quantityOk(m[3])) { problems.push({line: n + 1, code: 'positions.line'}); continue; }
    positions.push({isin: m[1].toUpperCase(), quantity: m[3], short: m[2] === '-'});
  }
  if (new Set(positions.map(p => p.isin)).size !== positions.length) problems.push({line: 0, code: 'positions.duplicate'});
  return problems.length ? {problems} : {positions};
}

/** The same lines as the awai-securities-ops :reconcile-holdings, ISIN by ISIN. */
export function reconcileHoldings(statement, positions) {
  const signed = x => (x.short ? '-' : '') + canonicalDecimal(x.quantity);
  const stated = new Map(statement.balances.map(b => [b.isin, signed(b)]));
  const mine = new Map(positions.map(p => [p.isin, signed(p)]));
  return [...new Set([...stated.keys(), ...mine.keys()])].sort().map(isin => ({isin, statement: stated.get(isin) ?? null, holder: mine.get(isin) ?? null,
    result: !stated.has(isin) ? 'missing-in-statement' : !mine.has(isin) ? 'missing-in-positions' : stated.get(isin) === mine.get(isin) ? 'match' : 'quantity-differs'}));
}

/** The L1 checks shown with an instruction draft. */
export function l1Checks(i) {
  const back = importInstruction(instructionXml(i));
  return [{rule: 'xsd-facets', pass: instructionProblems(i).length === 0},
    {rule: 'round-trip', pass: !!back.instruction && JSON.stringify(back.instruction) === JSON.stringify(i)}];
}

// ---- local state ----
const STATUSES = new Set(['draft', 'approved']);
export const emptyState = () => ({schema: STATE_SCHEMA, drafts: []});
export function decodeState(data) {
  if (data === null || data === undefined) return emptyState();
  if (data?.schema !== STATE_SCHEMA || !Array.isArray(data.drafts)) throw Error('unreadable-drafts');
  for (const d of data.drafts) {
    const okBody = d?.kind === 'instruction' ? instructionProblems(d.instruction).length === 0 && !('statement' in d)
      : d?.kind === 'statement' ? statementProblems(d.statement).length === 0 && !('instruction' in d) : false;
    if (typeof d?.id !== 'string' || typeof d.createdAt !== 'string' || !STATUSES.has(d.status) || !okBody ||
        !['form', 'import'].includes(d.source) || (d.status === 'approved') !== (typeof d.approvedAt === 'string')) throw Error('unreadable-drafts');
  }
  // More than the limit is not truncated: a later write would drop the hidden drafts.
  if (data.drafts.length > MAX_DRAFTS) throw Error('unreadable-drafts');
  // Deleting by id removes every entry with that id, so ids must be unique.
  if (new Set(data.drafts.map(d => d.id)).size !== data.drafts.length) throw Error('unreadable-drafts');
  return {schema: STATE_SCHEMA, drafts: data.drafts.slice()};
}
export function addInstruction(state, instruction, {id, now, source}) {
  if (instructionProblems(instruction).length || l1Checks(instruction).some(c => !c.pass)) throw Error('invalid-instruction');
  if (state.drafts.length >= MAX_DRAFTS) throw Error('too-many-drafts');
  return {schema: STATE_SCHEMA, drafts: [{id, createdAt: now, source, kind: 'instruction', status: 'draft', instruction}, ...state.drafts]};
}
export function addStatement(state, statement, {id, now}) {
  if (statementProblems(statement).length) throw Error('invalid-statement');
  if (state.drafts.length >= MAX_DRAFTS) throw Error('too-many-drafts');
  return {schema: STATE_SCHEMA, drafts: [{id, createdAt: now, source: 'import', kind: 'statement', status: 'draft', statement}, ...state.drafts]};
}
/** Approval records that the holder reviewed the item. It sends, orders or moves nothing. */
export function setApproved(state, id, approved, now) {
  if (!state.drafts.some(d => d.id === id)) throw Error('no-such-draft');
  return {schema: STATE_SCHEMA, drafts: state.drafts.map(d => d.id !== id ? d
    : approved ? {...d, status: 'approved', approvedAt: now} : (({approvedAt, ...rest}) => ({...rest, status: 'draft'}))(d))};
}
export const removeDraft = (state, id) => ({schema: STATE_SCHEMA, drafts: state.drafts.filter(d => d.id !== id)});
