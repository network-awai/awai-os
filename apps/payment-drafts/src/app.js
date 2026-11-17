import {bind_native} from './awai-ui/index.js';
import {createHost} from './host.js';
import {clientRuntimeProblems, createClientConsentHost, createClientOperationBroker} from './runtime.js';
import {buildInstruction, toXml, importXml, l1Checks, decodeState, emptyState, addDraft, setApproved, removeDraft,
  PLANNED_OPERATIONS, STATE_SCHEMA, MAX_DRAFTS, CHARGE_BEARERS} from './model.js';
import {pickLocale, translator} from './messages.js';

bind_native(document.documentElement, {tonal: '.tonal', text: '.link'});
// No external operations: sending to a bank, statements and receiving bot drafts are later units with their own consent.
const descriptor = {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
  'local-state': {adapter: 'localstorage', schema: STATE_SCHEMA, version: 1}, workers: [], operations: []};
if (clientRuntimeProblems(descriptor, [], location.origin).length) throw Error('invalid-runtime');
createClientOperationBroker({runtime: descriptor, requestedCapabilities: [], approvedOperations: [], hostSupportedOperations: [], consentHost: createClientConsentHost()});

let locale = pickLocale(navigator.languages), t = translator(locale);
document.documentElement.lang = locale;
const host = createHost({appId: 'network.itonami.paymentdrafts'});
const $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; }
// readOnly: the stored drafts could not be read. Writing would replace them, so saving,
// approving and deleting stay off until the app is restarted with readable state.
// notice: the message key of a startup problem that stays on screen across view changes.
let snapshot = {revision: 0, data: null}, state = emptyState(), busy = false, readOnly = false, notice = '';
const form = {debtorName: '', debtorIban: '', debtorBic: '', creditorName: '', creditorIban: '', creditorBic: '',
  amount: '', currency: 'EUR', executionDate: '', chargeBearer: 'SLEV', endToEndId: '', instructionId: '', uetr: '', remittance: ''};
let importText = '';

// Read the stored drafts. snapshot (the revision the next write expects) is only
// taken over when its drafts decode, so unreadable drafts are never overwritten.
async function load() {
  const next = await host.read();
  try { state = decodeState(next.data); snapshot = next; readOnly = false; }
  catch (e) { readOnly = true; throw e; }
}
// change: state -> next state. Model errors (such as the draft limit) and host
// errors are both reported; a revision conflict re-reads what is stored now.
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
      // The limit was checked against the drafts read earlier; another window may have
      // deleted some since. Re-read, and only report the limit when nothing changed.
      const seen = snapshot.revision;
      try { await load(); } catch { say(readOnly ? t('state.unreadable') : t('state.failed')); route({keepStatus: true}); return false; }
      if (snapshot.revision !== seen) { say(t('save.conflict')); route({keepStatus: true}); }
      else say(t('drafts.full', {max: MAX_DRAFTS}));
    } else say(t('save.failed', {code: e?.code ?? e?.message ?? 'error'}));
    return false;
  } finally { busy = false; }
}

