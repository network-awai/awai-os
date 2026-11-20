// Public Funds: view the awai.public-funds/1 records that the awai-public-funds
// itonami profile (kotoba-lang/itonami-agent, AWAI-3294) writes, on the device.
// Pure functions: no network, no publisher fetch, no publication.
//
// Scope: network-awai-apex ADR 0046. Every amount keeps the basis the bot gave
// it (derived from source rows, or unknown); the COFOG division of a row is the
// bot's assumption, or unmapped/unknown. A difference is shown as a difference;
// nothing here ranks, judges or explains it.
export const STATE_SCHEMA = 'itonami.publicfunds.analyses.v1';
export const RECORD_KIND = 'awai.public-funds/1';
export const MAX_ANALYSES = 4;
export const MAX_IMPORT_CHARS = 200000;
export const COFOG_DIVISIONS = Object.freeze(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);

export const PLANNED_OPERATIONS = Object.freeze([
  {id: 'publisher.fetch', waits: 'O1'},
  {id: 'results.publish', waits: 'O2'},
  {id: 'itonami.receive', waits: 'bot'}
].map(Object.freeze));

// ---- a strict EDN subset reader ----
// Maps, vectors, strings, keywords, integers, true, false, nil. Anything else
// (tags, sets, symbols, lists, floats, metadata, comments) is refused rather
// than guessed. Map keys must be keywords; they become their names ("request/id").
export class EdnError extends Error { constructor(code) { super(code); this.code = code; } }
const KW = /^[A-Za-z][A-Za-z0-9*+!_?<>=.-]*(\/[A-Za-z][A-Za-z0-9*+!_?<>=.-]*)?$/;
export function readEdn(text) {
  if (typeof text !== 'string') throw new EdnError('edn.malformed');
  if (text.length > MAX_IMPORT_CHARS) throw new EdnError('edn.size');
  let i = 0, depth = 0;
  const ws = () => { while (i < text.length && /[\s,]/.test(text[i])) i++; };
  const fail = code => { throw new EdnError(code); };
  function value() {
    ws();
    if (i >= text.length) fail('edn.malformed');
    const c = text[i];
    if (c === '{' || c === '[') {
      if (++depth > 32) fail('edn.depth');
      const close = c === '{' ? '}' : ']'; i++;
      const items = [];
      for (;;) { ws(); if (i >= text.length) fail('edn.malformed'); if (text[i] === close) { i++; break; } items.push(value()); }
      depth--;
      if (c === '[') return items;
      if (items.length % 2) fail('edn.malformed');
      const o = Object.create(null);
      for (let k = 0; k < items.length; k += 2) {
        const key = items[k];
        if (!(key instanceof Keyword)) fail('edn.key');
        if (Object.hasOwn(o, key.name)) fail('edn.duplicate');
        o[key.name] = items[k + 1];
      }
      return o;
    }
    if (c === '"') {
      i++; let s = '';
      for (;;) {
        if (i >= text.length) fail('edn.malformed');
        const d = text[i++];
        if (d === '"') return s;
        if (d === '\\') {
          const e = text[i++];
          if (e === 'n') s += '\n'; else if (e === 't') s += '\t'; else if (e === 'r') s += '\r';
          else if (e === '"' || e === '\\') s += e; else fail('edn.escape');
        } else s += d;
      }
    }
    const m = /^[^\s,{}\[\]"]+/.exec(text.slice(i, i + 256));
    if (!m) fail('edn.malformed');
    const tok = m[0]; i += tok.length;
    if (tok === 'nil') return null;
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (/^-?\d+$/.test(tok)) { const n = Number(tok); if (!Number.isSafeInteger(n)) fail('edn.number'); return n; }
    if (tok[0] === ':' && KW.test(tok.slice(1))) return new Keyword(tok.slice(1));
    fail('edn.unsupported');
  }
  const v = value(); ws();
  if (i !== text.length) fail('edn.malformed');
  return v;
}
export class Keyword { constructor(name) { this.name = name; Object.freeze(this); } }
const kw = v => v instanceof Keyword ? v.name : undefined;

// ---- import ----
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Keyword);
const isStr = (v, max = 400) => typeof v === 'string' && v.length >= 1 && v.length <= max;
const isInt = v => Number.isSafeInteger(v);
const HEX64 = /^[0-9a-f]{64}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function amount(v) {
  if (!isObj(v)) return {problem: true};
  if (kw(v.basis) === 'unknown') return {value: null};
  if (kw(v.basis) !== 'derived' || !isInt(v.value) || v.unit !== 'JPY' || !isStr(v.method)) return {problem: true};
  return {value: v.value};
}
const AMOUNT_KEYS = [['initial-budget', 'initial'], ['outturn-budget', 'outturnBudget'], ['current-budget', 'current'], ['spent', 'spent'], ['carried-out', 'carriedOut'], ['unused', 'unused']];

