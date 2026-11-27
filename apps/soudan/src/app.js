import {bind_native} from './awai-ui/index.js';
import {createHost} from './host.js';
import {
  browserClientSaveTarget, clientRuntimeProblems, clientSaveFileName,
  createClientConsentHost, createClientOperationBroker,
} from './runtime.js';
import {
  CATEGORIES, JURISDICTIONS, LIMITS, assembleMemo, draftDisplayTitle, draftProblems,
  newEvidence, parseLawyerCardPaste, recipientProblems, restoreDraft, sha256Hex,
} from './model.js';
import {pickLocale, translator} from './messages.js';
import {
  INFERENCE_SELECTOR, REQUESTED_CAPABILITIES, SEND_SELECTOR, runtimeDescriptor,
} from './operations.js';
import {createShareHandler, createWebParityHandler, detectExecutionRoute} from './send.js';
import {DEFAULT_INFERENCE_CONFIG, OFFICIAL_ROUTE_KEYS} from './inference.js';
import {createSemanticStore} from './semantic.js';
import {createStandaloneSafeHost} from './storage.js';

bind_native(document.documentElement, {tonal: '.tonal', text: '.link'});

// sandbox="allow-scripts" safe form helper: never relies on native form submit or requestSubmit().
export function bindForm(container, onSubmit) {
  const buttons = container.querySelectorAll('button[data-submit]');
  for (const btn of buttons) {
    btn.addEventListener('click', e => {
      e.preventDefault();
      onSubmit(e);
    });
  }
  container.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target?.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'file') {
      e.preventDefault();
    }
  });
}

// Pure helper for status feedback on mutating semantic operations (P1 #3):
// NEVER reports success when persist failed or conflicted.
export function statusMessageForMutation(res, successKey, t) {
  if (res?.ok) return t(successKey);
  if (res?.conflict) return t('conflict');
  return t('saveFailed', {code: res?.error ?? res?.gateName ?? 'unknown'});
}

const tauriInvoke = window.__TAURI__?.core?.invoke;
const execRoute = detectExecutionRoute({tauriInvoke, nav: navigator});
const SEND_HOST = [SEND_SELECTOR.capability, SEND_SELECTOR.service, SEND_SELECTOR.operation];
const INFERENCE_HOST = [INFERENCE_SELECTOR.capability, INFERENCE_SELECTOR.service, INFERENCE_SELECTOR.operation];

async function shareViaSheet(memo) {
  await tauriInvoke('soudan_share', {text: memo});
}

function saveViaBrowser({name, type, bytes}) {
  const safeName = clientSaveFileName(name, type, ['md']);
  if (!safeName) throw Error('invalid-save-name');
  browserClientSaveTarget({name: safeName, type, bytes});
}

const locale = pickLocale(navigator.languages);
const t = translator(locale);
const descriptor = runtimeDescriptor(locale);
if (clientRuntimeProblems(descriptor, REQUESTED_CAPABILITIES, location.origin).length) {
  throw Error('invalid-runtime');
}

const sendAdapter = tauriInvoke
  ? createShareHandler({shareText: shareViaSheet})
  : createWebParityHandler({
    webShare: typeof navigator.share === 'function' ? data => navigator.share(data) : null,
    saveFile: saveViaBrowser,
    copyText: navigator.clipboard?.writeText ? text => navigator.clipboard.writeText(text) : null,
  });

const hostSupportedOperations = [SEND_HOST, ...(DEFAULT_INFERENCE_CONFIG.enabled ? [INFERENCE_HOST] : [])];

const broker = createClientOperationBroker({
  runtime: descriptor,
  requestedCapabilities: [...REQUESTED_CAPABILITIES],
  approvedOperations: descriptor.operations,
  hostSupportedOperations,
  browserAdapters: {[SEND_SELECTOR.service]: {[SEND_SELECTOR.operation]: sendAdapter}},
  consentHost: createClientConsentHost({locale}),
  app: {name: t('app.title')},
});

