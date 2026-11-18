import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readEdn, importAnalysis, byMinistry, byDivision, flows, orders, sankeyLayout, decodeState, emptyState, addAnalysis, removeAnalysis,
  series, formatTrillion, MAX_ANALYSES, STATE_SCHEMA, PLANNED_OPERATIONS, EdnError, Keyword} from '../src/model.js';
import {MESSAGES, pickLocale, translator} from '../src/messages.js';

const fixture = name => readFileSync(new URL('fixtures/' + name, import.meta.url), 'utf8');
const sha = s => createHash('sha256').update(s).digest('hex');
const RESULT = fixture('jp-fy2024-general.result.edn');
const imported = () => importAnalysis(RESULT).analysis;

test('the fixtures are the ones recorded in SOURCE.md', () => {
  assert.equal(sha(RESULT), '26eea1074ebc0e1198719aeaf174416ec606dcdd9d7a9a70cf88ca297bc5a02b');
  assert.equal(sha(fixture('rank-ministries-refused.refusal.edn')), '9998bbe24381598996af48dab33790ec109d7610aef1df653250e81d27f1b592');
});

test('the bot result imports with the totals it states (independently recomputed in AWAI-3294)', () => {
  const r = importAnalysis(RESULT);
  assert.equal(r.problems, undefined);
  const a = r.analysis;
  assert.equal(a.id, 'jp-fy2024-general');
  assert.deepEqual(a.scope, {country: 'JP', level: 'central', account: 'general', fiscalYear: '2024'});
  assert.equal(a.rows.length, 66);
  assert.deepEqual(a.totals, {initial: 112571688422000, outturnBudget: 126514973726000, current: 137578249935601, spent: 123023998629580,
    carriedOut: 10243266020197, unused: 4310985285824, unmappedSpent: 7997262328178});
  assert.deepEqual(a.checks.identityCurrent, {rows: 6962, result: 'match', differing: 0});
  assert.deepEqual(a.checks.identityDisposition, {rows: 6962, result: 'match', differing: 0});
  assert.deepEqual(a.checks.coverage.withoutDid, ['内閣', '国会', '皇室費', '裁判所']);
  assert.equal(a.sources.length, 2);
  assert.equal(a.sources[1].sha256, '3e1932534a94be40cf4af47d6cd8c6312497f1d552d210ec42e6e3a8a444e959');
  assert.equal(a.cofogMapVersion, '2026-11-18');
});

test('per ministry and per division sums equal the record totals', () => {
  const a = imported();
  const m = byMinistry(a);
  assert.equal(m.length, 18);
  assert.equal(m.reduce((s, x) => s + x.spent, 0), a.totals.spent);
  assert.equal(m.reduce((s, x) => s + x.initial, 0), a.totals.initial);
  const mhlw = m.find(x => x.ministry === '厚生労働省');
  assert.deepEqual([mhlw.initial, mhlw.spent, mhlw.difference], [33819068928000, 32099561311892, 32099561311892 - 33819068928000]);
  const d = byDivision(a, 'spent');
  assert.equal([...d.values()].reduce((s, v) => s + v, 0), a.totals.spent);
  assert.equal(d.get(null), a.totals.unmappedSpent);
});

test('flows keep every yen; the smaller ministries are grouped as one source', () => {
  const a = imported();
  for (const measure of ['spent', 'initial']) {
    const f = flows(a, measure, 8);
    assert.equal(f.reduce((s, l) => s + l.value, 0), measure === 'spent' ? a.totals.spent : a.totals.initial);
    assert.equal(new Set(f.map(l => l.from).filter(x => x !== null)).size, 8);
    assert.ok(f.some(l => l.from === null));
  }
});

test('the flow layout is proportional and stays inside the chart', () => {
  const links = [{from: 'A', to: '01', value: 30}, {from: 'A', to: null, value: 10}, {from: 'B', to: '01', value: 60}];
  const g = sankeyLayout(links, {height: 104, gap: 4, ...orders(links)});
  assert.deepEqual(orders(links), {leftOrder: ['B', 'A'], rightOrder: ['01', null]});
  assert.equal(g.scale, 1);
  assert.deepEqual(g.left.map(n => [n.key, n.y, n.h]), [['B', 0, 60], ['A', 64, 40]]);
  assert.deepEqual(g.right.map(n => [n.key, n.y, n.h]), [['01', 0, 90], [null, 94, 10]]);
  for (const l of g.links) { assert.ok(l.y0 + l.h <= 104 + 1e-9); assert.ok(l.y1 + l.h <= 104 + 1e-9); }
  const real = imported(), f = flows(real, 'spent'), r = sankeyLayout(f, {height: 420, ...orders(f)});
  // The column with more nodes fills the height exactly; the other ends at or above it.
  const end = col => col[col.length - 1].y + col[col.length - 1].h;
  const [longer, shorter] = r.right.length >= r.left.length ? [r.right, r.left] : [r.left, r.right];
  assert.ok(Math.abs(end(longer) - 420) < 1e-6);
  assert.ok(end(shorter) <= 420 + 1e-6);
});

