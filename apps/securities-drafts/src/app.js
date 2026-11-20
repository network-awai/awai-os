import {bind_native} from './awai-ui/index.js';
import {createHost} from './host.js';
import {clientRuntimeProblems, createClientConsentHost, createClientOperationBroker} from './runtime.js';
import {buildInstruction, instructionXml, statementXml, importInstruction, importStatement, l1Checks, parsePositions, reconcileHoldings,
  decodeState, emptyState, addInstruction, addStatement, setApproved, removeDraft, PLANNED_OPERATIONS, STATE_SCHEMA, MAX_DRAFTS,
  TRANSACTION_TYPES, NS} from './model.js';
import {pickLocale, translator} from './messages.js';

bind_native(document.documentElement, {tonal: '.tonal', text: '.link'});
// No external operations: sending to a custodian and receiving statements are later units with their own consent.
const descriptor = {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
  'local-state': {adapter: 'localstorage', schema: STATE_SCHEMA, version: 1}, workers: [], operations: []};
if (clientRuntimeProblems(descriptor, [], location.origin).length) throw Error('invalid-runtime');
createClientOperationBroker({runtime: descriptor, requestedCapabilities: [], approvedOperations: [], hostSupportedOperations: [], consentHost: createClientConsentHost()});

let locale = pickLocale(navigator.languages), t = translator(locale);
document.documentElement.lang = locale;
const host = createHost({appId: 'network.itonami.securitiesdrafts'});
const $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; }
// readOnly: the stored drafts could not be read. Writing would replace them, so saving,
// approving and deleting stay off until the app is restarted with readable state.
let snapshot = {revision: 0, data: null}, state = emptyState(), busy = false, readOnly = false, notice = '';
const form = {txId: '', direction: 'receive', paymentType: 'against-payment', settlementDate: '', isin: '', description: '', quantity: '',
  safekeepingAccount: '', transactionType: 'TRAD', placeOfSettlement: '', agent: '', currency: 'USD', amount: ''};
let importText = '', positionsText = '', holdingsStatementId = '';

async function load() {
  const next = await host.read();
  try { state = decodeState(next.data); snapshot = next; readOnly = false; }
  catch (e) { readOnly = true; throw e; }
}
// change: state -> next state. A revision conflict re-reads; the limit is reported after a re-read.
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
    } else if (e?.message === 'too-many-drafts') {
      const seen = snapshot.revision;
      try { await load(); } catch { say(readOnly ? t('state.unreadable') : t('state.failed')); route({keepStatus: true}); return false; }
      if (snapshot.revision !== seen) { say(t('save.conflict')); route({keepStatus: true}); }
      else say(t('drafts.full', {max: MAX_DRAFTS}));
    } else say(t('save.failed', {code: e?.code ?? e?.message ?? 'error'}));
    return false;
  } finally { busy = false; }
}