// A new draft gets its own message ids and creation time.
function newMeta() {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  return {msgId: 'PD-' + id, paymentInfoId: 'PD-' + id + '-1', creationDateTime: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')};
}
function field(id, key, value, attrs = {}) {
  const label = el('label', t(key)); label.htmlFor = id;
  const input = el('input'); input.id = id; input.value = value; input.autocomplete = 'off'; input.spellcheck = false;
  Object.assign(input, attrs);
  const err = el('p', null, 'error'); err.id = id + '-error'; input.setAttribute('aria-describedby', err.id);
  return {label, input, err};
}
function checksView(instruction) {
  const box = el('section', null, 'checks');
  box.append(el('h3', t('check.heading')));
  const list = el('ul', null, 'chips');
  for (const c of l1Checks(instruction)) {
    const li = el('li', `${t(c.pass ? 'check.pass' : 'check.fail')} · ${t('check.' + c.rule)}`, 'chip' + (c.pass ? '' : ' fail'));
    list.append(li);
  }
  box.append(list, el('p', t('check.levels'), 'muted'));
  return box;
}
function renderDraft() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('draft.heading')); h.tabIndex = -1;
  const f = el('form'); f.noValidate = true;
  const fields = {
    debtorName: field('debtorName', 'field.debtorName', form.debtorName, {maxLength: 140}),
    debtorIban: field('debtorIban', 'field.debtorIban', form.debtorIban, {autocapitalize: 'characters'}),
    debtorBic: field('debtorBic', 'field.debtorBic', form.debtorBic, {autocapitalize: 'characters', maxLength: 11}),
    creditorName: field('creditorName', 'field.creditorName', form.creditorName, {maxLength: 140}),
    creditorIban: field('creditorIban', 'field.creditorIban', form.creditorIban, {autocapitalize: 'characters'}),
    creditorBic: field('creditorBic', 'field.creditorBic', form.creditorBic, {autocapitalize: 'characters', maxLength: 11}),
    amount: field('amount', 'field.amount', form.amount, {inputMode: 'decimal'}),
    currency: field('currency', 'field.currency', form.currency, {autocapitalize: 'characters', maxLength: 3}),
    executionDate: field('executionDate', 'field.executionDate', form.executionDate, {type: 'date'}),
    endToEndId: field('endToEndId', 'field.endToEndId', form.endToEndId, {maxLength: 35}),
    instructionId: field('instructionId', 'field.instructionId', form.instructionId, {maxLength: 35}),
    uetr: field('uetr', 'field.uetr', form.uetr),
    remittance: field('remittance', 'field.remittance', form.remittance, {maxLength: 140})};
  const charge = el('select'); charge.id = 'chargeBearer';
  for (const c of CHARGE_BEARERS) { const o = el('option', t('charge.' + c)); o.value = c; o.selected = c === form.chargeBearer; charge.append(o); }
  const chargeLabel = el('label', t('field.chargeBearer')); chargeLabel.htmlFor = charge.id;
  for (const [k, x] of Object.entries(fields)) {
    f.append(x.label, x.input, x.err);
    if (k === 'executionDate') f.append(chargeLabel, charge);
  }
  const gen = el('button', t('draft.uetr'), 'tonal'); gen.type = 'button';
  gen.addEventListener('click', () => { fields.uetr.input.value = crypto.randomUUID(); update(false); });
  fields.uetr.err.before(gen);
  const save = el('button', t('draft.save')); save.type = 'submit'; save.disabled = readOnly;
  const pre = el('pre', null, 'mono preview'); pre.setAttribute('aria-label', t('draft.preview'));
  const checks = el('div');
  f.append(save);
  view.append(h, el('p', t('draft.note'), 'muted'), f, el('h3', t('draft.preview')), pre, checks);
  let meta = newMeta();
  const update = (show) => {
    for (const k of Object.keys(fields)) form[k] = fields[k].input.value;
    form.chargeBearer = charge.value;
    const result = buildInstruction(form, meta);
    for (const [k, x] of Object.entries(fields)) {
      const code = (result.problems ?? []).find(p => p.split('.')[0] === k || (k === 'amount' && p.startsWith('amount.')));
      x.err.textContent = show && code ? t('problem.' + code) : '';
      if (show && code) x.input.setAttribute('aria-invalid', 'true'); else x.input.removeAttribute('aria-invalid');
    }
    pre.textContent = result.instruction ? toXml(result.instruction) : '';
    checks.replaceChildren(...(result.instruction ? [checksView(result.instruction)] : []));
    return result;
  };
  f.addEventListener('input', () => update(false));
  f.addEventListener('change', () => update(false));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const result = update(true);
    if (!result.instruction) { say(t('draft.invalid')); f.querySelector('[aria-invalid]')?.focus(); return; }
    if (await persist(s => addDraft(s, result.instruction, {id: crypto.randomUUID(), now: new Date().toISOString(), source: 'form'}))) {
      say(t('draft.saved')); meta = newMeta(); update(false);
    }
  });
  update(false); h.focus();
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
    const r = importXml(area.value);
    err.textContent = r.problems ? t('problem.' + r.problems[0]) : '';
    if (r.problems) area.setAttribute('aria-invalid', 'true'); else area.removeAttribute('aria-invalid');
    result.replaceChildren(...(r.instruction ? [el('p', t('import.ok')), checksView(r.instruction)] : []));
    return r;
  };
  check.addEventListener('click', () => { const r = run(); say(r.problems ? t('draft.invalid') : t('import.ok')); });
  save.addEventListener('click', async () => {
    const r = run();
    if (!r.instruction) { say(t('draft.invalid')); area.focus(); return; }
    if (await persist(s => addDraft(s, r.instruction, {id: crypto.randomUUID(), now: new Date().toISOString(), source: 'import'}))) {
      say(t('import.saved')); importText = ''; area.value = ''; result.replaceChildren();
    }
  });
  const actions = el('p', null, 'actions'); actions.append(check, save);
  view.append(h, el('p', t('import.note'), 'muted'), label, area, err, actions, result); h.focus();
}
function armed(button, idleKey, confirmKey, armedKey, act) {
  // The first tap arms the button; only a second tap within 5 s acts.
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
  // With unreadable stored drafts the list is empty only because nothing could be
  // read; the status line already says so, so do not claim there are no drafts.
  if (!state.drafts.length) { if (!readOnly) view.append(el('p', t('drafts.empty'), 'muted')); h.focus(); return; }
  view.append(el('p', t('drafts.count', {count: state.drafts.length}), 'muted'));
  const list = el('ul', null, 'results');
  for (const d of state.drafts) {
    const li = el('li'), i = d.instruction;
    const time = el('time', new Date(d.createdAt).toLocaleString(locale)); time.dateTime = d.createdAt;
    const chips = el('p', null, 'chips');
    chips.append(el('span', t('drafts.status.' + d.status), 'chip' + (d.status === 'approved' ? ' ok' : '')), el('span', t('drafts.source.' + d.source), 'chip'));
    li.append(el('p', t('drafts.amount', {amount: i.amount, currency: i.currency}), 'amount'),
      el('p', `${i.debtorName} → ${i.creditorName}`), el('p', `${i.creditorIban} · ${i.creditorBic}`, 'mono muted'),
      el('p', `${i.endToEndId} · ${i.executionDate}`, 'mono muted'), chips, el('p', null, 'muted'));
    li.lastChild.append(time);
    const actions = el('p', null, 'actions');
    const copy = el('button', t('drafts.copy'), 'tonal'); copy.type = 'button';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(toXml(i)); say(t('drafts.copied')); } catch { say(t('drafts.copyFailed')); } });
    const approve = el('button', t(d.status === 'approved' ? 'drafts.unapprove' : 'drafts.approve'), 'tonal'); approve.type = 'button'; approve.disabled = readOnly;
    approve.addEventListener('click', async () => {
      const on = d.status !== 'approved';
      if (await persist(s => setApproved(s, d.id, on, new Date().toISOString()))) { renderDrafts(); say(t(on ? 'drafts.approved' : 'drafts.unapproved')); }
    });
    const del = el('button', t('drafts.delete'), 'tonal'); del.type = 'button'; del.disabled = readOnly;
    // Drafts exist only on this device and deletion cannot be undone.
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
const VIEWS = [['nav-draft', 'draft', '#/'], ['nav-import', 'import', '#/import'], ['nav-drafts', 'drafts', '#/drafts'], ['nav-operations', 'operations', '#/operations']];
function route({keepStatus = false} = {}) {
  const hash = location.hash;
  const name = hash.startsWith('#/import') ? 'import' : hash.startsWith('#/drafts') ? 'drafts' : hash.startsWith('#/operations') ? 'operations' : 'draft';
  for (const [id, n] of VIEWS) { if (n === name) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current'); }
  if (!keepStatus) say(notice ? t(notice) : '');
  ({draft: renderDraft, import: renderImport, drafts: renderDrafts, operations: renderOperations})[name]();
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
// On Android a locale change recreates the activity (locale is not in the
// manifest's configChanges) and the page reloads. Runtimes that change the
// language without a reload (desktop WebView, browser) arrive here instead;
// form values live in `form` and survive.
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
