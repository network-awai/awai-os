import {bind_native} from './awai-ui/index.js';
import {createHost} from './host.js';
import {clientRuntimeProblems, createClientConsentHost, createClientOperationBroker} from './runtime.js';
import {importAnalysis, byMinistry, byDivision, flows, orders, sankeyLayout, decodeState, emptyState, addAnalysis, removeAnalysis, series,
  formatTrillion, formatYen, PLANNED_OPERATIONS, STATE_SCHEMA, MAX_ANALYSES, MAX_IMPORT_CHARS} from './model.js';
import {pickLocale, translator} from './messages.js';

bind_native(document.documentElement, {tonal: '.tonal', text: '.link'});
// No external operations: fetching from a publisher, publishing and receiving from the bot are later units (ADR 0046 O1, O2).
const descriptor = {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
  'local-state': {adapter: 'localstorage', schema: STATE_SCHEMA, version: 1}, workers: [], operations: []};
if (clientRuntimeProblems(descriptor, [], location.origin).length) throw Error('invalid-runtime');
createClientOperationBroker({runtime: descriptor, requestedCapabilities: [], approvedOperations: [], hostSupportedOperations: [], consentHost: createClientConsentHost()});

let locale = pickLocale(navigator.languages), t = translator(locale);
document.documentElement.lang = locale;
const host = createHost({appId: 'network.itonami.publicfunds'});
const $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
const SVG = 'http://www.w3.org/2000/svg';
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; }
function svg(tag, attrs) { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; }
const tn = yen => yen === null ? '—' : formatTrillion(yen, locale);
const money = yen => { const s = el('span', t('unit.trillion', {value: tn(yen)})); if (yen !== null) s.title = t('unit.exact', {value: formatYen(yen, locale)}); return s; };
// readOnly: the stored analyses could not be read. Importing or deleting would replace them.
let snapshot = {revision: 0, data: null}, state = emptyState(), busy = false, readOnly = false, notice = '';
let selectedKey = '', measure = 'spent', importText = '';

async function load() {
  const next = await host.read();
  try { state = decodeState(next.data); snapshot = next; readOnly = false; }
  catch (e) { readOnly = true; throw e; }
}
async function persist(change) {
  if (busy) return false;
  if (readOnly) { say(t('state.readOnly')); return false; }
  busy = true;
  try {
    const next = change(state);
    snapshot = await host.write({expectedRevision: snapshot.revision, data: next}); state = decodeState(snapshot.data); return true;
  } catch (e) {
    if (e?.code === 'state-conflict') {
      try { await load(); say(t('save.conflict')); } catch { say(readOnly ? t('state.unreadable') : t('state.failed')); }
      route({keepStatus: true});
    } else if (e?.message === 'too-many-analyses') say(t('analyses.full', {max: MAX_ANALYSES}));
    else say(t('save.failed', {code: e?.code ?? e?.message ?? 'error'}));
    return false;
  } finally { busy = false; }
}
const current = () => state.analyses.find(e => e.key === selectedKey) ?? state.analyses[state.analyses.length - 1];
const scopeLine = a => t('scope.line', {country: t('country.' + a.scope.country), level: t('level.' + a.scope.level), account: t('account.' + a.scope.account), year: a.scope.fiscalYear});
const divisionName = d => (d === null ? '' : d + ' ') + t('cofog.' + d);
function chip(text, cls = '') { return el('span', text, 'chip' + (cls ? ' ' + cls : '')); }
function chips(...xs) { const p = el('p', null, 'chips'); p.append(...xs); return p; }

