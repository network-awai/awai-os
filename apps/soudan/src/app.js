import {renderPoliceGuide} from './police-guide.js';
import {bind_native} from './awai-ui/index.js';
import {createHost} from './host.js';
import {clientRuntimeProblems, createClientConsentHost, createClientOperationBroker} from './runtime.js';
import {CATEGORIES, JURISDICTIONS, LIMITS, emptyDraft, newEvidence, sha256Hex, draftProblems, recipientProblems, assembleMemo, addressedMemo, restoreDraft} from './model.js';
import {pickLocale, translator} from './messages.js';
import {runtimeDescriptor, REQUESTED_CAPABILITIES, SEND_SELECTOR} from './operations.js';
import {createShareHandler} from './send.js';

bind_native(document.documentElement, {tonal: '.tonal', text: '.link'});
// One declared send (see operations.js): the consultation memo to the lawyer the user chose, through the
// Android share sheet. It runs only when the operation is governor-approved and host-supported (otherwise
// it is not in broker.operations and the send button stays disabled) and the user approves this one
// operation in the canonical consent dialog. Denial throws before anything leaves the device.
const tauriInvoke = window.__TAURI__?.core?.invoke;
const SEND_HOST = [SEND_SELECTOR.capability, SEND_SELECTOR.service, SEND_SELECTOR.operation];
async function shareViaSheet(memo) { await tauriInvoke('soudan_share', {text: memo}); }
// The device language picks the consent dialog language (ja when the device is Japanese).
// The declared disclosure facts follow it too (operations.js disclosureFacts;
// the broker shows recipient/data/purpose/withdrawal as declared), as does the app name.
const locale = pickLocale(navigator.languages);
const t = translator(locale);
const descriptor = runtimeDescriptor(locale);
if (clientRuntimeProblems(descriptor, REQUESTED_CAPABILITIES, location.origin).length) throw Error('invalid-runtime');
const broker = createClientOperationBroker({runtime: descriptor, requestedCapabilities: [...REQUESTED_CAPABILITIES], approvedOperations: descriptor.operations,
  hostSupportedOperations: tauriInvoke ? [SEND_HOST] : [],
  browserAdapters: tauriInvoke ? {[SEND_SELECTOR.service]: {[SEND_SELECTOR.operation]: createShareHandler({shareText: shareViaSheet})}} : {},
  consentHost: createClientConsentHost({locale}), app: {name: t('app.title')}});
document.documentElement.lang = locale;
const host = createHost({appId: 'network.itonami.soudan'});
const $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; }
const PARAMS = {'summary.tooLong': {max: LIMITS.summary}, 'timeline.event': {max: LIMITS.event}};
const problemText = key => t(key, PARAMS[key] ?? {});

let draft = emptyDraft(), revision = 0;
async function load() {
  try { const s = await host.read(); revision = s.revision; draft = restoreDraft(s.data); } catch (e) { say(t('saveFailed', {code: e.code ?? 'unknown'})); }
}
async function save() {
  try { const next = await host.write({expectedRevision: revision, data: draft}); revision = next.revision; say(t('saved')); return true; }
  catch (e) {
    if (e.code === 'state-conflict') { await load(); say(t('conflict')); route(); return false; }
    say(t('saveFailed', {code: e.code ?? 'unknown'})); return false;
  }
}

function field(label, id, control, hint) {
  const wrap = el('div', null, 'field'), l = el('label', label); l.htmlFor = id; control.id = id;
  wrap.append(l);
  if (hint) { const h = el('p', hint, 'muted hint'); h.id = id + '-hint'; control.setAttribute('aria-describedby', h.id); wrap.append(h); }
  wrap.append(control); return wrap;
}
function input(value, onInput, {type = 'text', max, autocomplete = 'off'} = {}) {
  const i = el('input'); i.type = type; i.value = value; i.autocomplete = autocomplete; if (max) i.maxLength = max;
  i.addEventListener('input', () => onInput(i.value)); return i;
}
function area(value, onInput, max) {
  const a = el('textarea'); a.value = value; a.rows = 5; a.maxLength = max; a.addEventListener('input', () => onInput(a.value)); return a;
}
function select(value, options, onChange) {
  const s = el('select'), none = el('option', t('field.choose')); none.value = ''; none.selected = !value; s.append(none);
  for (const [v, label] of options) { const o = el('option', label); o.value = v; o.selected = v === value; s.append(o); }
  s.addEventListener('change', () => onChange(s.value || null)); return s;
}
function problemList(keys) {
  const box = el('div', null, 'problems'); box.setAttribute('role', 'alert');
  box.append(el('p', t('problems')));
  const ul = el('ul'); for (const k of keys) ul.append(el('li', problemText(k))); box.append(ul); return box;
}

