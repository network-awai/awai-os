import {bind_native} from './awai-ui/index.js';
import {createHost} from './host.js';
import {clientRuntimeProblems, createClientConsentHost, createClientOperationBroker} from './runtime.js';
import {runtimeDescriptor, SELECTOR, OPERATION, PLANNED_OPERATIONS, MEDIA_KINDS, RIGHTS_BASES, LICENSES, CONSENT_VERSION, MAX_CONTENT_BYTES,
  cidFromSha256, sha256Hex, contributionProblems, rightsStatement, statementBytes, submissionPayload, importReward,
  decodeState, emptyState, addContribution, recordSubmission, withdraw, addReward} from './model.js';
import {pickLocale, translator} from './messages.js';

bind_native(document.documentElement, {tonal: '.tonal', text: '.link'});
// One declared external operation (submit a contribution). The canonical broker shows the consent dialog
// for every invocation and throws before any request when the participant denies it.
const descriptor = runtimeDescriptor();
if (clientRuntimeProblems(descriptor, [SELECTOR.capability], location.origin).length) throw Error('invalid-runtime');
const broker = createClientOperationBroker({runtime: descriptor, requestedCapabilities: [SELECTOR.capability], approvedOperations: descriptor.operations,
  hostSupportedOperations: [[SELECTOR.capability, SELECTOR.service, SELECTOR.operation]], consentHost: createClientConsentHost()});

let locale = pickLocale(navigator.languages), t = translator(locale);
document.documentElement.lang = locale;
const host = createHost({appId: 'network.itonami.datacontribution'});
// Awai FS: the Tauri host's app-private block store. The web version has none and keeps no bytes.
const tauriInvoke = window.__TAURI__?.core?.invoke;
const awaiFs = tauriInvoke ? {put: (cid, bytes) => tauriInvoke('awai_fs_put', bytes, {headers: {'x-awai-cid': cid}})} : null;
const $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; }
let snapshot = {revision: 0, data: null}, state = emptyState(), busy = false, readOnly = false, notice = '';
const blank = () => ({mediaKind: 'image', file: null, rightsBasis: '', license: LICENSES[0], licenseGrantCid: '',
  contributors: [{humanId: '', did: '', shareBps: '10000'}], depictedPersons: '0', depictedConsentCids: '', noPersonal: false, noSensitive: false, consent: false});
let form = blank();
let rewardText = '';
let armed = null;

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
    } else if (['duplicate-content', 'too-many-contributions', 'too-many-rewards'].includes(e?.message)) say(t('problem.' + e.message));
    else say(t('save.failed', {code: e?.code ?? e?.message ?? 'error'}));
    return false;
  } finally { busy = false; }
}