// Header of every view: the scope of the selected result, and a picker when several are stored.
function head(view, titleKey) {
  const h = el('h2', t(titleKey)); h.tabIndex = -1; view.append(h);
  const e = current();
  if (!e) {
    // With unreadable storage the status line already says so; do not claim there is nothing.
    if (!readOnly) { const box = el('section', null, 'card'); const go = el('a', t('empty.go'), 'button'); go.href = '#/import';
      box.append(el('h3', t('empty.title')), el('p', t('import.sub'), 'muted'), go); view.append(box); }
    h.focus(); return null;
  }
  view.append(el('p', scopeLine(e.analysis), 'muted'));
  if (state.analyses.length > 1) {
    const label = el('label', t('pick.label')); label.htmlFor = 'pick';
    const s = el('select'); s.id = 'pick';
    for (const x of state.analyses) { const o = el('option', `${x.analysis.id} · ${t('saved.year', {year: x.analysis.scope.fiscalYear})}`); o.value = x.key; o.selected = x.key === e.key; s.append(o); }
    s.addEventListener('change', () => { selectedKey = s.value; route(); });
    view.append(label, s);
  }
  h.focus(); return e.analysis;
}

function renderFlow() {
  const view = $('view'); view.replaceChildren();
  const a = head(view, 'flow.heading'); if (!a) return;
  const seg = el('p', null, 'actions'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', t('measure.label'));
  for (const m of ['spent', 'initial']) {
    const b = el('button', t('measure.' + m), m === measure ? '' : 'tonal'); b.type = 'button'; b.setAttribute('aria-pressed', String(m === measure));
    b.addEventListener('click', () => { measure = m; renderFlow(); }); seg.append(b);
  }
  view.append(seg);
  const links = flows(a, measure);
  const ord = orders(links);
  const W = 360, H = 420, x0 = 96, x1 = W - 128;
  const g = sankeyLayout(links, {height: H, ...ord});
  const chart = svg('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('flow.chartLabel', {measure: t('measure.' + measure)}), class: 'sankey'});
  const c = (x0 + x1) / 2;
  for (const l of g.links) {
    const p = svg('path', {d: `M${x0} ${l.y0} C${c} ${l.y0} ${c} ${l.y1} ${x1} ${l.y1} L${x1} ${l.y1 + l.h} C${c} ${l.y1 + l.h} ${c} ${l.y0 + l.h} ${x0} ${l.y0 + l.h} Z`,
      class: l.to === null || l.from === null ? 'link faint' : 'link'});
    p.append(svg('title', {})); p.lastChild.textContent = `${l.from ?? t('flow.other')} → ${divisionName(l.to)}: ${t('unit.trillion', {value: tn(l.value)})}`;
    chart.append(p);
  }
  const label = (x, y, text, anchor, cls) => { const n = svg('text', {x, y, 'text-anchor': anchor, 'dominant-baseline': 'middle', class: cls}); n.textContent = text; return n; };
  for (const n of g.left) { chart.append(svg('rect', {x: x0 - 6, y: n.y, width: 6, height: Math.max(n.h, 1), class: n.key === null ? 'node faint' : 'node'}),
    label(x0 - 10, n.y + n.h / 2, n.key ?? t('flow.other'), 'end', 'label')); }
  // Nodes too thin to carry a readable label are named under the chart instead (and in the table).
  const small = [];
  for (const n of g.right) {
    chart.append(svg('rect', {x: x1, y: n.y, width: 6, height: Math.max(n.h, 1), class: n.key === null ? 'node faint' : 'node'}));
    if (n.h >= 12) chart.append(label(x1 + 10, n.y + n.h / 2, (n.key === null ? '' : n.key + ' ') + t('short.' + n.key), 'start', n.key === null ? 'label muted' : 'label'));
    else small.push(`${divisionName(n.key)} ${t('unit.trillion', {value: tn(n.value)})}`);
  }
  view.append(chart);
  if (small.length) view.append(el('p', t('flow.small', {list: small.join(' · ')}), 'muted small'));
  const unmapped = byDivision(a, measure).get(null) ?? 0;
  view.append(chips(chip(t('chip.derived')), chip(t('chip.assumed')), chip(t('chip.unmapped', {value: tn(unmapped)}))), el('p', t('flow.note'), 'muted'));
  // The full table: every ministry x division row of the record, not the grouped chart.
  const details = el('details'); details.append(el('summary', t('flow.table')));
  const table = el('table', null, 'lines'); const hr = el('tr');
  for (const k of ['flow.from', 'flow.to', 'flow.value']) hr.append(el('th', t(k)));
  table.append(hr);
  for (const r of a.rows.filter(r => (r[measure] ?? 0) !== 0)) { const tr = el('tr'); const v = el('td', null, 'num'); v.append(money(r[measure])); tr.append(el('td', r.ministry), el('td', divisionName(r.division)), v); table.append(tr); }
  details.append(table); view.append(details);
}

function metric(labelKey, yen, basis) {
  const box = el('div', null, 'metric'); const v = el('p', null, 'value'); v.append(money(yen));
  box.append(el('p', t(labelKey), 'muted'), v, el('p', basis, 'muted small')); return box;
}
function renderBudget() {
  const view = $('view'); view.replaceChildren();
  const a = head(view, 'budget.heading'); if (!a) return;
  const grid = el('div', null, 'metrics');
  const c = a.checks;
  grid.append(metric('total.initial', a.totals.initial, t('basis.derived')), metric('total.outturnBudget', a.totals.outturnBudget, t('basis.afterSupplement')),
    metric('total.spent', a.totals.spent, t('basis.rows', {rows: c.identityCurrent.rows.toLocaleString(locale)})),
    metric('total.left', a.totals.carriedOut + a.totals.unused, t('basis.derived')));
  view.append(grid);
  const checks = el('section', null, 'card');
  const res = x => x.result === 'match' ? t('check.match') : t('check.differs', {count: x.differing.toLocaleString(locale)});
  const ministries = byMinistry(a);
  checks.append(el('h3', t('checks.heading')),
    chips(chip(t('check.current', {rows: c.identityCurrent.rows.toLocaleString(locale), result: res(c.identityCurrent)}), c.identityCurrent.result === 'match' ? 'ok' : 'fail'),
      chip(t('check.disposition', {rows: c.identityDisposition.rows.toLocaleString(locale), result: res(c.identityDisposition)}), c.identityDisposition.result === 'match' ? 'ok' : 'fail')),
    el('p', t('checks.coverage', {count: ministries.length, only: c.coverage.onlyInitial.length + c.coverage.onlyOutturn.length, sources: a.sources.length}), 'muted'));
  view.append(checks);
  const s = series(state, a.scope.country, a.scope.account);
  const sc = el('section', null, 'card'); sc.append(el('h3', t('series.heading')));
  const list = el('ul');
  for (const x of s) list.append(el('li', t('series.row', {year: x.fiscalYear, initial: tn(x.initial), spent: tn(x.spent)})));
  sc.append(list); if (s.length < 2) sc.append(el('p', t('series.single'), 'muted'));
  view.append(sc, el('h3', t('ministries.heading')));
  const max = Math.max(1, ...ministries.map(m => Math.max(m.initial, m.spent)));
  const ul = el('ul', null, 'results');
  for (const m of [...ministries].sort((x, y) => y.spent - x.spent || (x.ministry < y.ministry ? -1 : 1))) {
    const li = el('li');
    const bars = el('div', null, 'bars'); bars.setAttribute('aria-hidden', 'true');
    for (const [cls, v] of [['bar initial', m.initial], ['bar spent', m.spent]]) { const b = el('span', null, cls); b.style.inlineSize = (100 * v / max).toFixed(2) + '%'; bars.append(b); }
    const diff = (m.difference > 0 ? '+' : '') + tn(m.difference);
    li.append(el('p', m.ministry, 'amount'), bars, el('p', t('ministry.amounts', {initial: tn(m.initial), spent: tn(m.spent)}), 'muted'), el('p', t('ministry.diff', {diff})));
    ul.append(li);
  }
  view.append(ul, el('p', t('ministries.note'), 'muted'));
}

function renderSources() {
  const view = $('view'); view.replaceChildren();
  const a = head(view, 'sources.heading'); if (!a) return;
  for (const s of a.sources) {
    const card = el('section', null, 'card');
    card.append(el('h3', s.title), el('p', s.publisher, 'muted'),
      chips(chip(t('source.sha', {short: s.sha256.slice(0, 8) + '…' + s.sha256.slice(-8)}), 'ok'), chip(t('source.fetched', {date: s.fetchedAt.slice(0, 10)})), chip(t('source.processed'))));
    const d = el('details'); d.append(el('summary', t('source.details')));
    const dl = el('dl');
    for (const [k, v] of [['source.url', s.url], ['source.full', s.sha256], ['source.archive', s.archiveSha256], ['source.license', s.license]]) if (v) dl.append(el('dt', t(k)), el('dd', v, k === 'source.license' ? '' : 'mono'));
    d.append(dl); card.append(d); view.append(card);
  }
  const map = el('section', null, 'card');
  const list = xs => xs.length ? xs.join(', ') : t('map.none');
  map.append(el('h3', t('map.heading')), el('p', t('map.note'), 'muted'),
    chips(...(a.cofogMapVersion ? [chip(t('map.version', {version: a.cofogMapVersion}))] : []), chip(t('map.unmapped', {codes: list(a.checks.codes.unmapped)})), chip(t('map.unknown', {codes: list(a.checks.codes.unknown)}))));
  view.append(map);
  if (a.openPoints.length) {
    const op = el('section', null, 'card notice'); const d = el('details'); d.append(el('summary', t('open.points')));
    const ul = el('ul', null, 'points'); for (const p of a.openPoints) ul.append(el('li', p)); d.append(ul);
    op.append(el('h3', t('open.heading')), d); view.append(op);
  }
}

function armed(button, act) {
  let timer = null;
  button.addEventListener('click', async () => {
    if (!timer) {
      button.textContent = t('saved.deleteConfirm'); button.classList.add('armed'); say(t('saved.deleteArmed'));
      timer = setTimeout(() => { timer = null; button.textContent = t('saved.delete'); button.classList.remove('armed'); }, 5000);
      return;
    }
    clearTimeout(timer); timer = null; await act();
  });
}
function renderImport() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('import.heading')); h.tabIndex = -1;
  const fileLabel = el('label', t('import.file')); fileLabel.htmlFor = 'importFile';
  const file = el('input'); file.id = 'importFile'; file.type = 'file'; file.accept = '.edn,application/edn,text/plain'; file.disabled = readOnly;
  const label = el('label', t('import.paste')); label.htmlFor = 'importEdn';
  const area = el('textarea', null, 'mono'); area.id = 'importEdn'; area.rows = 8; area.spellcheck = false; area.value = importText; area.maxLength = MAX_IMPORT_CHARS;
  const err = el('div', null, 'error-box'); err.id = 'importEdn-error'; err.setAttribute('role', 'alert'); err.hidden = true; area.setAttribute('aria-describedby', err.id);
  const result = el('div');
  const showProblem = code => { err.replaceChildren(el('p', t('import.invalid'), 'strong'), el('p', t('problem.' + code)), el('p', t('import.unchanged'), 'muted')); err.hidden = false; area.setAttribute('aria-invalid', 'true'); };
  const run = () => {
    importText = area.value;
    const r = importAnalysis(area.value);
    if (r.problems) { showProblem(r.problems[0]); result.replaceChildren(); }
    else { err.hidden = true; area.removeAttribute('aria-invalid'); result.replaceChildren(el('p', t('import.ok', {id: r.analysis.id, year: r.analysis.scope.fiscalYear, rows: r.analysis.rows.length}))); }
    return r;
  };
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; if (!f) return;
    try { area.value = f.size > MAX_IMPORT_CHARS * 4 ? '' : await f.text(); } catch { showProblem('file.read'); return; }
    if (!area.value) { showProblem('edn.size'); return; }
    const r = run(); say(r.problems ? t('import.invalid') : t('import.ok', {id: r.analysis.id, year: r.analysis.scope.fiscalYear, rows: r.analysis.rows.length}));
  });
  const check = el('button', t('import.check'), 'tonal'); check.type = 'button';
  check.addEventListener('click', () => { const r = run(); say(r.problems ? t('import.invalid') : t('import.ok', {id: r.analysis.id, year: r.analysis.scope.fiscalYear, rows: r.analysis.rows.length})); });
  const save = el('button', t('import.save')); save.type = 'button'; save.disabled = readOnly;
  save.addEventListener('click', async () => {
    const r = run();
    if (r.problems) { say(t('import.invalid')); area.focus(); return; }
    if (await persist(s => addAnalysis(s, r.analysis, new Date().toISOString()))) {
      selectedKey = state.analyses.find(e => e.analysis.id === r.analysis.id && e.analysis.scope.fiscalYear === r.analysis.scope.fiscalYear)?.key ?? '';
      importText = ''; area.value = ''; result.replaceChildren(); say(t('import.saved')); renderSaved();
    }
  });
  const actions = el('p', null, 'actions'); actions.append(check, save);
  const saved = el('section'); saved.id = 'saved';
  const ops = el('section', null, 'card'); const ul = el('ul');
  for (const op of PLANNED_OPERATIONS) ul.append(el('li', t('op.' + op.id)));
  ops.append(el('h3', t('ops.heading')), ul);
  view.append(h, el('p', t('import.sub'), 'muted'));
  if (readOnly) { const n = el('section', null, 'card notice'); n.setAttribute('role', 'note'); n.append(el('p', t('state.unreadable'))); view.append(n); }
  view.append(fileLabel, file, label, area, err, actions, result, saved, ops);
  renderSaved(); h.focus();
}
function renderSaved() {
  const box = $('saved'); if (!box) return; box.replaceChildren();
  if (!state.analyses.length) return;
  box.append(el('h3', t('saved.heading')));
  const ul = el('ul', null, 'results');
  for (const e of state.analyses) {
    const li = el('li'); const a = e.analysis;
    const time = el('time', new Date(e.importedAt).toLocaleString(locale)); time.dateTime = e.importedAt;
    li.append(el('p', a.id, 'amount'), chips(chip(t('saved.year', {year: a.scope.fiscalYear})), chip(t('saved.rows', {rows: a.rows.length})), chip(t('saved.sources', {count: a.sources.length}), 'ok')));
    const when = el('p', null, 'muted small'); when.append(time); li.append(when);
    const del = el('button', t('saved.delete'), 'tonal'); del.type = 'button'; del.disabled = readOnly;
    armed(del, async () => { if (await persist(s => removeAnalysis(s, e.key))) { say(t('saved.deleted')); renderSaved(); } });
    const actions = el('p', null, 'actions'); actions.append(del); li.append(actions); ul.append(li);
  }
  box.append(ul);
}