test('a refusal, an altered total and unsupported EDN are not imported', () => {
  assert.deepEqual(importAnalysis(fixture('rank-ministries-refused.refusal.edn')), {problems: ['record.refusal']});
  assert.deepEqual(importAnalysis(RESULT.replace(':spent {:value 123023998629580', ':spent {:value 123023998629581')), {problems: ['record.totals']});
  const oneRow = RESULT.replace(/:spent \{:value (\d+), :unit "JPY", :basis :derived, :method "sum of 支出済歳出額"\}/, (m, v) => m.replace(v, String(Number(v) + 1)));
  assert.notEqual(oneRow, RESULT);
  assert.deepEqual(importAnalysis(oneRow), {problems: ['record.totals']});
  assert.deepEqual(importAnalysis(RESULT.replace(':kind "awai.public-funds/1"', ':kind "awai.fin-draft/1"')), {problems: ['record.kind']});
  assert.deepEqual(importAnalysis(RESULT.replace(':verified-sha256 true', ':verified-sha256 false')), {problems: ['record.sources']});
  assert.deepEqual(importAnalysis(RESULT.replace('https://www.bb.mof.go.jp/server/2024/csv/DL202411001.zip', 'http://example.invalid/x')), {problems: ['record.sources']});
  assert.deepEqual(importAnalysis('#inst "2026-11-18"'), {problems: ['edn.unsupported']});
  assert.deepEqual(importAnalysis('{:a 1 :a 2}'), {problems: ['edn.duplicate']});
  assert.deepEqual(importAnalysis('{"a" 1}'), {problems: ['edn.key']});
  assert.deepEqual(importAnalysis('{:a 1.5}'), {problems: ['edn.unsupported']});
  assert.deepEqual(importAnalysis('{:a 99999999999999999999}'), {problems: ['edn.number']});
  assert.deepEqual(importAnalysis('{:a [1 2}'), {problems: ['edn.malformed']});
  assert.deepEqual(importAnalysis('x'.repeat(200001)), {problems: ['edn.size']});
  assert.deepEqual(importAnalysis('['.repeat(40) + ']'.repeat(40)), {problems: ['edn.depth']});
});

test('the EDN reader returns plain values and keywords', () => {
  const v = readEdn('{:request/id "x\\"y" :n -12 :ok true :none nil :v [:a/b "c"]}');
  assert.equal(v['request/id'], 'x"y'); assert.equal(v.n, -12); assert.equal(v.ok, true); assert.equal(v.none, null);
  assert.ok(v.v[0] instanceof Keyword); assert.equal(v.v[0].name, 'a/b');
  assert.throws(() => readEdn('{:a 1} {:b 2}'), EdnError);
});

test('stored analyses: add, replace, limit, remove, series and unreadable state', () => {
  const a = imported();
  let s = addAnalysis(emptyState(), a, '2026-11-18T01:00:00.000Z');
  assert.equal(s.analyses.length, 1);
  s = addAnalysis(s, a, '2026-11-18T02:00:00.000Z');
  assert.equal(s.analyses.length, 1); assert.equal(s.analyses[0].importedAt, '2026-11-18T02:00:00.000Z');
  for (let y = 2020; s.analyses.length < MAX_ANALYSES; y++) s = addAnalysis(s, {...a, scope: {...a.scope, fiscalYear: String(y)}}, '2026-11-18T03:00:00.000Z');
  assert.throws(() => addAnalysis(s, {...a, scope: {...a.scope, fiscalYear: '2019'}}, '2026-11-18T03:00:00.000Z'), /too-many-analyses/);
  assert.deepEqual(series(s, 'JP', 'general').map(x => x.fiscalYear), ['2020', '2021', '2022', '2024']);
  assert.deepEqual(decodeState(JSON.parse(JSON.stringify(s))).analyses.length, MAX_ANALYSES);
  assert.ok(JSON.stringify(s).length < 131072, 'fits the host state limit');
  s = removeAnalysis(s, s.analyses[0].key); assert.equal(s.analyses.length, MAX_ANALYSES - 1);
  assert.deepEqual(decodeState(null), emptyState());
  for (const bad of [{schema: 'x', analyses: []}, {schema: STATE_SCHEMA, analyses: [{key: 'k'}]}, {schema: STATE_SCHEMA, analyses: 'no'},
    {schema: STATE_SCHEMA, analyses: Array.from({length: MAX_ANALYSES + 1}, () => ({}))}]) assert.throws(() => decodeState(bad), /unreadable-state/);
});

test('formatting, messages and planned operations', () => {
  assert.equal(formatTrillion(123023998629580, 'ja'), '123.02');
  assert.equal(formatTrillion(-1719507616108, 'en'), '-1.72');
  assert.equal(formatTrillion(null, 'ja'), null);
  assert.deepEqual(Object.keys(MESSAGES.ja).sort(), Object.keys(MESSAGES.en).sort());
  assert.equal(pickLocale(['en-US']), 'en'); assert.equal(pickLocale(['fr']), 'ja');
  assert.equal(translator('en')('unit.trillion', {value: '1.00'}), '¥1.00 tn');
  for (const op of PLANNED_OPERATIONS) assert.ok(MESSAGES.ja['op.' + op.id] && MESSAGES.en['op.' + op.id]);
  for (const d of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', 'null']) assert.ok(MESSAGES.en['cofog.' + d]);
});