/** Parse and check one awai.public-funds/1 record. Returns {analysis} or {problems: [code]}. */
export function importAnalysis(text) {
  let r;
  try { r = readEdn(text); } catch (e) { return {problems: [e instanceof EdnError ? e.code : 'edn.malformed']}; }
  if (!isObj(r)) return {problems: ['record.kind']};
  // The bot writes a refusal (a :reason) instead of a record when it declines a request.
  if (r.reason !== undefined) return {problems: ['record.refusal']};
  if (r.kind !== RECORD_KIND) return {problems: ['record.kind']};
  const s = r.scope;
  if (!isObj(s) || !/^[A-Z]{2}$/.test(s.country ?? '') || !/^\d{4}$/.test(s['fiscal-year'] ?? '') || !kw(s.level) || !kw(s.account)) return {problems: ['record.scope']};
  if (r.unit !== 'JPY' || !isStr(r['request/id'], 64)) return {problems: ['record.shape']};
  if (!Array.isArray(r.rows) || r.rows.length < 1 || r.rows.length > 500) return {problems: ['record.rows']};
  const rows = [];
  for (const x of r.rows) {
    if (!isObj(x) || !isStr(x.ministry, 80) || !isObj(x.cofog)) return {problems: ['record.rows']};
    const basis = kw(x.cofog.basis), division = x.cofog.division;
    if (basis === 'assumed') { if (!COFOG_DIVISIONS.includes(division)) return {problems: ['record.cofog']}; }
    else if ((basis !== 'unmapped' && basis !== 'unknown') || division !== null) return {problems: ['record.cofog']};
    const codes = x.cofog['purpose-codes'];
    if (!Array.isArray(codes) || !codes.every(c => /^\d{3}$/.test(c))) return {problems: ['record.cofog']};
    if (x.did !== null && x.did !== undefined && !(isStr(x.did, 200) && x.did.startsWith('did:'))) return {problems: ['record.rows']};
    const row = {ministry: x.ministry, did: x.did ?? null, division, cofogBasis: basis, codes: [...codes]};
    for (const [k, n] of AMOUNT_KEYS) { const a = amount(x[k]); if (a.problem) return {problems: ['record.amount']}; row[n] = a.value; }
    rows.push(row);
  }
  const t = r.totals; if (!isObj(t)) return {problems: ['record.totals']};
  const totals = {};
  for (const [k, n] of [...AMOUNT_KEYS, ['unmapped-spent', 'unmappedSpent']]) { const a = amount(t[k]); if (a.problem || a.value === null) return {problems: ['record.totals']}; totals[n] = a.value; }
  // The totals must equal the rows they summarise; otherwise the record was altered.
  for (const [, n] of AMOUNT_KEYS) if (rows.reduce((sum, x) => sum + (x[n] ?? 0), 0) !== totals[n]) return {problems: ['record.totals']};
  if (rows.filter(x => x.division === null).reduce((sum, x) => sum + (x.spent ?? 0), 0) !== totals.unmappedSpent) return {problems: ['record.totals']};
  if (!Array.isArray(r.checks)) return {problems: ['record.checks']};
  const byKind = Object.fromEntries(r.checks.filter(isObj).map(c => [kw(c.kind), c]));
  const identity = c => isObj(c) && isInt(c['rows-checked']) && ['match', 'differs'].includes(kw(c.result)) && isObj(c.differing) && isInt(c.differing.count)
    ? {rows: c['rows-checked'], result: kw(c.result), differing: c.differing.count} : null;
  const idCurrent = identity(byKind['outturn-current-budget-identity']), idDisp = identity(byKind['outturn-disposition-identity']);
  const cov = byKind['ministry-coverage'], codes = byKind['purpose-code-coverage'];
  const strs = v => Array.isArray(v) && v.every(x => isStr(x, 80));
  if (!idCurrent || !idDisp || !isObj(cov) || !strs(cov['only-in-initial']) || !strs(cov['only-in-outturn']) || !strs(cov['without-did'])
      || !isObj(codes) || !strs(codes.unmapped) || !strs(codes.unknown)) return {problems: ['record.checks']};
  const sources = [];
  if (!Array.isArray(r.sources) || r.sources.length < 1 || r.sources.length > 8) return {problems: ['record.sources']};
  for (const x of r.sources) {
    if (!isObj(x) || !kw(x.role) || !isStr(x.title) || !isStr(x.publisher, 200) || !isStr(x.license) || !HEX64.test(x.sha256 ?? '')
        || x['verified-sha256'] !== true || !ISO_TIME.test(x['fetched-at'] ?? '') || !/^https:\/\/[^\s]+$/.test(x.url ?? '')) return {problems: ['record.sources']};
    sources.push({role: kw(x.role), title: x.title, publisher: x.publisher, license: x.license, url: x.url, sha256: x.sha256,
      archiveSha256: HEX64.test(x['archive-sha256'] ?? '') ? x['archive-sha256'] : null, fetchedAt: x['fetched-at']});
  }
  const openPoints = Array.isArray(r['open-points']) ? r['open-points'].filter(p => isStr(p, 600)).slice(0, 20) : [];
  const mapVersion = isObj(r['cofog-map']) && isStr(r['cofog-map'].version, 40) ? r['cofog-map'].version : null;
  return {analysis: {id: r['request/id'], scope: {country: s.country, level: kw(s.level), account: kw(s.account), fiscalYear: s['fiscal-year']},
    totals, rows, checks: {identityCurrent: idCurrent, identityDisposition: idDisp,
      coverage: {onlyInitial: [...cov['only-in-initial']], onlyOutturn: [...cov['only-in-outturn']], withoutDid: [...cov['without-did']]},
      codes: {unmapped: [...codes.unmapped], unknown: [...codes.unknown]}},
    sources, openPoints, cofogMapVersion: mapVersion}};
}