const VIEWS = [['nav-flow', 'flow', '#/'], ['nav-budget', 'budget', '#/budget'], ['nav-sources', 'sources', '#/sources'], ['nav-import', 'import', '#/import']];
function route({keepStatus = false} = {}) {
  const hash = location.hash;
  const name = (VIEWS.find(([, , h]) => h !== '#/' && hash.startsWith(h)) ?? VIEWS[0])[1];
  for (const [id, n] of VIEWS) { if (n === name) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current'); }
  if (!keepStatus) say(notice ? t(notice) : '');
  ({flow: renderFlow, budget: renderBudget, sources: renderSources, import: renderImport})[name]();
}
function chrome() {
  document.title = t('app.title'); $('title').textContent = t('app.title');
  $('nav').setAttribute('aria-label', t('nav.label'));
  for (const [id, n] of VIEWS) $(id).textContent = t('nav.' + n);
  $('footer').textContent = t('footer');
}
function showEnvironment() { $('environment').textContent = t('env.line', {runtime: t(host.info().runtime === 'web' ? 'env.web' : 'env.tauri')}); }
window.addEventListener('hashchange', () => route());
window.addEventListener('languagechange', () => {
  const next = pickLocale(navigator.languages); if (next === locale) return;
  locale = next; t = translator(locale); document.documentElement.lang = locale;
  chrome(); showEnvironment(); route();
});
async function start() {
  chrome();
  try { await host.initialize(); } catch { notice = 'host.failed'; }
  try { await load(); } catch { notice = readOnly ? 'state.unreadable' : 'state.failed'; }
  showEnvironment();
  route();
}
start();