document.documentElement.lang = locale;
// P1 #1: opaque-origin safe host creation (never throws if localStorage is inaccessible).
const host = createStandaloneSafeHost({createHostFn: createHost, appId: 'network.itonami.soudan', win: window});
const $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
const PARAMS = {'summary.tooLong': {max: LIMITS.summary}, 'timeline.event': {max: LIMITS.event}};
const problemText = key => t(key, PARAMS[key] ?? {});

let revision = 0;
let pendingDeletePreview = null;
let lastDryRunText = '';
// Working form buffer (P2 #5): edits accumulate here and commit exclusively through soudan.draft.update.
let formDraftId = null;
let formDraft = null;

function syncFormDraft() {
  const rec = store.getActiveDraft();
  formDraftId = rec.id;
  formDraft = restoreDraft(rec.draft);
}

function workingDraft() {
  const rec = store.getActiveDraft();
  if (!formDraft || formDraftId !== rec.id) syncFormDraft();
  return formDraft;
}

const store = createSemanticStore({
  locale,
  broker,
  inferenceConfig: DEFAULT_INFERENCE_CONFIG,
  route: execRoute,
  onPersist: async nextState => {
    try {
      const saved = await host.write({expectedRevision: revision, data: nextState});
      revision = saved.revision;
      return {ok: true};
    } catch (e) {
      if (e?.code === 'state-conflict') {
        try {
          const latest = await host.read();
          revision = latest.revision;
          return {ok: false, conflict: true, code: 'state-conflict', reloadedState: latest.data};
        } catch {
          return {ok: false, conflict: true, code: 'state-conflict'};
        }
      }
      return {ok: false, conflict: false, code: e?.code ?? 'storage-unavailable'};
    }
  },
});

const STATE_SYMBOLS = Object.freeze({
  idle: '○',
  'proposal.ready': '◇',
  'governor.blocked': '■',
  'consent.required': '▲',
  'audit.recorded': '✓',
});

function updateStateBadge() {
  const s = store.getUiState();
  const main = document.querySelector('main');
  if (main) main.dataset.semanticState = s;
  const badge = $('semantic-state');
  if (badge) {
    badge.textContent = `${STATE_SYMBOLS[s] ?? '○'} ${t('state.label')}: ${t('state.' + s)}`;
    badge.dataset.state = s;
  }
}

async function load() {
  try {
    const s = await host.read();
    revision = s.revision;
    store.setState(s.data);
    syncFormDraft();
  } catch (e) {
    say(t('saveFailed', {code: e?.code ?? 'unknown'}));
  }
}

// P2 #5 + P1 #3: All normal saves route through soudan.draft.update (recording human audit)
// and propagate conflict / storage errors cleanly without ever showing false success.
async function save() {
  const rec = store.getActiveDraft();
  const patch = workingDraft();
  const res = await store.execute('soudan.draft.update', {id: rec.id, patch}, {actor: {kind: 'human'}});
  syncFormDraft();
  say(statusMessageForMutation(res, 'saved', t));
  updateStateBadge();
  if (res.conflict) route();
  return res.ok;
}

function field(label, id, control, hint) {
  const wrap = el('div', null, 'field'), l = el('label', label); l.htmlFor = id; control.id = id;
  wrap.append(l);
  if (hint) {
    const h = el('p', hint, 'muted hint'); h.id = id + '-hint';
    control.setAttribute('aria-describedby', h.id); wrap.append(h);
  }
  wrap.append(control); return wrap;
}
function input(value, onInput, {type = 'text', max, autocomplete = 'off'} = {}) {
  const i = el('input'); i.type = type; i.value = value; i.autocomplete = autocomplete; if (max) i.maxLength = max;
  i.addEventListener('input', () => onInput(i.value)); return i;
}
function area(value, onInput, max) {
  const a = el('textarea'); a.value = value; a.rows = 5; a.maxLength = max;
  a.addEventListener('input', () => onInput(a.value)); return a;
}
function select(value, options, onChange) {
  const s = el('select'), none = el('option', t('field.choose')); none.value = ''; none.selected = !value; s.append(none);
  for (const [v, label] of options) { const o = el('option', label); o.value = v; o.selected = v === value; s.append(o); }
  s.addEventListener('change', () => onChange(s.value || null)); return s;
}
function problemList(keys) {
  const box = el('div', null, 'problems'); box.setAttribute('role', 'alert'); box.tabIndex = -1;
  box.append(el('p', t('problems')));
  const ul = el('ul'); for (const k of keys) ul.append(el('li', problemText(k))); box.append(ul); return box;
}