// ---- input ----
function listEditor(title, items, make, addKey, removeKey, max, render) {
  const fs = el('fieldset'); fs.append(el('legend', title));
  items.forEach((item, i) => {
    const row = el('div', null, 'row');
    row.append(...make(item, i));
    const rm = el('button', t(removeKey), 'link'); rm.type = 'button';
    rm.addEventListener('click', () => { items.splice(i, 1); render(); });
    row.append(rm); fs.append(row);
  });
  if (items.length < max) {
    const add = el('button', t(addKey), 'tonal'); add.type = 'button';
    add.addEventListener('click', () => { items.push(addKey === 'timeline.add' ? {date: '', event: ''} : ''); render(); });
    fs.append(add);
  }
  return fs;
}
// Evidence editor (O11 scope 3): the user types the post URL/date/author and picks a
// screenshot image. Picking records the file name, size, capture time and SHA-256 next to
// the row; the image bytes are never persisted or sent. Rows are deletable by the user.
async function attachShot(entry, files, control) {
  const f = files?.[0];
  if (!f) return;
  if (f.size > LIMITS.evidenceFile) { say(t('evidence.tooBig', {max: LIMITS.evidenceFile})); control.value = ''; return; }
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    entry.shotName = [...f.name].slice(0, LIMITS.evidenceField).join('');
    entry.shotSize = f.size;
    entry.sha256 = sha256Hex(buf);
    entry.capturedAt = new Date().toISOString();
    say(t('evidence.picked', {name: entry.shotName, size: String(entry.shotSize)}));
  } catch { say(t('evidence.hashFail')); }
  renderInput();
}
function evidenceEditor() {
  const fs = el('fieldset'); fs.append(el('legend', t('field.evidence')));
  fs.append(el('p', t('evidence.hint'), 'muted hint'));
  draft.evidence.forEach((e, i) => {
    const box = el('fieldset'); box.append(el('legend', String(i + 1)));
    box.append(
      field(t('evidence.url'), 'ev-url-' + i, input(e.url, v => { e.url = v; }, {type: 'url', max: LIMITS.evidenceUrl})),
      field(t('evidence.postedAt'), 'ev-posted-' + i, input(e.postedAt, v => { e.postedAt = v; }, {type: 'datetime-local'}), t('evidence.postedAtHint')),
      field(t('evidence.authorName'), 'ev-name-' + i, input(e.authorName, v => { e.authorName = v; }, {max: LIMITS.evidenceField})),
      field(t('evidence.authorId'), 'ev-id-' + i, input(e.authorId, v => { e.authorId = v; }, {max: LIMITS.evidenceField})));
    const shot = el('div', null, 'field');
    const lab = el('label', t('evidence.shot')); lab.htmlFor = 'ev-shot-' + i; shot.append(lab);
    const picker = el('input'); picker.type = 'file'; picker.id = 'ev-shot-' + i; picker.accept = 'image/*';
    picker.addEventListener('change', () => attachShot(e, picker.files, picker));
    shot.append(picker);
    const rec = e.sha256 || e.shotName
      ? (e.shotName || t('evidence.noShot')) + ' (' + e.shotSize + ' ' + t('evidence.f.bytes') + ') / ' +
        t('evidence.f.capturedAt') + ': ' + (e.capturedAt || t('evidence.f.none')) + ' / SHA-256: ' + (e.sha256 || t('evidence.f.none'))
      : t('evidence.noShot');
    shot.append(el('p', rec, 'muted hint'));
    box.append(shot);
    const rm = el('button', t('evidence.remove'), 'link'); rm.type = 'button';
    rm.addEventListener('click', () => { draft.evidence.splice(i, 1); renderInput(); });
    box.append(rm); fs.append(box);
  });
  if (draft.evidence.length < LIMITS.evidence) {
    const add = el('button', t('evidence.add'), 'tonal'); add.type = 'button';
    add.addEventListener('click', () => { draft.evidence.push(newEvidence()); renderInput(); });
    fs.append(add);
  }
  return fs;
}
// Fixed guidance (O11 scope 2 and 4): a general retention note with sources and dates,
// the user-facing routes, the official form pointer, and the on-device storage note.
// Nothing here judges the matter and nothing computes a deadline.
function guideBlock() {
  const s = el('section'); s.setAttribute('aria-labelledby', 'guide-h');
  const h = el('h3', t('guide.title')); h.id = 'guide-h'; s.append(h);
  s.append(el('p', t('guide.noJudgment'), 'muted'));
  s.append(el('p', t('guide.deadline')));
  s.append(el('p', t('guide.source'), 'muted'));
  const ul = el('ul');
  for (let i = 1; i <= 6; i++) ul.append(el('li', t('guide.route.' + i)));
  s.append(ul);
  s.append(el('p', t('guide.forms')));
  s.append(el('p', t('guide.storage'), 'muted'));
  return s;
}
function renderInput(problems = []) {
  const view = $('view'); view.replaceChildren();
  view.append(el('p', t('intro'), 'muted'));
  if (problems.length) view.append(problemList(problems));
  const form = el('form'); form.noValidate = true;
  form.append(
    field(t('field.jurisdiction'), 'jurisdiction', select(draft.jurisdiction, Object.keys(JURISDICTIONS).map(k => [k, t('jurisdiction.' + k)]), v => { draft.jurisdiction = v; }), t('jurisdiction.note')),
    field(t('field.category'), 'category', select(draft.category, CATEGORIES.map(c => [c, t('category.' + c)]), v => { draft.category = v; })),
    field(t('field.summary'), 'summary', area(draft.summary, v => { draft.summary = v; }, LIMITS.summary), t('field.summaryHint')),
    listEditor(t('field.timeline'), draft.timeline, (e, i) => [
      field(t('field.date'), 'tl-date-' + i, input(e.date, v => { e.date = v; }, {type: 'date'})),
      field(t('field.event'), 'tl-event-' + i, input(e.event, v => { e.event = v; }, {max: LIMITS.event}))],
    'timeline.add', 'timeline.remove', LIMITS.timeline, () => renderInput()),
    field(t('field.otherParty'), 'otherParty', input(draft.otherParty, v => { draft.otherParty = v; }, {max: LIMITS.otherParty})),
    field(t('field.wish'), 'wish', area(draft.wish, v => { draft.wish = v; }, LIMITS.wish)),
    field(t('field.deadline'), 'deadline', input(draft.deadline, v => { draft.deadline = v; }, {max: LIMITS.deadline})),
    listEditor(t('field.documents'), draft.documents, (d, i) => [
      field(t('field.document'), 'doc-' + i, input(d, v => { draft.documents[i] = v; }, {max: LIMITS.document}))],
    'documents.add', 'documents.remove', LIMITS.documents, () => renderInput()),
    evidenceEditor(),
    guideBlock(),
    field(t('field.name'), 'name', input(draft.name, v => { draft.name = v; }, {max: LIMITS.name, autocomplete: 'name'})),
    field(t('field.contact'), 'contact', input(draft.contact, v => { draft.contact = v; }, {max: LIMITS.contact, autocomplete: 'email'})));
  const actions = el('div', null, 'actions');
  const saveButton = el('button', t('save'), 'tonal'); saveButton.type = 'button';
  saveButton.addEventListener('click', () => save());
  const assemble = el('button', t('assemble')); assemble.type = 'submit';
  actions.append(saveButton, assemble); form.append(actions);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const p = draftProblems(draft);
    if (p.length) { renderInput(p); $('view').querySelector('.problems')?.focus?.(); say(t('problems')); return; }
    if (await save()) location.hash = '#/memo';
  });
  view.append(form);
}