// ---- views of one analysis ----
/** Per-ministry sums over the analysis rows (rows are ministry x division). */
export function byMinistry(a) {
  const m = new Map();
  for (const r of a.rows) {
    const e = m.get(r.ministry) ?? {ministry: r.ministry, did: r.did, initial: 0, outturnBudget: 0, spent: 0};
    e.initial += r.initial ?? 0; e.outturnBudget += r.outturnBudget ?? 0; e.spent += r.spent ?? 0; m.set(r.ministry, e);
  }
  return [...m.values()].map(e => ({...e, difference: e.spent - e.initial})).sort((x, y) => x.ministry < y.ministry ? -1 : x.ministry > y.ministry ? 1 : 0);
}
/** Sum per COFOG division; null for unmapped/unknown. */
export function byDivision(a, measure) {
  const m = new Map();
  for (const r of a.rows) m.set(r.division, (m.get(r.division) ?? 0) + (r[measure] ?? 0));
  return m;
}
/**
 * Ministry -> division flows for one measure ('spent' or 'initial'). Ministries
 * outside the `keep` largest by that measure are grouped as one 'other' source,
 * so the chart stays readable; the table view lists every row.
 */
export function flows(a, measure, keep = 8) {
  const totals = new Map();
  for (const r of a.rows) totals.set(r.ministry, (totals.get(r.ministry) ?? 0) + (r[measure] ?? 0));
  const kept = new Set([...totals.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, keep).map(e => e[0]));
  const m = new Map();
  for (const r of a.rows) {
    const v = r[measure] ?? 0; if (v <= 0) continue;
    const from = kept.has(r.ministry) ? r.ministry : null, to = r.division;
    const k = JSON.stringify([from, to]); m.set(k, (m.get(k) ?? 0) + v);
  }
  return [...m.entries()].map(([k, value]) => { const [from, to] = JSON.parse(k); return {from, to, value}; });
}
/**
 * Geometry for a two-column flow chart. Nodes are stacked in the given order
 * with `gap` between them; node and link heights are proportional to value.
 */