// ---- multi-draft switcher ----
function draftBar() {
  const state = store.getState();
  const sec = el('section', null, 'card draft-bar');
  sec.setAttribute('aria-labelledby', 'drafts-h');
  const head = el('div', null, 'card-head');
  const h = el('h2', t('drafts.heading')); h.id = 'drafts-h';
  head.append(h, el('span', t('drafts.count', {count: String(state.drafts.length)}), 'chip'));
  sec.append(head);

  const list = el('div', null, 'chips');
  state.drafts.forEach((rec, idx) => {
    const active = rec.id === state.activeDraftId;
    const label = (active ? `● [${t('drafts.active')}] ` : '○ ') + draftDisplayTitle(rec, idx, t);
    const btn = el('button', label, active ? 'draft-tab current' : 'tonal draft-tab');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(active));
    btn.addEventListener('click', async () => {
      pendingDeletePreview = null;
      const res = await store.execute('soudan.draft.select', {id: rec.id}, {actor: {kind: 'human'}});
      syncFormDraft();
      if (!res.ok) say(statusMessageForMutation(res, 'saved', t));
      updateStateBadge();
      renderInput();
    });
    list.append(btn);
  });
  sec.append(list);

  const barActions = el('div', null, 'actions compact');
  const createBtn = el('button', t('drafts.create'), 'tonal'); createBtn.type = 'button';
  createBtn.addEventListener('click', async () => {
    pendingDeletePreview = null;
    const res = await store.execute('soudan.draft.create', {}, {actor: {kind: 'human'}});
    syncFormDraft();
    say(statusMessageForMutation(res, 'drafts.created', t));
    updateStateBadge();
    renderInput();
  });
  const delBtn = el('button', t('drafts.delete'), 'link danger'); delBtn.type = 'button';
  delBtn.addEventListener('click', async () => {
    const res = await store.execute('soudan.draft.delete', {id: state.activeDraftId, dryRun: true}, {actor: {kind: 'human'}});
    pendingDeletePreview = res.preview ?? null;
    updateStateBadge();
    renderInput();
  });
  barActions.append(createBtn, delBtn);
  sec.append(barActions);

  if (pendingDeletePreview) {
    const box = el('div', null, 'confirm-box');
    box.setAttribute('role', 'alert');
    box.append(el('p', t('drafts.deletePreview', {
      title: pendingDeletePreview.draftTitle,
      evidence: String(pendingDeletePreview.evidenceCount),
    })));
    const row = el('div', null, 'equal-choices');
    const cancel = el('button', t('drafts.deleteCancel'), 'equal-choice'); cancel.type = 'button';
    cancel.addEventListener('click', () => { pendingDeletePreview = null; store.setUiState('idle'); updateStateBadge(); renderInput(); });
    const confirm = el('button', t('drafts.deleteConfirm'), 'equal-choice danger'); confirm.type = 'button';
    confirm.addEventListener('click', async () => {
      const targetId = pendingDeletePreview.targetId;
      pendingDeletePreview = null;
      const res = await store.execute('soudan.draft.delete', {id: targetId, confirmed: true}, {actor: {kind: 'human'}});
      syncFormDraft();
      say(statusMessageForMutation(res, 'drafts.deleted', t));
      updateStateBadge();
      renderInput();
    });
    row.append(cancel, confirm);
    box.append(row);
    sec.append(box);
  }
  return sec;
}