function field(id, key, value, attrs = {}) {
  const label = el('label', t(key)); label.htmlFor = id;
  const input = el('input'); input.id = id; input.value = value; input.autocomplete = 'off'; input.spellcheck = false;
  Object.assign(input, attrs);
  const err = el('p', null, 'error'); err.id = id + '-error'; input.setAttribute('aria-describedby', err.id);
  return {label, input, err};
}
function select(id, key, value, options) {
  const label = el('label', t(key)); label.htmlFor = id;
  const input = el('select'); input.id = id;
  for (const [v, text] of options) { const o = el('option', text); o.value = v; o.selected = v === value; input.append(o); }
  const err = el('p', null, 'error'); err.id = id + '-error'; input.setAttribute('aria-describedby', err.id);
  return {label, input, err};
}
function checksView(instruction) {
  const box = el('section', null, 'checks');
  box.append(el('h3', t('check.heading')));
  const list = el('ul', null, 'chips');
  for (const c of l1Checks(instruction)) list.append(el('li', `${t(c.pass ? 'check.pass' : 'check.fail')} · ${t('check.' + c.rule)}`, 'chip' + (c.pass ? '' : ' fail')));
  box.append(list, el('p', t('check.levels'), 'muted'));
  return box;
}
function renderDraft() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('draft.heading')); h.tabIndex = -1;
  const f = el('form'); f.noValidate = true;
  const fields = {
    txId: field('txId', 'field.txId', form.txId, {maxLength: 35}),
    direction: select('direction', 'field.direction', form.direction, [['receive', t('direction.receive')], ['deliver', t('direction.deliver')]]),
    paymentType: select('paymentType', 'field.paymentType', form.paymentType, [['against-payment', t('paymentType.against-payment')], ['free', t('paymentType.free')]]),
    settlementDate: field('settlementDate', 'field.settlementDate', form.settlementDate, {type: 'date'}),
    isin: field('isin', 'field.isin', form.isin, {autocapitalize: 'characters', maxLength: 12}),
    description: field('description', 'field.description', form.description, {maxLength: 140}),
    quantity: field('quantity', 'field.quantity', form.quantity, {inputMode: 'decimal'}),
    safekeepingAccount: field('safekeepingAccount', 'field.safekeepingAccount', form.safekeepingAccount, {maxLength: 35}),
    transactionType: select('transactionType', 'field.transactionType', form.transactionType, TRANSACTION_TYPES.map(c => [c, c])),
    placeOfSettlement: field('placeOfSettlement', 'field.placeOfSettlement', form.placeOfSettlement, {autocapitalize: 'characters', maxLength: 11}),
    agent: field('agent', 'field.agent', form.agent, {autocapitalize: 'characters', maxLength: 11}),
    currency: field('currency', 'field.currency', form.currency, {autocapitalize: 'characters', maxLength: 3}),
    amount: field('amount', 'field.amount', form.amount, {inputMode: 'decimal'})};
  for (const x of Object.values(fields)) f.append(x.label, x.input, x.err);
  const save = el('button', t('draft.save')); save.type = 'submit'; save.disabled = readOnly;
  const pre = el('pre', null, 'mono preview'); pre.setAttribute('aria-label', t('draft.preview'));
  const checks = el('div');
  f.append(save);
  view.append(h, el('p', t('draft.note'), 'muted'), f, el('h3', t('draft.preview')), pre, checks);
  const update = (show) => {
    for (const k of Object.keys(fields)) form[k] = fields[k].input.value;
    const apmt = form.paymentType === 'against-payment';
    for (const k of ['currency', 'amount']) for (const n of [fields[k].label, fields[k].input, fields[k].err]) n.hidden = !apmt;
    const result = buildInstruction(form);
    for (const [k, x] of Object.entries(fields)) {
      const code = (result.problems ?? []).find(p => p.split('.')[0] === k);
      x.err.textContent = show && code ? t('problem.' + code) : '';
      if (show && code) x.input.setAttribute('aria-invalid', 'true'); else x.input.removeAttribute('aria-invalid');
    }
    pre.textContent = result.instruction ? instructionXml(result.instruction) : '';
    checks.replaceChildren(...(result.instruction ? [checksView(result.instruction)] : []));
    return result;
  };
  f.addEventListener('input', () => update(false));
  f.addEventListener('change', () => update(false));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const result = update(true);
    if (!result.instruction) { say(t('draft.invalid')); f.querySelector('[aria-invalid]')?.focus(); return; }
    if (await persist(s => addInstruction(s, result.instruction, {id: crypto.randomUUID(), now: new Date().toISOString(), source: 'form'}))) say(t('draft.saved'));
  });
  update(false); h.focus();
}
// The message kind is decided by its namespace; each kind has its own strict importer.
function importAny(xml) {
  if (xml.includes(NS.semt002)) return {kind: 'statement', ...importStatement(xml), message: 'semt.002.001.10'};
  return {kind: 'instruction', ...importInstruction(xml), message: 'sese.023.001.09'};
}
function renderImport() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('import.heading')); h.tabIndex = -1;
  const label = el('label', t('import.label')); label.htmlFor = 'importXml';
  const area = el('textarea', null, 'mono'); area.id = 'importXml'; area.rows = 10; area.spellcheck = false; area.value = importText;
  const err = el('p', null, 'error'); err.id = 'importXml-error'; area.setAttribute('aria-describedby', err.id);
  const result = el('div');
  const check = el('button', t('import.check'), 'tonal'); check.type = 'button';
  const save = el('button', t('import.save')); save.type = 'button'; save.disabled = readOnly;
  const run = () => {
    importText = area.value;
    const r = importAny(area.value);
    err.textContent = r.problems ? t('problem.' + r.problems[0], {line: 0}) : '';
    if (r.problems) area.setAttribute('aria-invalid', 'true'); else area.removeAttribute('aria-invalid');
    result.replaceChildren(...(r.problems ? [] : [el('p', t('import.ok', {message: r.message})), ...(r.instruction ? [checksView(r.instruction)] : [])]));
    return r;
  };
  check.addEventListener('click', () => { const r = run(); say(r.problems ? t('draft.invalid') : t('import.ok', {message: r.message})); });
  save.addEventListener('click', async () => {
    const r = run();
    if (r.problems) { say(t('draft.invalid')); area.focus(); return; }
    const meta = {id: crypto.randomUUID(), now: new Date().toISOString()};
    const ok = await persist(s => r.instruction ? addInstruction(s, r.instruction, {...meta, source: 'import'}) : addStatement(s, r.statement, meta));
    if (ok) { say(t('import.saved')); importText = ''; area.value = ''; result.replaceChildren(); }
  });
  const actions = el('p', null, 'actions'); actions.append(check, save);
  view.append(h, el('p', t('import.note'), 'muted'), label, area, err, actions, result); h.focus();
}
function renderHoldings() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('holdings.heading')); h.tabIndex = -1;
  view.append(h, el('p', t('holdings.note'), 'muted'));
  const statements = state.drafts.filter(d => d.kind === 'statement');
  if (!statements.length) { view.append(el('p', t('holdings.none'), 'muted')); h.focus(); return; }
  if (!statements.some(d => d.id === holdingsStatementId)) holdingsStatementId = statements[0].id;
  const pick = select('holdingsStatement', 'holdings.statement', holdingsStatementId,
    statements.map(d => [d.id, t('drafts.statement', {date: d.statement.statementDate, account: d.statement.safekeepingAccount, count: d.statement.balances.length})]));
  const label = el('label', t('holdings.positions')); label.htmlFor = 'positions';
  const area = el('textarea', null, 'mono'); area.id = 'positions'; area.rows = 6; area.spellcheck = false; area.value = positionsText;
  const err = el('p', null, 'error'); err.id = 'positions-error'; area.setAttribute('aria-describedby', err.id);
  const compare = el('button', t('holdings.compare')); compare.type = 'button';
  const out = el('div');
  compare.addEventListener('click', () => {
    positionsText = area.value; holdingsStatementId = pick.input.value;
    const r = parsePositions(area.value);
    if (r.problems) { err.textContent = t('problem.' + r.problems[0].code, {line: r.problems[0].line}); area.setAttribute('aria-invalid', 'true'); out.replaceChildren(); return; }
    err.textContent = ''; area.removeAttribute('aria-invalid');
    const lines = reconcileHoldings(statements.find(d => d.id === holdingsStatementId).statement, r.positions);
    const table = el('table', null, 'lines'); const head = el('tr');
    for (const k of ['holdings.isin', 'holdings.statementQty', 'holdings.holderQty', 'holdings.result']) head.append(el('th', t(k)));
    table.append(head);
    for (const l of lines) {
      const row = el('tr'); row.append(el('td', l.isin, 'mono'), el('td', l.statement ?? '—', 'mono'), el('td', l.holder ?? '—', 'mono'),
        el('td', t('result.' + l.result), l.result === 'match' ? 'ok' : 'warn'));
      table.append(row);
    }
    const match = lines.filter(l => l.result === 'match').length;
    out.replaceChildren(el('p', t('holdings.summary', {match, other: lines.length - match})), table);
    say(t('holdings.summary', {match, other: lines.length - match}));
  });
  view.append(pick.label, pick.input, label, area, err, compare, out); h.focus();
}
function armed(button, idleKey, confirmKey, armedKey, act) {
  let timer = null;
  button.addEventListener('click', async () => {
    if (!timer) {
      button.textContent = t(confirmKey); button.classList.add('armed'); say(t(armedKey));
      timer = setTimeout(() => { timer = null; button.textContent = t(idleKey); button.classList.remove('armed'); }, 5000);
      return;
    }
    clearTimeout(timer); timer = null;
    await act();
  });
}
function renderDrafts() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('drafts.heading')); h.tabIndex = -1; view.append(h);
  // With unreadable stored drafts the status line already says so; do not claim there is nothing.
  if (!state.drafts.length) { if (!readOnly) view.append(el('p', t('drafts.empty'), 'muted')); h.focus(); return; }
  view.append(el('p', t('drafts.count', {count: state.drafts.length}), 'muted'));
  const list = el('ul', null, 'results');
  for (const d of state.drafts) {
    const li = el('li');
    const time = el('time', new Date(d.createdAt).toLocaleString(locale)); time.dateTime = d.createdAt;
    const chips = el('p', null, 'chips');
    chips.append(el('span', t('drafts.kind.' + d.kind), 'chip'), el('span', t('drafts.status.' + d.status), 'chip' + (d.status === 'approved' ? ' ok' : '')),
      el('span', t('drafts.source.' + d.source), 'chip'));
    if (d.kind === 'instruction') {
      const i = d.instruction;
      li.append(el('p', t('drafts.instruction', {dir: t('direction.' + i.direction), quantity: i.quantity, isin: i.isin}), 'amount'),
        el('p', `${i.txId} · ${i.settlementDate} · ${t('paymentType.' + i.paymentType)}${i.amount ? ` · ${i.amount.currency} ${i.amount.value}` : ''}`, 'mono muted'));
    } else {
      const s = d.statement;
      li.append(el('p', t('drafts.statement', {date: s.statementDate, account: s.safekeepingAccount, count: s.balances.length}), 'amount'));
    }
    li.append(chips, el('p', null, 'muted')); li.lastChild.append(time);
    const actions = el('p', null, 'actions');
    const copy = el('button', t('drafts.copy'), 'tonal'); copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(d.kind === 'instruction' ? instructionXml(d.instruction) : statementXml(d.statement)); say(t('drafts.copied')); }
      catch { say(t('drafts.copyFailed')); }
    });
    const approve = el('button', t(d.status === 'approved' ? 'drafts.unapprove' : 'drafts.approve'), 'tonal'); approve.type = 'button'; approve.disabled = readOnly;
    approve.addEventListener('click', async () => {
      const on = d.status !== 'approved';
      if (await persist(s => setApproved(s, d.id, on, new Date().toISOString()))) { renderDrafts(); say(t(on ? 'drafts.approved' : 'drafts.unapproved')); }
    });
    const del = el('button', t('drafts.delete'), 'tonal'); del.type = 'button'; del.disabled = readOnly;
    armed(del, 'drafts.delete', 'drafts.deleteConfirm', 'drafts.deleteArmed', async () => {
      if (await persist(s => removeDraft(s, d.id))) { renderDrafts(); say(t('drafts.deleted')); }
    });
    actions.append(copy, approve, del); li.append(actions); list.append(li);
  }
  view.append(list); h.focus();
}
function renderOperations() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('ops.heading')); h.tabIndex = -1;
  const list = el('ul', null, 'results');
  for (const op of PLANNED_OPERATIONS) {
    const li = el('li'); li.append(el('p', t('op.' + op.id)), el('p', t('ops.waits', {what: t('waits.' + op.id)}), 'muted'), el('p', null, 'chips'));
    li.lastChild.append(el('span', t('ops.disabled'), 'chip')); list.append(li);
  }
  view.append(h, el('p', t('ops.note'), 'muted'), list); h.focus();
}
const VIEWS = [['nav-draft', 'draft', '#/'], ['nav-import', 'import', '#/import'], ['nav-holdings', 'holdings', '#/holdings'],
  ['nav-drafts', 'drafts', '#/drafts'], ['nav-operations', 'operations', '#/operations']];
function route({keepStatus = false} = {}) {
  const hash = location.hash;
  const name = (VIEWS.find(([, n, h]) => h !== '#/' && hash.startsWith(h)) ?? VIEWS[0])[1];
  for (const [id, n] of VIEWS) { if (n === name) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current'); }
  if (!keepStatus) say(notice ? t(notice) : '');
  ({draft: renderDraft, import: renderImport, holdings: renderHoldings, drafts: renderDrafts, operations: renderOperations})[name]();
}
function chrome() {
  document.title = t('app.title'); $('title').textContent = t('app.title');
  $('nav').setAttribute('aria-label', t('nav.label'));
  for (const [id, n] of VIEWS) $(id).textContent = t('nav.' + n);
  $('footer').textContent = t('footer');
}
function showEnvironment() {
  $('environment').textContent = t('env.line', {runtime: t(host.info().runtime === 'web' ? 'env.web' : 'env.tauri')});
}
window.addEventListener('hashchange', () => route());
// On Android a locale change recreates the activity and the page reloads; elsewhere
// languagechange re-renders and form values in `form` survive.
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
