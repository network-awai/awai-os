import {bind_native} from './awai-ui/index.js';
import {createHost} from './host.js';
import {clientRuntimeProblems, createClientConsentHost, createClientOperationBroker} from './runtime.js';
import {buildRequirement, challenge, formatUsd, decodeState, emptyState, addDraft, removeDraft, PLANNED_OPERATIONS, STATE_SCHEMA} from './model.js';
import {pickLocale, translator} from './messages.js';

bind_native(document.documentElement, {tonal: '.tonal', text: '.link'});
// No external operations: payment requests, wallet signatures and settlement are later units with their own consent.
const descriptor = {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
  'local-state': {adapter: 'localstorage', schema: STATE_SCHEMA, version: 1}, workers: [], operations: []};
if (clientRuntimeProblems(descriptor, [], location.origin).length) throw Error('invalid-runtime');
createClientOperationBroker({runtime: descriptor, requestedCapabilities: [], approvedOperations: [], hostSupportedOperations: [], consentHost: createClientConsentHost()});

const locale = pickLocale(navigator.languages), t = translator(locale);
document.documentElement.lang = locale;
const host = createHost({appId: 'network.itonami.x402'});
const $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; }
let snapshot = {revision: 0, data: null}, state = emptyState(), busy = false;
const form = {amount: '0.01', payTo: '', resource: '/', description: ''};

async function persist(next) {
  if (busy) return false; busy = true;
  try { snapshot = await host.write({expectedRevision: snapshot.revision, data: next}); state = decodeState(snapshot.data); return true; }
  catch (e) { say(t('save.failed', {code: e?.code ?? 'error'})); return false; }
  finally { busy = false; }
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
  const save = el('button', t('draft.save')); save.type = 'submit';
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
    if (await persist(addDraft(state, result.requirement, {id: crypto.randomUUID(), now: new Date().toISOString()}))) say(t('draft.saved'));
  });
  update(false); h.focus();
}
function renderDrafts() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('drafts.heading')); h.tabIndex = -1; view.append(h);
  if (!state.drafts.length) { view.append(el('p', t('drafts.empty'), 'muted')); h.focus(); return; }
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
    const del = el('button', t('drafts.delete'), 'tonal'); del.type = 'button';
    del.addEventListener('click', async () => { if (await persist(removeDraft(state, d.id))) { say(t('drafts.deleted')); renderDrafts(); } });
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
function route() {
  const hash = location.hash, name = hash.startsWith('#/drafts') ? 'drafts' : hash.startsWith('#/operations') ? 'operations' : 'draft';
  for (const [id, n] of [['nav-draft', 'draft'], ['nav-drafts', 'drafts'], ['nav-operations', 'operations']]) {
    if (n === name) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
  say('');
  if (name === 'drafts') renderDrafts(); else if (name === 'operations') renderOperations(); else renderDraft();
}
function chrome() {
  document.title = t('app.title'); $('title').textContent = t('app.title');
  $('nav').setAttribute('aria-label', t('nav.label'));
  $('nav-draft').textContent = t('nav.draft'); $('nav-drafts').textContent = t('nav.drafts'); $('nav-operations').textContent = t('nav.operations');
  $('footer').textContent = t('footer');
}
window.addEventListener('hashchange', route);
async function start() {
  chrome();
  try { await host.initialize(); } catch { say(t('host.failed')); }
  try { snapshot = await host.read(); state = decodeState(snapshot.data); } catch { say(t('state.failed')); }
  const info = host.info();
  $('environment').textContent = t('env.line', {runtime: t(info.runtime === 'web' ? 'env.web' : 'env.tauri')});
  route();
}
start();