export function sankeyLayout(links, {height, gap = 4, leftOrder, rightOrder}) {
  const sum = (key, side) => links.filter(l => l[side] === key).reduce((s, l) => s + l.value, 0);
  const total = links.reduce((s, l) => s + l.value, 0);
  const count = Math.max(leftOrder.length, rightOrder.length);
  const scale = total > 0 ? (height - gap * (count - 1)) / total : 0;
  const place = (order, side) => { let y = 0; const o = new Map(); for (const k of order) { const h = sum(k, side) * scale; o.set(k, {key: k, y, h, used: 0, value: sum(k, side)}); y += h + gap; } return o; };
  const L = place(leftOrder, 'from'), R = place(rightOrder, 'to');
  // Stack each node's links in the order of the opposite column, so bands do not cross inside a node.
  const li = k => leftOrder.indexOf(k), ri = k => rightOrder.indexOf(k);
  const out = links.map(l => ({...l, h: l.value * scale}));
  for (const l of [...out].sort((x, y) => li(x.from) - li(y.from) || ri(x.to) - ri(y.to))) { const a = L.get(l.from); l.y0 = a.y + a.used; a.used += l.h; }
  for (const l of [...out].sort((x, y) => ri(x.to) - ri(y.to) || li(x.from) - li(y.from))) { const b = R.get(l.to); l.y1 = b.y + b.used; b.used += l.h; }
  return {left: [...L.values()], right: [...R.values()], links: out, scale};
}
export function orders(links) {
  const sum = side => { const m = new Map(); for (const l of links) m.set(l[side], (m.get(l[side]) ?? 0) + l.value); return m; };
  const lm = sum('from'), rm = sum('to');
  const rank = (m, last) => [...m.keys()].sort((x, y) => (x === last) - (y === last) || m.get(y) - m.get(x));
  const right = [...rm.keys()].sort((x, y) => (x === null) - (y === null) || (x < y ? -1 : 1));
  return {leftOrder: rank(lm, null), rightOrder: right};
}

// ---- stored analyses ----
export const emptyState = () => ({schema: STATE_SCHEMA, analyses: []});
export function decodeState(data) {
  if (data === null || data === undefined) return emptyState();
  if (!isObj(data) || data.schema !== STATE_SCHEMA || !Array.isArray(data.analyses) || data.analyses.length > MAX_ANALYSES) throw Error('unreadable-state');
  const ids = new Set();
  for (const e of data.analyses) {
    if (!isObj(e) || !isStr(e.key, 120) || ids.has(e.key) || !ISO_TIME.test(e.importedAt ?? '') || !isObj(e.analysis)
        || !isStr(e.analysis.id, 64) || !/^\d{4}$/.test(e.analysis.scope?.fiscalYear ?? '') || !Array.isArray(e.analysis.rows)) throw Error('unreadable-state');
    ids.add(e.key);
  }
  return {schema: STATE_SCHEMA, analyses: data.analyses};
}
export const analysisKey = a => `${a.id}@${a.scope.country}/${a.scope.account}/${a.scope.fiscalYear}`;
/** Adds or replaces (same request id, country, account and year) one analysis. */
export function addAnalysis(state, analysis, now) {
  const key = analysisKey(analysis);
  const rest = state.analyses.filter(e => e.key !== key);
  if (rest.length >= MAX_ANALYSES) throw Error('too-many-analyses');
  return {schema: STATE_SCHEMA, analyses: [...rest, {key, importedAt: now, analysis}].sort((x, y) => x.analysis.scope.fiscalYear < y.analysis.scope.fiscalYear ? -1 : 1)};
}
export const removeAnalysis = (state, key) => ({schema: STATE_SCHEMA, analyses: state.analyses.filter(e => e.key !== key)});
/** Totals per fiscal year for one country and account, oldest first. */
export const series = (state, country, account) => state.analyses.map(e => e.analysis)
  .filter(a => a.scope.country === country && a.scope.account === account)
  .map(a => ({fiscalYear: a.scope.fiscalYear, initial: a.totals.initial, spent: a.totals.spent}));

// ---- formatting ----
/** Yen in trillions with two decimals (ja: 兆円, en: tn); exact yen stays available to the caller. */
export function formatTrillion(yen, locale) {
  if (yen === null || yen === undefined) return null;
  return new Intl.NumberFormat(locale, {minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'auto'}).format(yen / 1e12);
}
export const formatYen = (yen, locale) => new Intl.NumberFormat(locale).format(yen);