// ---- inference slot (murakumo.cloud Route B, default OFF / fail-closed) ----
function inferenceBlock() {
  const rec = store.getActiveDraft();
  const draft = workingDraft();
  const sec = el('section', null, 'card inference-card');
  sec.setAttribute('aria-labelledby', 'inf-h');
  const h = el('h3', t('inference.heading')); h.id = 'inf-h';
  sec.append(
    h,
    el('p', `${t('inference.modeLabel')}: ${t('inference.modeOff')}`, 'chip'),
    el('p', t('inference.statusDisabled'), 'muted'),
    el('p', t('inference.disclaimer'), 'notice-banner'),
    el('p', t('inference.anonymizeWarning'), 'warn-banner'),
    el('p', t('inference.routeBDisclosure'), 'muted hint'),
  );

  const det = el('details');
  det.append(el('summary', t('inference.detailsSummary')));
  const pre = el('pre', JSON.stringify({
    endpoint: DEFAULT_INFERENCE_CONFIG.endpoint,
    enabled: DEFAULT_INFERENCE_CONFIG.enabled,
    dataCategories: ['consultation-draft-text'],
    imageBytesIncluded: false,
    summaryChars: draft.summary.length,
    timelineItems: draft.timeline.length,
    evidenceCount: draft.evidence.length,
  }, null, 2), 'mono');
  det.append(pre);
  sec.append(det);

  // Equal visual weight for decline vs consent (zero pre-checked checkboxes).
  const choices = el('div', null, 'equal-choices');
  const declineBtn = el('button', t('inference.decline'), 'equal-choice'); declineBtn.type = 'button';
  declineBtn.addEventListener('click', async () => {
    const res = await store.execute('soudan.inference.organize', {localOnly: true, prompt: draft.summary}, {actor: {kind: 'human'}});
    updateStateBadge();
    if (res.ok) say(t('inference.localFallback'));
    renderInput();
  });
  const acceptBtn = el('button', t('inference.accept'), 'equal-choice'); acceptBtn.type = 'button';
  acceptBtn.addEventListener('click', async () => {
    const res = await store.execute('soudan.inference.organize', {localOnly: false, prompt: draft.summary}, {actor: {kind: 'human'}});
    updateStateBadge();
    if (res.ok && res.fallback === 'local') say(t('inference.localFallback'));
    renderInput();
  });
  choices.append(declineBtn, acceptBtn);
  sec.append(choices);

  const guard = store.getLastGuard();
  if (store.getUiState() === 'governor.blocked' && guard?.blocked) {
    const box = el('div', null, 'problems');
    box.setAttribute('role', 'alert');
    box.append(el('p', t('inference.blockedTitle', {gate: guard.gateName})), el('p', t('inference.blockedBody')));
    const ul = el('ul');
    for (const k of OFFICIAL_ROUTE_KEYS) ul.append(el('li', t(k)));
    box.append(ul);
    sec.append(box);
  }

  // P1 #4: only render proposal bound to the currently active draftId.
  const proposal = store.getLastProposal(rec.id);
  if (proposal) {
    const pbox = el('div', null, 'proposal-box');
    pbox.append(
      el('h4', t('inference.proposalHeading')),
      el('p', proposal.disclaimer, 'notice-banner'),
      el('pre', proposal.suggestedSummary, 'mono'),
    );
    const pActions = el('div', null, 'equal-choices');
    const discard = el('button', t('inference.discardProposal'), 'equal-choice'); discard.type = 'button';
    discard.addEventListener('click', () => {
      store.clearProposal();
      say(t('inference.discarded'));
      updateStateBadge();
      renderInput();
    });
    const apply = el('button', t('inference.applyProposal'), 'equal-choice'); apply.type = 'button';
    apply.addEventListener('click', async () => {
      const res = await store.execute('soudan.draft.update', {
        id: proposal.targetDraftId,
        proposalDraftId: proposal.targetDraftId,
        patch: {...workingDraft(), summary: proposal.suggestedSummary},
      }, {actor: {kind: 'human'}});
      syncFormDraft();
      say(statusMessageForMutation(res, 'inference.applied', t));
      updateStateBadge();
      renderInput();
    });
    pActions.append(discard, apply);
    pbox.append(pActions);
    sec.append(pbox);
  }
  return sec;
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

function evidenceEditor(draft) {
  const fs = el('fieldset'); fs.append(el('legend', t('field.evidence')));
  fs.append(el('p', t('evidence.hint'), 'muted hint'));
  draft.evidence.forEach((e, i) => {
    const box = el('fieldset'); box.append(el('legend', String(i + 1)));
    box.append(
      field(t('evidence.url'), 'ev-url-' + i, input(e.url, v => { e.url = v; }, {type: 'url', max: LIMITS.evidenceUrl})),
      field(t('evidence.postedAt'), 'ev-posted-' + i, input(e.postedAt, v => { e.postedAt = v; }, {type: 'datetime-local'}), t('evidence.postedAtHint')),
      field(t('evidence.authorName'), 'ev-name-' + i, input(e.authorName, v => { e.authorName = v; }, {max: LIMITS.evidenceField})),
      field(t('evidence.authorId'), 'ev-id-' + i, input(e.authorId, v => { e.authorId = v; }, {max: LIMITS.evidenceField})),
    );
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
    rm.addEventListener('click', async () => {
      const res = await store.execute('soudan.evidence.remove', {index: i}, {actor: {kind: 'human'}});
      syncFormDraft();
      if (!res.ok) say(statusMessageForMutation(res, 'saved', t));
      updateStateBadge();
      renderInput();
    });
    box.append(rm); fs.append(box);
  });
  if (draft.evidence.length < LIMITS.evidence) {
    const add = el('button', t('evidence.add'), 'tonal'); add.type = 'button';
    add.addEventListener('click', async () => {
      const res = await store.execute('soudan.evidence.add', {row: newEvidence()}, {actor: {kind: 'human'}});
      syncFormDraft();
      if (!res.ok) say(statusMessageForMutation(res, 'saved', t));
      updateStateBadge();
      renderInput();
    });
    fs.append(add);
  }
  return fs;
}

function guideBlock() {
  const s = el('section', null, 'card'); s.setAttribute('aria-labelledby', 'guide-h');
  const h = el('h3', t('guide.title')); h.id = 'guide-h'; s.append(h);
  s.append(el('p', t('guide.noJudgment'), 'muted'));
  s.append(el('p', t('guide.deadline')));
  s.append(el('p', t('guide.source'), 'muted'));
  const ul = el('ul', null, 'route-list');
  for (let i = 1; i <= 6; i++) ul.append(el('li', t('guide.route.' + i)));
  s.append(ul);
  s.append(el('p', t('guide.forms')));
  s.append(el('p', t('guide.storage'), 'muted'));
  return s;
}

function renderInput(problems = []) {
  const draft = workingDraft();
  const view = $('view'); view.replaceChildren();
  view.append(el('p', t('intro'), 'muted'), draftBar());
  if (problems.length) view.append(problemList(problems));

  // No native submit event / requestSubmit(): sandbox="allow-scripts" safe bindForm + type="button" data-submit.
  const form = el('div', null, 'form-shell');
  form.setAttribute('role', 'form');
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
    evidenceEditor(draft),
    inferenceBlock(),
    guideBlock(),
    field(t('field.name'), 'name', input(draft.name, v => { draft.name = v; }, {max: LIMITS.name, autocomplete: 'name'})),
    field(t('field.contact'), 'contact', input(draft.contact, v => { draft.contact = v; }, {max: LIMITS.contact, autocomplete: 'email'})),
  );
  const actions = el('div', null, 'actions');
  const saveButton = el('button', t('save'), 'tonal'); saveButton.type = 'button';
  saveButton.addEventListener('click', () => save());
  const assemble = el('button', t('assemble')); assemble.type = 'button'; assemble.dataset.submit = 'true';
  actions.append(saveButton, assemble);
  form.append(actions);

  bindForm(form, async () => {
    const p = draftProblems(draft);
    if (p.length) { renderInput(p); $('view').querySelector('.problems')?.focus?.(); say(t('problems')); return; }
    if (!await save()) return;
    const res = await store.execute('soudan.memo.assemble', {}, {actor: {kind: 'human'}});
    updateStateBadge();
    if (res.ok) location.hash = '#/memo';
    else say(statusMessageForMutation(res, 'saved', t));
  });
  view.append(form);
  updateStateBadge();
}

