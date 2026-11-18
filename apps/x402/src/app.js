import {bind_native} from './awai-ui/index.js';
import {createHost} from './host.js';
import {clientRuntimeProblems, createClientConsentHost, createClientOperationBroker} from './runtime.js';
import {buildRequirement, challenge, formatUsd, decodeState, emptyState, addDraft, removeDraft, PLANNED_OPERATIONS, STATE_SCHEMA, MAX_DRAFTS} from './model.js';
import {pickLocale, translator} from './messages.js';

bind_native(document.documentElement, {tonal: '.tonal', text: '.link'});
// No external operations: payment requests, wallet signatures and settlement are later units with their own consent.
const descriptor = {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
  'local-state': {adapter: 'localstorage', schema: STATE_SCHEMA, version: 1}, workers: [], operations: []};
if (clientRuntimeProblems(descriptor, [], location.origin).length) throw Error('invalid-runtime');
createClientOperationBroker({runtime: descriptor, requestedCapabilities: [], approvedOperations: [], hostSupportedOperations: [], consentHost: createClientConsentHost()});

let locale = pickLocale(navigator.languages), t = translator(locale);
document.documentElement.lang = locale;
const host = createHost({appId: 'network.itonami.x402'});
const $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; }
// readOnly: the stored drafts could not be read. Writing would replace them, so saving and
// deleting stay off until the app is restarted with readable state.
// notice: the message key of a startup problem that stays on screen across view changes.
let snapshot = {revision: 0, data: null}, state = emptyState(), busy = false, readOnly = false, notice = '';
const form = {amount: '0.01', payTo: '', resource: '/', description: ''};

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

function field(id, key, value, attrs = {}) {
  const label = el('label', t(key)); label.htmlFor = id;
  const input = el('input'); input.id = id; input.value = value; input.autocomplete = 'off'; input.spellcheck = false;
  Object.assign(input, attrs);
  const err = el('p', null, 'error'); err.id = id + '-error'; input.setAttribute('aria-describedby', err.id);
  return {label, input, err};
}
function renderDraft() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('draft.heading')); h.tabIndex = -1;
  const f = el('form'); f.noValidate = true;
  const fields = {
    amount: field('amount', 'field.amount', form.amount, {inputMode: 'decimal'}),
    payTo: field('payTo', 'field.payTo', form.payTo, {placeholder: '0x…'}),
    resource: field('resource', 'field.resource', form.resource, {inputMode: 'url'}),
    description: field('description', 'field.description', form.description, {maxLength: 200})};
  for (const x of Object.values(fields)) f.append(x.label, x.input, x.err);
  const save = el('button', t('draft.save')); save.type = 'submit'; save.disabled = readOnly;
  const pre = el('pre', null, 'mono preview'); pre.setAttribute('aria-label', t('draft.preview'));
  f.append(save);
  view.append(h, el('p', t('draft.note'), 'muted'), f, el('h3', t('draft.preview')), pre);
  const owner = {amount: 'amount', payTo: 'payTo', resource: 'resource', description: 'description'};
  const update = (show) => {
    for (const k of Object.keys(form)) form[k] = fields[k].input.value;
    const result = buildRequirement(form);
    for (const [k, x] of Object.entries(fields)) {
      const code = (result.problems ?? []).find(p => p.split('.')[0] === owner[k]);
      x.err.textContent = show && code ? t('problem.' + code) : '';
      if (show && code) x.input.setAttribute('aria-invalid', 'true'); else x.input.removeAttribute('aria-invalid');
    }
    pre.textContent = result.requirement ? JSON.stringify(challenge(result.requirement), null, 2) : '';
    return result;
  };
  f.addEventListener('input', () => update(false));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const result = update(true);
    if (!result.requirement) { say(t('draft.invalid')); f.querySelector('[aria-invalid]')?.focus(); return; }
    if (await persist(s => addDraft(s, result.requirement, {id: crypto.randomUUID(), now: new Date().toISOString()}))) say(t('draft.saved'));
  });
  update(false); h.focus();
}
function renderDrafts() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('drafts.heading')); h.tabIndex = -1; view.append(h);
  // With unreadable stored drafts the list is empty only because nothing could be
  // read; the status line already says so, so do not also claim there are no drafts.
  if (!state.drafts.length) { if (!readOnly) view.append(el('p', t('drafts.empty'), 'muted')); h.focus(); return; }
  view.append(el('p', t('drafts.count', {count: state.drafts.length}), 'muted'));
  const list = el('ul', null, 'results');
  for (const d of state.drafts) {
    const li = el('li'), q = d.requirement;
    const time = el('time', new Date(d.createdAt).toLocaleString(locale)); time.dateTime = d.createdAt;
    li.append(el('p', t('drafts.amount', {amount: formatUsd(q.maxAmountRequired)}), 'amount'), el('p', q.resource, 'mono'),
      el('p', q.payTo, 'mono muted'), q.description ? el('p', q.description) : '', el('p', null, 'muted'));
    li.lastChild.append(time, ' · ', t('drafts.network'));
    const actions = el('p', null, 'actions');
    const copy = el('button', t('drafts.copy'), 'tonal'); copy.type = 'button';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(challenge(q), null, 2)); say(t('drafts.copied')); } catch { say(t('drafts.copyFailed')); } });
    const del = el('button', t('drafts.delete'), 'tonal'); del.type = 'button'; del.disabled = readOnly;
    // Drafts exist only on this device and deletion cannot be undone, so the first
    // tap arms the button and only a second tap within 5 s deletes.
    let armed = null;
    del.addEventListener('click', async () => {
      if (!armed) {
        del.textContent = t('drafts.deleteConfirm'); del.classList.add('armed'); say(t('drafts.deleteArmed'));
        armed = setTimeout(() => { armed = null; del.textContent = t('drafts.delete'); del.classList.remove('armed'); }, 5000);
        return;
      }
      clearTimeout(armed); armed = null;
      if (await persist(s => removeDraft(s, d.id))) { renderDrafts(); say(t('drafts.deleted')); }
    });
    actions.append(copy, del); li.append(actions); list.append(li);
  }
  view.append(list); h.focus();
}
function renderOperations() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('ops.heading')); h.tabIndex = -1;
  const list = el('ul', null, 'results');
  for (const op of PLANNED_OPERATIONS) { const li = el('li'); li.append(el('p', t('op.' + op.id)), el('p', null, 'chips')); li.lastChild.append(el('span', t('ops.disabled'), 'chip')); list.append(li); }
  view.append(h, el('p', t('ops.note'), 'muted'), list); h.focus();
}
function route({keepStatus = false} = {}) {
  const hash = location.hash, name = hash.startsWith('#/drafts') ? 'drafts' : hash.startsWith('#/operations') ? 'operations' : 'draft';
  for (const [id, n] of [['nav-draft', 'draft'], ['nav-drafts', 'drafts'], ['nav-operations', 'operations']]) {
    if (n === name) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
  if (!keepStatus) say(notice ? t(notice) : '');
  if (name === 'drafts') renderDrafts(); else if (name === 'operations') renderOperations(); else renderDraft();
}
function chrome() {
  document.title = t('app.title'); $('title').textContent = t('app.title');
  $('nav').setAttribute('aria-label', t('nav.label'));
  $('nav-draft').textContent = t('nav.draft'); $('nav-drafts').textContent = t('nav.drafts'); $('nav-operations').textContent = t('nav.operations');
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