function labelled(id, key, input, params) {
  const label = el('label', t(key, params)); label.htmlFor = id; input.id = id;
  const err = el('p', null, 'error'); err.id = id + '-error'; input.setAttribute('aria-describedby', err.id);
  return [label, input, err];
}
function select(values, current, text) {
  const s = el('select');
  for (const v of values) { const o = el('option', text(v)); o.value = v; o.selected = v === current; s.append(o); }
  return s;
}
function checkbox(id, key, checked, params) {
  const box = el('div', null, 'check'); const input = el('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
  const label = el('label', t(key, params)); label.htmlFor = id; box.append(input, label); return {box, input};
}
function toContribution(now) {
  const lines = form.depictedConsentCids.split(/\s+/).filter(Boolean);
  return {id: 'c-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16), mediaKind: form.mediaKind, contentCid: form.file?.cid ?? '',
    contentSha256: form.file?.sha256 ?? '', contentBytes: form.file?.bytes ?? 0, title: form.file?.name ?? '',
    rightsBasis: form.rightsBasis, license: form.license, licenseGrantCid: form.rightsBasis === 'third-party-licensed' ? form.licenseGrantCid.trim() : null,
    personalData: form.noPersonal ? false : true, sensitiveData: form.noSensitive ? false : true,
    depictedPersons: /^\d+$/.test(form.depictedPersons) ? Number(form.depictedPersons) : NaN, depictedConsentCids: lines,
    contributors: form.contributors.map(x => ({humanId: x.humanId.trim(), did: x.did.trim(), shareBps: /^\d+$/.test(x.shareBps.trim()) ? Number(x.shareBps) : NaN})),
    trainingConsent: form.consent ? CONSENT_VERSION : null, createdAt: now};
}

function renderContribute() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('contribute.heading')); h.tabIndex = -1;
  const f = el('form'); f.noValidate = true;
  const errors = {};
  const kind = select(MEDIA_KINDS, form.mediaKind, v => t('media.' + v));
  const [kl, , ke] = labelled('mediaKind', 'field.mediaKind', kind); errors.mediaKind = ke;
  const file = el('input'); file.type = 'file';
  const [fl, , fe] = labelled('file', 'field.file', file); errors.content = fe;
  const fileNote = el('p', form.file ? t('file.ready', {cid: form.file.cid, bytes: form.file.bytes}) : '', 'mono');
  f.append(kl, kind, ke, fl, file, fileNote, fe);

  const rights = el('fieldset'); rights.append(el('legend', t('rights.heading')));
  const basis = select(['', ...RIGHTS_BASES], form.rightsBasis, v => t(v ? 'rightsBasis.' + v : 'rightsBasis.none'));
  const [bl, , be] = labelled('rightsBasis', 'field.rightsBasis', basis); errors.rightsBasis = be;
  const license = select(LICENSES, form.license, v => v);
  const [ll, , le] = labelled('license', 'field.license', license); errors.license = le;
  const grant = el('input'); grant.value = form.licenseGrantCid; grant.autocomplete = 'off'; grant.spellcheck = false;
  const [gl, , ge] = labelled('licenseGrantCid', 'field.licenseGrantCid', grant); errors.licenseGrant = ge;
  const grantBox = el('div'); grantBox.append(gl, grant, ge); grantBox.hidden = form.rightsBasis !== 'third-party-licensed';
  const personal = checkbox('noPersonal', 'field.noPersonalData', form.noPersonal);
  const sensitive = checkbox('noSensitive', 'field.noSensitiveData', form.noSensitive);
  errors.personalData = el('p', null, 'error'); errors.sensitiveData = el('p', null, 'error');
  const depicted = el('input'); depicted.inputMode = 'numeric'; depicted.value = form.depictedPersons;
  const [dl, , de] = labelled('depictedPersons', 'field.depictedPersons', depicted); errors.depicted = de;
  const consents = el('textarea'); consents.value = form.depictedConsentCids; consents.spellcheck = false;
  const [cl, , ce] = labelled('depictedConsentCids', 'field.depictedConsentCids', consents);
  rights.append(bl, basis, be, ll, license, le, grantBox, personal.box, errors.personalData, sensitive.box, errors.sensitiveData, dl, depicted, de, cl, consents, ce);

  const people = el('fieldset'); people.append(el('legend', t('contributors.heading')), el('p', t('contributors.note'), 'muted'));
  const rows = el('div'); const total = el('p', null, 'muted'); errors.contributors = el('p', null, 'error');
  const drawRows = () => {
    rows.replaceChildren();
    form.contributors.forEach((x, i) => {
      const row = el('div', null, 'row');
      for (const [k, key, attrs] of [['humanId', 'field.humanId', {}], ['did', 'field.did', {}], ['shareBps', 'field.shareBps', {inputMode: 'numeric'}]]) {
        const input = el('input'); input.value = x[k]; input.autocomplete = 'off'; input.spellcheck = false; Object.assign(input, attrs);
        input.addEventListener('input', () => { x[k] = input.value; showTotal(); });
        const [lab] = labelled(`c${i}-${k}`, key, input); row.append(lab, input);
      }
      if (form.contributors.length > 1) {
        const rm = el('button', t('contributors.remove'), 'tonal'); rm.type = 'button';
        rm.addEventListener('click', () => { form.contributors.splice(i, 1); drawRows(); showTotal(); });
        row.append(rm);
      }
      rows.append(row);
    });
  };
  const showTotal = () => { total.textContent = t('contributors.total', {total: form.contributors.reduce((s, x) => s + (Number(x.shareBps) || 0), 0)}); };
  const add = el('button', t('contributors.add'), 'tonal'); add.type = 'button';
  add.addEventListener('click', () => { if (form.contributors.length < 32) { form.contributors.push({humanId: '', did: '', shareBps: ''}); drawRows(); showTotal(); } });
  drawRows(); showTotal();
  people.append(rows, add, total, errors.contributors);

  const consentBox = el('fieldset'); consentBox.append(el('legend', t('consent.heading')));
  const consent = checkbox('trainingConsent', 'field.trainingConsent', form.consent, {version: CONSENT_VERSION});
  errors.consent = el('p', null, 'error'); consentBox.append(consent.box, errors.consent);

  const save = el('button', t('contribute.save')); save.type = 'submit'; save.disabled = readOnly;
  f.append(rights, people, consentBox, save);
  view.append(h, el('p', t('contribute.note'), 'muted'), f); h.focus();

  const sync = () => {
    form.mediaKind = kind.value; form.rightsBasis = basis.value; form.license = license.value; form.licenseGrantCid = grant.value;
    form.noPersonal = personal.input.checked; form.noSensitive = sensitive.input.checked; form.depictedPersons = depicted.value.trim();
    form.depictedConsentCids = consents.value; form.consent = consent.input.checked;
    grantBox.hidden = form.rightsBasis !== 'third-party-licensed';
  };
  f.addEventListener('input', sync); f.addEventListener('change', sync);
  file.addEventListener('change', async () => {
    const picked = file.files?.[0]; fe.textContent = '';
    if (!picked) return;
    if (picked.size > MAX_CONTENT_BYTES) { form.file = null; fileNote.textContent = ''; fe.textContent = t('file.tooLarge'); return; }
    fileNote.textContent = t('file.hashing');
    const bytes = new Uint8Array(await picked.arrayBuffer()), sha = await sha256Hex(bytes);
    form.file = {name: picked.name, bytes: bytes.byteLength, sha256: sha, cid: cidFromSha256(sha), data: bytes};
    fileNote.textContent = t('file.ready', {cid: form.file.cid, bytes: form.file.bytes});
  });
  f.addEventListener('submit', async e => {
    e.preventDefault(); sync();
    const now = new Date().toISOString(), c = toContribution(now), problems = contributionProblems(c);
    for (const [k, node] of Object.entries(errors)) {
      const code = problems.find(p => p.split('.')[0] === k);
      node.textContent = code ? t('problem.' + code) : '';
    }
    if (problems.length) { say(t('contribute.invalid')); return; }
    const statement = statementBytes(rightsStatement(c, now)), sSha = await sha256Hex(statement);
    const saved = {...c, statementCid: cidFromSha256(sSha), statementSha256: sSha};
    try {
      if (awaiFs) { await awaiFs.put(saved.contentCid, form.file.data); await awaiFs.put(saved.statementCid, statement); }
    } catch (err) { say(t('save.failed', {code: String(err?.message ?? err)})); return; }
    if (await persist(s => addContribution(s, saved))) {
      form = blank();
      // The save is asynchronous: re-render the form only if the participant is still on it.
      if (!location.hash.startsWith('#/') || location.hash === '#/') renderContribute();
      say(t('contribute.saved'));
    }
  });
}