function routeLabel() {
  if (execRoute === 'android-share-sheet') return t('route.android');
  if (execRoute === 'web-share') return t('route.webShare');
  return t('route.webSave');
}

// ---- memo, recipient, 3-surface X1 send/export ----
function renderMemo() {
  const draft = workingDraft();
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('memo.heading')); h.tabIndex = -1; view.append(h);
  if (draftProblems(draft).length) { view.append(el('p', t('memo.incomplete'))); h.focus(); return; }
  const memo = assembleMemo(draft, t);
  const doc = el('article', null, 'memo'); doc.setAttribute('aria-labelledby', 'memo-title');
  const title = el('h3', memo.title); title.id = 'memo-title'; doc.append(title);
  for (const s of memo.sections) doc.append(el('h4', s.heading), el('p', s.body, 'body'));
  doc.append(el('p', memo.notice, 'notice-banner'));
  view.append(el('p', t('memo.check'), 'muted'), doc);

  const r = el('section', null, 'card'); r.setAttribute('aria-labelledby', 'recipient-h');
  const rh = el('h3', t('recipient.heading')); rh.id = 'recipient-h';

  const pasteDet = el('details', null, 'paste-helper');
  pasteDet.append(el('summary', t('paste.heading')), el('p', t('paste.hint'), 'muted hint'));
  let pasteRaw = '';
  const pasteBox = area('', v => { pasteRaw = v; }, 8192);
  pasteBox.rows = 4;
  pasteDet.append(field(t('paste.label'), 'paste-raw', pasteBox));
  const pasteApply = el('button', t('paste.apply'), 'tonal'); pasteApply.type = 'button';
  pasteApply.addEventListener('click', () => {
    const parsed = parseLawyerCardPaste(pasteRaw);
    if (!parsed) { say(t('paste.failed')); return; }
    if (parsed.name) draft.recipient.name = parsed.name;
    if (parsed.office) draft.recipient.office = parsed.office;
    if (parsed.contact) draft.recipient.contact = parsed.contact;
    say(t('paste.applied'));
    renderMemo();
  });
  pasteDet.append(pasteApply);

  const nameIn = input(draft.recipient.name, v => { draft.recipient.name = v; refresh(); }, {max: LIMITS.name});
  const officeIn = input(draft.recipient.office, v => { draft.recipient.office = v; refresh(); }, {max: LIMITS.office});
  const contactIn = input(draft.recipient.contact, v => { draft.recipient.contact = v; refresh(); }, {max: LIMITS.contact});

  r.append(
    rh,
    el('p', t('recipient.note'), 'muted'),
    pasteDet,
    field(t('recipient.name'), 'r-name', nameIn),
    field(t('recipient.office'), 'r-office', officeIn),
    field(t('recipient.contact'), 'r-contact', contactIn),
  );

  const badgeRow = el('div', null, 'chips');
  badgeRow.append(el('span', `▸ ${t('route.label')}: ${routeLabel()}`, 'chip current'));
  r.append(badgeRow, el('p', t('o8.notice'), 'notice-banner'));

  const confirmBox = el('input'); confirmBox.type = 'checkbox'; confirmBox.id = 'confirm';
  const confirmLabel = el('label', t('confirm.label'), 'check'); confirmLabel.prepend(confirmBox);

  const actionButtons = [];
  const makeSendBtn = (label, mode, cls = '') => {
    const btn = el('button', label, cls); btn.type = 'button';
    btn.addEventListener('click', async e => {
      if (!e.isTrusted) return;
      if (recipientProblems(draft.recipient).length || broker.operations.length === 0) { say(t('send.blocked')); return; }
      // A new send starts here: clear the previous result line before consent/chooser.
      say('');
      if (!await save()) return;
      const res = await store.execute('soudan.memo.send', {mode}, {actor: {kind: 'human'}});
      updateStateBadge();
      if (res.ok) {
        if (res.result?.saved) say(t('send.savedFile', {name: res.result.name}));
        else if (res.result?.copied) say(t('send.copied'));
        else say(t('send.shared'));
      } else {
        say(t('send.blocked'));
      }
    });
    actionButtons.push(btn);
    return btn;
  };

  const dryRunBtn = el('button', t('send.dryRun'), 'tonal'); dryRunBtn.type = 'button';
  dryRunBtn.addEventListener('click', async () => {
    if (recipientProblems(draft.recipient).length) { say(t('send.blocked')); return; }
    if (!await save()) return;
    const mode = execRoute === 'android-share-sheet' ? 'android-share' : 'save-txt';
    const res = await store.execute('soudan.memo.send', {mode, dryRun: true}, {actor: {kind: 'human'}});
    updateStateBadge();
    if (res.ok && res.preview) {
      lastDryRunText = t('send.dryRunSummary', {route: routeLabel(), chars: String(res.preview.charCount)});
      say(lastDryRunText);
    }
  });

  const actions = el('div', null, 'actions');
  const saveButton = el('button', t('save'), 'tonal'); saveButton.type = 'button'; saveButton.addEventListener('click', () => save());
  actions.append(saveButton, dryRunBtn);

  if (execRoute === 'android-share-sheet') {
    actions.append(makeSendBtn(t('send'), 'android-share'));
  } else {
    if (execRoute === 'web-share') actions.append(makeSendBtn(t('send.webShare'), 'web-share'));
    actions.append(
      makeSendBtn(t('send.saveTxt'), 'save-txt'),
      makeSendBtn(t('send.saveMd'), 'save-md', 'tonal'),
      makeSendBtn(t('send.saveJson'), 'save-json', 'tonal'),
      makeSendBtn(t('send.copy'), 'clipboard', 'tonal'),
    );
  }

  function refresh() {
    const disabled = !confirmBox.checked || recipientProblems(draft.recipient).length > 0 || broker.operations.length === 0;
    for (const b of actionButtons) b.disabled = disabled;
    dryRunBtn.disabled = recipientProblems(draft.recipient).length > 0;
  }
  confirmBox.addEventListener('change', refresh);
  r.append(confirmLabel, actions, el('p', t('send.note'), 'muted'));
  view.append(r);
  refresh(); h.focus();
  updateStateBadge();
}