// ---- memo, recipient, send ----
function renderMemo() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('memo.heading')); h.tabIndex = -1; view.append(h);
  if (draftProblems(draft).length) { view.append(el('p', t('memo.incomplete'))); h.focus(); return; }
  const memo = assembleMemo(draft, t);
  const doc = el('article', null, 'memo'); doc.setAttribute('aria-labelledby', 'memo-title');
  const title = el('h3', memo.title); title.id = 'memo-title'; doc.append(title);
  for (const s of memo.sections) doc.append(el('h4', s.heading), el('p', s.body, 'body'));
  doc.append(el('p', memo.notice, 'muted'));
  view.append(el('p', t('memo.check'), 'muted'), doc);

  const r = el('section'); r.setAttribute('aria-labelledby', 'recipient-h');
  const rh = el('h3', t('recipient.heading')); rh.id = 'recipient-h';
  r.append(rh, el('p', t('recipient.note'), 'muted'),
    field(t('recipient.name'), 'r-name', input(draft.recipient.name, v => { draft.recipient.name = v; refresh(); }, {max: LIMITS.name})),
    field(t('recipient.office'), 'r-office', input(draft.recipient.office, v => { draft.recipient.office = v; refresh(); }, {max: LIMITS.office})),
    field(t('recipient.contact'), 'r-contact', input(draft.recipient.contact, v => { draft.recipient.contact = v; refresh(); }, {max: LIMITS.contact})));
  const confirmBox = el('input'); confirmBox.type = 'checkbox'; confirmBox.id = 'confirm';
  const confirmLabel = el('label', t('confirm.label'), 'check'); confirmLabel.prepend(confirmBox);
  const send = el('button', t('send')); send.type = 'button';
  const note = el('p', t('send.note'), 'muted');
  function refresh() { send.disabled = !confirmBox.checked || recipientProblems(draft.recipient).length > 0 || broker.operations.length === 0; }
  confirmBox.addEventListener('change', refresh);
  send.addEventListener('click', async e => {
    if (!e.isTrusted) return;
    if (recipientProblems(draft.recipient).length || broker.operations.length === 0) { say(t('send.blocked')); return; }
    // A new send starts here: drop the previous result line first, so a stale
    // "not sent" is not still showing behind the chooser (App QA r2 point 2).
    say('');
    const to = {name: draft.recipient.name.trim(), office: (draft.recipient.office ?? '').trim(), contact: draft.recipient.contact.trim()};
    try { await broker.invoke(SEND_SELECTOR, {memo: addressedMemo(memo.text, to, t), recipient: to}); say(t('send.shared')); }
    catch { say(t('send.blocked')); }
  });
  const saveButton = el('button', t('save'), 'tonal'); saveButton.type = 'button'; saveButton.addEventListener('click', () => save());
  const actions = el('div', null, 'actions'); actions.append(saveButton, send);
  r.append(confirmLabel, actions, note);
  view.append(r);
  refresh(); h.focus();
}

function route() {
  const policeRoute = location.hash.match(/^#\/police(?:\/([A-Z]{3}))?$/);
  const page = policeRoute ? 'police' : location.hash.startsWith('#/memo') ? 'memo' : 'input';
  for (const a of document.querySelectorAll('nav a')) {
    if (a.id === 'nav-' + page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  say('');
  if (policeRoute) renderPoliceGuide($('view'), locale, policeRoute[1]);
  else if (page === 'memo') renderMemo();
  else renderInput();
}
function chrome() {
  document.title = t('app.title');
  $('title').textContent = t('app.title');
  $('nav').setAttribute('aria-label', t('nav.label'));
  $('nav-input').textContent = t('nav.input');
  $('nav-memo').textContent = t('nav.memo');
  $('nav-police').textContent = locale === 'ja' ? '警察への届出' : 'Police reporting';
  $('footer').textContent = t('footer');
}
window.addEventListener('hashchange', route);
async function start() {
  chrome();
  try { await host.initialize(); } catch { say(t('host.failed')); }
  $('environment').textContent = t('env.line', {runtime: t(host.info().runtime === 'web' ? 'env.web' : 'env.tauri')});
  await load();
  route();
}
start();