async function submit(c) {
  if (busy || readOnly) return;
  let outcome;
  try {
    const response = await broker.invoke(SELECTOR, submissionPayload(c));
    outcome = {status: response.status, error: null};
  } catch (e) {
    // The broker throws before any request when the participant denies or closes the dialog.
    if (String(e?.message).includes('not approved')) { say(t('submit.denied')); return; }
    outcome = {status: null, error: String(e?.message ?? 'error').slice(0, 120)};
  }
  const now = new Date().toISOString();
  if (await persist(s => recordSubmission(s, c.id, outcome, now))) {
    renderList();
    say(outcome.status === null ? t('submit.failed', {code: outcome.error}) : outcome.status >= 200 && outcome.status < 300
      ? t('submit.accepted', {status: outcome.status}) : t('submit.rejected', {status: outcome.status}));
  }
}
function renderList() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('list.heading')); h.tabIndex = -1; view.append(h);
  if (!state.contributions.length) { view.append(el('p', t('list.empty'), 'muted')); h.focus(); return; }
  const list = el('ul', null, 'results');
  for (const c of [...state.contributions].reverse()) {
    const li = el('li');
    li.append(el('p', `${t('media.' + c.mediaKind)} · ${c.title || c.contentCid.slice(0, 16) + '…'}`, 'amount'));
    const chips = el('ul', null, 'chips');
    chips.append(el('li', t('status.' + c.status), 'chip status-' + c.status), el('li', t('rightsBasis.' + c.rightsBasis), 'chip'), el('li', c.license, 'chip'));
    li.append(chips);
    if (c.lastAttempt) li.append(el('p', t('list.lastAttempt', {result: c.lastAttempt.status ?? c.lastAttempt.error}), 'muted'));
    if (c.withdrawnAt) li.append(el('p', t('list.withdrawnAt', {at: c.withdrawnAt}), 'muted'));
    const details = el('details'); details.append(el('summary', t('list.details')),
      el('p', `${t('list.content')}: ${c.contentCid}`, 'mono'), el('p', `${t('list.statement')}: ${c.statementCid}`, 'mono'),
      ...c.contributors.map(x => el('p', `${x.humanId} · ${x.did} · ${x.shareBps} bps`, 'mono')));
    li.append(details);
    const actions = el('div', null, 'actions');
    if (c.status === 'draft') {
      const send = el('button', t('list.submit')); send.type = 'button'; send.disabled = readOnly;
      send.addEventListener('click', () => submit(c)); actions.append(send);
    }
    if (c.status !== 'withdrawn') {
      const w = el('button', armed === c.id ? t('list.withdrawConfirm') : t('list.withdraw'), 'tonal' + (armed === c.id ? ' armed' : '')); w.type = 'button'; w.disabled = readOnly;
      w.addEventListener('click', async () => {
        if (armed !== c.id) { armed = c.id; renderList(); setTimeout(() => { if (armed === c.id) { armed = null; if (location.hash.startsWith('#/list')) renderList(); } }, 5000); return; }
        armed = null;
        if (await persist(s => withdraw(s, c.id, new Date().toISOString()))) { renderList(); say(t('withdraw.done')); }
      });
      actions.append(w);
    }
    li.append(actions); list.append(li);
  }
  view.append(list); h.focus();
}
function renderRewards() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('rewards.heading')); h.tabIndex = -1;
  const area = el('textarea'); area.value = rewardText; area.spellcheck = false;
  const [label, , err] = labelled('rewardText', 'rewards.label', area);
  area.addEventListener('input', () => { rewardText = area.value; });
  const load = el('button', t('rewards.import')); load.type = 'button'; load.disabled = readOnly;
  load.addEventListener('click', async () => {
    let reward; err.textContent = '';
    try { reward = importReward(area.value, new Date().toISOString()); } catch (e) { err.textContent = t('problem.' + e.message); say(err.textContent); return; }
    if (await persist(s => addReward(s, reward))) { rewardText = ''; renderRewards(); say(t('rewards.imported')); }
  });
  const list = el('ul', null, 'results');
  for (const r of [...state.rewards].reverse()) {
    const li = el('li');
    li.append(el('p', t('rewards.epoch', {epoch: r.epochId, request: r.requestId})), el('ul', null, 'chips'));
    li.lastChild.append(el('li', t('rewards.chip'), 'chip'));
    for (const a of r.allocations) li.append(el('p', `${a.humanId} · ${a.shareBps} bps · ${t('rewards.unit', {units: a.yataUnits})}`, 'mono'));
    li.append(el('p', t('rewards.unallocated', {units: r.unallocatedUnits, pool: r.poolUnits}), 'muted'));
    list.append(li);
  }
  view.append(h, el('p', t('rewards.note'), 'muted'), label, area, err, load, state.rewards.length ? list : el('p', t('rewards.empty'), 'muted')); h.focus();
}
function renderOperations() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('ops.heading')); h.tabIndex = -1;
  const list = el('ul', null, 'results');
  const declared = el('li');
  declared.append(el('p', t('ops.' + OPERATION.operation), 'amount'), el('ul', null, 'chips'),
    el('p', `${OPERATION.endpoint.method} ${OPERATION.endpoint.origin}${OPERATION.endpoint.path}`, 'mono'),
    el('p', OPERATION['data-categories'].join(', '), 'mono'));
  declared.children[1].append(el('li', t('ops.declared'), 'chip'));
  list.append(declared);
  for (const p of PLANNED_OPERATIONS) {
    const li = el('li'); li.append(el('p', t('ops.' + p.id), 'amount'), el('ul', null, 'chips'), el('p', p.endpoint, 'mono'), el('p', t('waits.' + p.waits), 'muted'));
    li.children[1].append(el('li', t('ops.planned'), 'chip'));
    list.append(li);
  }
  view.append(h, el('p', t('ops.note'), 'muted'), list); h.focus();
}
const VIEWS = [['nav-contribute', 'contribute', '#/'], ['nav-list', 'list', '#/list'], ['nav-rewards', 'rewards', '#/rewards'], ['nav-operations', 'operations', '#/operations']];
function route({keepStatus = false} = {}) {
  const hash = location.hash;
  const name = hash.startsWith('#/list') ? 'list' : hash.startsWith('#/rewards') ? 'rewards' : hash.startsWith('#/operations') ? 'operations' : 'contribute';
  for (const [id, n] of VIEWS) { if (n === name) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current'); }
  if (!keepStatus) say(notice ? t(notice) : '');
  ({contribute: renderContribute, list: renderList, rewards: renderRewards, operations: renderOperations})[name]();
}
function chrome() {
  document.title = t('app.title'); $('title').textContent = t('app.title');
  $('nav').setAttribute('aria-label', t('nav.label'));
  for (const [id, n] of VIEWS) $(id).textContent = t('nav.' + n);
  $('footer').textContent = t('footer');
}
function showEnvironment() {
  $('environment').textContent = t('env.line', {runtime: t(host.info().runtime === 'web' ? 'env.web' : 'env.tauri'), fs: t(awaiFs ? 'env.fs.device' : 'env.fs.none')});
}
window.addEventListener('hashchange', () => route());
// On Android a locale change recreates the activity (locale is not in the manifest's configChanges) and
// the page reloads. Runtimes that change the language without a reload arrive here; `form` survives.
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