// ---- local audit log (O8 minimized) ----
function renderAudit() {
  const view = $('view'); view.replaceChildren();
  const h = el('h2', t('audit.heading')); h.tabIndex = -1; view.append(h);
  view.append(el('p', t('audit.note'), 'muted'));
  const entries = store.getState().audit;
  if (!entries.length) {
    view.append(el('p', t('audit.empty'), 'muted'));
  } else {
    const ul = el('ul', null, 'results');
    for (const item of [...entries].reverse()) {
      const li = el('li');
      const actorText = t('audit.actor.' + item.actor.kind);
      const gate = item.gateName ? ` · gate:${item.gateName}` : '';
      li.append(
        el('p', `${item.op} [${item.outcome}]${gate}`, 'mono'),
        el('p', `${item.timestamp} · ${actorText} · ${item.targetKind}`, 'muted hint'),
      );
      ul.append(li);
    }
    view.append(ul);
  }
  h.focus();
  updateStateBadge();
}

function route() {
  const hash = location.hash || '#/';
  const mode = hash.startsWith('#/memo') ? 'memo' : hash.startsWith('#/audit') ? 'audit' : 'input';
  for (const a of document.querySelectorAll('nav a')) {
    const target = a.hash.startsWith('#/memo') ? 'memo' : a.hash.startsWith('#/audit') ? 'audit' : 'input';
    if (target === mode) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  say('');
  if (mode === 'memo') renderMemo();
  else if (mode === 'audit') renderAudit();
  else renderInput();
}

function chrome() {
  document.title = t('app.title');
  $('title').textContent = t('app.title');
  $('subtitle').textContent = t('app.subtitle');
  $('nav').setAttribute('aria-label', t('nav.label'));
  $('nav-input').textContent = t('nav.input');
  $('nav-memo').textContent = t('nav.memo');
  $('nav-audit').textContent = t('nav.audit');
  $('footer-copy').textContent = t('footer');
  $('footer-foreign').textContent = t('footer.foreignLink');
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
