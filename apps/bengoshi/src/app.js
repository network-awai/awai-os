// Bengoshi SPA (network.itonami.bengoshi) — 11 views matching Gamen designs/bengoshi/ plan:
// User (5): search, profile.detail, contact.compose, contact.consent, requests
// Lawyer (4): lawyer.onboarding, lawyer.profile.edit, lawyer.inbox, lawyer.inquiry.detail
// Shared / Embedded (2): audit, embed.mcp

import { createHost } from './host.js';
import { clientRuntimeProblems, createClientConsentHost, createClientOperationBroker } from './runtime.js';
import {
  PREFECTURES,
  PREFECTURE_MAP,
  PRACTICE_AREAS,
  INQUIRY_CATEGORIES,
  NEUTRAL_SORTS,
  VERIFICATION_STATUSES,
  emptyInquiryDraft,
  validateInquiryDraft,
  validateLawyerRecord,
  validateOnboardingSubmission,
  evaluateVerificationStatus,
  canSendToLawyer,
  exportLawyerCard,
  canRevealInquiryBody,
} from './model.js';
import { generateLawyerKeyPair } from './crypto.js';
import { getLegalNotices, requiredConsentDisclosures, NICHIBENREN_SEARCH_URL } from './legal-notices.js';
import { pickLocale, translator } from './messages.js';
import {
  runtimeDescriptor,
  REQUESTED_CAPABILITIES,
  INFERENCE_SELECTOR,
  INQUIRY_SEND_SELECTOR,
  INQUIRY_REPLY_SELECTOR,
} from './runtime-descriptor.js';
import { createInitialLocalState, createOperationsEngine } from './operations.js';
import { SYNTHETIC_CATALOG_BUNDLE, verifySyntheticCatalogIntegrity, buildSyntheticQaIntakeRecords } from './fixtures.js';
import { createMcpEmbedBridge } from './mcp-embed.js';

const $ = id => document.getElementById(id);
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};

let locale = pickLocale(navigator.languages);
let t = translator(locale);
const host = createHost({ appId: 'network.itonami.bengoshi' });
let revision = 0;
let state = createInitialLocalState();
state.settings.locale = locale;

// Ephemeral device-only QA private key (kept in memory only; never persisted in plaintext outside session)
let sessionLawyerKeyPair = null;
let revealedBodies = new Map();
let activeMode = 'user'; // user | lawyer | shared
let selectedLawyerId = SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id;
let selectedInquiryId = '';
let searchFilter = {
  query: '',
  prefectureCode: '',
  practiceArea: '',
  language: '',
  legalAidHouterasu: null,
  verificationStatus: '',
  sort: 'kana_asc',
};

let consentHost = null;
let broker = null;
let engine = null;

function say(msg) {
  $('status').textContent = msg || '';
}

function buildBroker() {
  if (consentHost) consentHost.destroy();
  const descriptor = runtimeDescriptor(locale, { murakumoPath: state.settings.murakumoPath });
  const problems = clientRuntimeProblems(descriptor, [...REQUESTED_CAPABILITIES], location.origin);
  if (problems.length) throw new Error('invalid-runtime-descriptor: ' + JSON.stringify(problems));

  consentHost = createClientConsentHost({ locale });
  const hostSupported = [
    [INFERENCE_SELECTOR.capability, INFERENCE_SELECTOR.service, INFERENCE_SELECTOR.operation],
    [INQUIRY_SEND_SELECTOR.capability, INQUIRY_SEND_SELECTOR.service, INQUIRY_SEND_SELECTOR.operation],
    [INQUIRY_REPLY_SELECTOR.capability, INQUIRY_REPLY_SELECTOR.service, INQUIRY_REPLY_SELECTOR.operation],
  ];

  // Staged / fail-closed E2EE dispatch adapters (local dry-run envelope verification; never leaks plaintext)
  const dispatchAdapter = async ({ payload }) => ({
    accepted: true,
    relayStatus: payload?.relayStatus || 'staged_dry_run_only',
    dryRun: payload?.dryRun !== false,
    aadSha256: payload?.envelope?.aadSha256 || null,
    timestamp: new Date().toISOString(),
  });

  broker = createClientOperationBroker({
    runtime: descriptor,
    requestedCapabilities: [...REQUESTED_CAPABILITIES],
    approvedOperations: descriptor.operations,
    hostSupportedOperations: hostSupported,
    browserAdapters: {
      [INQUIRY_SEND_SELECTOR.service]: {
        [INQUIRY_SEND_SELECTOR.operation]: dispatchAdapter,
        [INQUIRY_REPLY_SELECTOR.operation]: dispatchAdapter,
      },
    },
    consentHost,
    app: { name: t('app.title') },
  });

  engine = createOperationsEngine({
    catalog: SYNTHETIC_CATALOG_BUNDLE.lawyers,
    state,
    broker,
    getPrivateKeyJwk: async () => sessionLawyerKeyPair?.privateKeyJwk || null,
    onStateChange: persistState,
  });
}

async function persistState() {
  try {
    const next = await host.write({ expectedRevision: revision, data: state });
    revision = next.revision;
  } catch (e) {
    // Fallback when navigator.locks is unavailable in non-secure file contexts
    if (e?.code === 'atomic-write-unavailable') {
      try {
        localStorage.setItem('awai.shell.host.v1:network.itonami.bengoshi', JSON.stringify({
          schema: 'awai.shell.host.v1',
          revision: revision + 1,
          data: state,
        }));
        revision += 1;
      } catch { /* ignore */ }
    }
  }
}

async function loadState() {
  try {
    const stored = await host.read();
    revision = stored.revision;
    if (stored.data && typeof stored.data === 'object') {
      state = {
        ...createInitialLocalState(),
        ...stored.data,
        settings: { ...createInitialLocalState().settings, ...(stored.data.settings || {}) },
      };
      if (state.settings.locale === 'ja' || state.settings.locale === 'en') {
        locale = state.settings.locale;
        t = translator(locale);
      }
    }
  } catch { /* start fresh local state */ }
}

function verificationBadge(effectiveStatus) {
  const cls =
    effectiveStatus === 'verified_manual_a2' ? 'badge ok' :
    effectiveStatus === 'unverified_self_declared' ? 'badge warn' :
    'badge danger';
  return el('span', t('status.' + effectiveStatus), cls);
}

function fieldWrap(labelText, id, control) {
  const wrap = el('div');
  const lab = el('label', labelText);
  lab.htmlFor = id;
  control.id = id;
  wrap.append(lab, control);
  return wrap;
}

function nichibenrenLink() {
  const a = el('a', t('profile.nichibenrenLink'), 'ext-link');
  a.href = NICHIBENREN_SEARCH_URL;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function renderSettingsPanel() {
  const panel = $('settings-panel');
  panel.replaceChildren();
  panel.append(el('summary', t('settings.summary')));
  const body = el('div', null, 'grid');

  const scopeSel = el('select');
  for (const s of ['tenant_only', 'neutral_cross_firm']) {
    const o = el('option', t('settings.scope.' + s));
    o.value = s;
    o.selected = state.settings.directoryScope === s;
    scopeSel.append(o);
  }
  scopeSel.addEventListener('change', async () => {
    state.settings.directoryScope = scopeSel.value;
    await persistState();
    route();
  });

  const demoCheck = el('input');
  demoCheck.type = 'checkbox';
  demoCheck.checked = Boolean(state.settings.syntheticDemoMode);
  demoCheck.addEventListener('change', async () => {
    state.settings.syntheticDemoMode = demoCheck.checked;
    await persistState();
    route();
  });
  const demoLabel = el('label', t('settings.demoMode'), 'check');
  demoLabel.prepend(demoCheck);

  const pathInput = el('input');
  pathInput.type = 'text';
  pathInput.value = state.settings.murakumoPath;
  pathInput.addEventListener('change', async () => {
    const val = pathInput.value.trim();
    if (val.startsWith('/') && !val.includes('..') && !val.includes('?')) {
      state.settings.murakumoPath = val;
      buildBroker();
      await persistState();
    }
  });

  body.append(
    fieldWrap(t('settings.scope'), 'set-scope', scopeSel),
    demoLabel,
    fieldWrap(t('settings.murakumoPath'), 'set-murakumo-path', pathInput),
    el('p', t('settings.relayStatus'), 'muted mono'),
  );
  panel.append(body);
}

function renderChrome() {
  document.documentElement.lang = locale;
  document.title = t('app.title');
  $('title').textContent = t('app.title');
  $('subtitle').textContent = t('app.subtitle');
  $('badge-zero-fee').textContent = t('badge.zeroFee');
  $('lang-toggle').textContent = t('lang.toggle');
  $('environment').textContent = t('env.line', {
    runtime: t(host.info().runtime === 'web' ? 'env.web' : 'env.tauri'),
  });

  const modeBar = $('mode-bar');
  modeBar.replaceChildren();
  for (const [m, key, defaultHash] of [
    ['user', 'mode.user', '#/search'],
    ['lawyer', 'mode.lawyer', '#/lawyer/inbox'],
    ['shared', 'mode.shared', '#/audit'],
  ]) {
    const b = el('button', t(key));
    b.type = 'button';
    b.setAttribute('aria-pressed', activeMode === m ? 'true' : 'false');
    b.addEventListener('click', () => {
      activeMode = m;
      location.hash = defaultHash;
    });
    modeBar.append(b);
  }

  const nav = $('nav');
  nav.setAttribute('aria-label', t('nav.label'));
  nav.replaceChildren();
  const links =
    activeMode === 'user'
      ? [
          ['#/search', t('nav.search')],
          ['#/profile/' + selectedLawyerId, t('nav.profile')],
          ['#/contact/compose', t('nav.compose')],
          ['#/contact/consent', t('nav.consent')],
          ['#/requests', t('nav.requests')],
        ]
      : activeMode === 'lawyer'
        ? [
            ['#/lawyer/onboarding', t('nav.onboarding')],
            ['#/lawyer/profile', t('nav.profileEdit')],
            ['#/lawyer/inbox', t('nav.inbox')],
            ['#/lawyer/inquiry/' + (selectedInquiryId || 'inq-qa-clear-001'), t('nav.inquiryDetail')],
          ]
        : [
            ['#/audit', t('nav.audit')],
            ['#/embed/mcp', t('nav.embedMcp')],
          ];

  const currentHash = location.hash || '#/search';
  for (const [href, label] of links) {
    const a = el('a', label);
    a.href = href;
    const base = href.split('/').slice(0, 2).join('/');
    if (currentHash === href || (href.includes('/profile/') && currentHash.startsWith('#/profile/')) || (href.includes('/lawyer/inquiry/') && currentHash.startsWith('#/lawyer/inquiry/'))) {
      a.setAttribute('aria-current', 'page');
    } else if (base === '#/contact' && currentHash === href) {
      a.setAttribute('aria-current', 'page');
    }
    nav.append(a);
  }

  renderSettingsPanel();

  const footer = $('footer');
  footer.replaceChildren();
  const ul = el('ul');
  for (const line of requiredConsentDisclosures(locale)) ul.append(el('li', line));
  ul.append(el('li', getLegalNotices(locale).publicReleaseGate));
  footer.append(ul, nichibenrenLink());
}

// ---- View 1: search ----
async function renderSearch() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('search.heading')), el('p', t('search.note'), 'muted'));

  const filterCard = el('section', null, 'card grid-2');

  const qIn = el('input');
  qIn.type = 'search';
  qIn.value = searchFilter.query;
  qIn.addEventListener('input', () => { searchFilter.query = qIn.value; renderResults(); });

  const prefSel = el('select');
  prefSel.append(Object.assign(el('option', t('search.all')), { value: '' }));
  for (const [code, name] of PREFECTURES) {
    const o = el('option', `${code} ${name}`);
    o.value = code;
    o.selected = searchFilter.prefectureCode === code;
    prefSel.append(o);
  }
  prefSel.addEventListener('change', () => { searchFilter.prefectureCode = prefSel.value; renderResults(); });

  const areaSel = el('select');
  areaSel.append(Object.assign(el('option', t('search.all')), { value: '' }));
  for (const area of PRACTICE_AREAS) {
    const o = el('option', area);
    o.value = area;
    o.selected = searchFilter.practiceArea === area;
    areaSel.append(o);
  }
  areaSel.addEventListener('change', () => { searchFilter.practiceArea = areaSel.value; renderResults(); });

  const langSel = el('select');
  for (const [v, lab] of [['', t('search.all')], ['日本語', '日本語'], ['English', 'English'], ['中文', '中文']]) {
    const o = el('option', lab);
    o.value = v;
    o.selected = searchFilter.language === v;
    langSel.append(o);
  }
  langSel.addEventListener('change', () => { searchFilter.language = langSel.value; renderResults(); });

  const aidSel = el('select');
  for (const [v, lab] of [['', t('search.all')], ['true', t('search.yes')], ['false', t('search.no')]]) {
    const o = el('option', lab);
    o.value = v;
    o.selected = String(searchFilter.legalAidHouterasu ?? '') === v;
    aidSel.append(o);
  }
  aidSel.addEventListener('change', () => {
    searchFilter.legalAidHouterasu = aidSel.value === '' ? null : aidSel.value === 'true';
    renderResults();
  });

  const verSel = el('select');
  verSel.append(Object.assign(el('option', t('search.all')), { value: '' }));
  for (const st of VERIFICATION_STATUSES) {
    const o = el('option', t('status.' + st));
    o.value = st;
    o.selected = searchFilter.verificationStatus === st;
    verSel.append(o);
  }
  verSel.addEventListener('change', () => { searchFilter.verificationStatus = verSel.value; renderResults(); });

  const sortSel = el('select');
  for (const s of NEUTRAL_SORTS) {
    const o = el('option', t('sort.' + s));
    o.value = s;
    o.selected = searchFilter.sort === s;
    sortSel.append(o);
  }
  sortSel.addEventListener('change', () => { searchFilter.sort = sortSel.value; renderResults(); });

  filterCard.append(
    fieldWrap(t('search.query'), 'f-query', qIn),
    fieldWrap(t('search.prefecture'), 'f-pref', prefSel),
    fieldWrap(t('search.practiceArea'), 'f-area', areaSel),
    fieldWrap(t('search.language'), 'f-lang', langSel),
    fieldWrap(t('search.legalAid'), 'f-aid', aidSel),
    fieldWrap(t('search.verification'), 'f-ver', verSel),
    fieldWrap(t('sort.label'), 'f-sort', sortSel),
  );
  view.append(filterCard);

  const countEl = el('p', '', 'muted');
  const resultsWrap = el('div', null, 'grid');
  view.append(countEl, resultsWrap);

  async function renderResults() {
    const res = await engine.execute('directory.search', searchFilter, { actor: 'ui' });
    countEl.textContent = t('search.count', { count: res.total });
    resultsWrap.replaceChildren();
    if (!res.lawyers.length) {
      resultsWrap.append(el('p', t('search.empty'), 'card'));
      return;
    }
    for (const lawyer of res.lawyers) {
      const card = el('article', null, 'card');
      const head = el('div', null, 'chips');
      head.append(verificationBadge(lawyer.evaluatedVerification.effectiveStatus));
      if (lawyer.synthetic) head.append(el('span', t('badge.synthetic'), 'badge'));
      card.append(head);
      card.append(el('h3', `${lawyer.name}（${lawyer.bar_association}）`));
      card.append(el('p', `${lawyer.office_name || ''} ／ ${PREFECTURE_MAP[lawyer.prefecture_code] || ''} ／ 登録番号 ${lawyer.registration_number || '-'}`, 'muted'));
      const chips = el('div', null, 'chips');
      for (const area of lawyer.practice_areas || []) chips.append(el('span', area, 'chip'));
      if (lawyer.legal_aid_houterasu) chips.append(el('span', '法テラス対応', 'chip'));
      card.append(chips);

      const btn = el('button', t('search.openProfile'), 'tonal');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        selectedLawyerId = lawyer.id;
        location.hash = '#/profile/' + encodeURIComponent(lawyer.id);
      });
      card.append(el('div', null, 'actions'));
      card.lastChild.append(btn);
      resultsWrap.append(card);
    }
  }

  await renderResults();
}

// ---- View 2: profile.detail ----
async function renderProfileDetail(lawyerId) {
  const view = $('view');
  view.replaceChildren();
  let lawyer;
  try {
    const res = await engine.execute('lawyer.get', { lawyerId }, { actor: 'ui' });
    lawyer = res.lawyer;
    selectedLawyerId = lawyer.id;
  } catch {
    view.append(el('h2', t('profile.heading')), el('p', t('profile.notFound'), 'banner warn'));
    return;
  }

  const notices = getLegalNotices(locale);
  const ev = lawyer.evaluatedVerification;
  const gate = canSendToLawyer(lawyer, { syntheticDemoMode: state.settings.syntheticDemoMode });

  view.append(el('h2', `${lawyer.name}（${lawyer.name_kana || ''}）`));
  const badges = el('div', null, 'chips');
  badges.append(verificationBadge(ev.effectiveStatus));
  if (lawyer.synthetic) badges.append(el('span', t('badge.synthetic'), 'badge'));
  view.append(badges);

  if (ev.effectiveStatus === 'unverified_self_declared') view.append(el('p', notices.unverifiedWarning, 'banner warn'));
  if (ev.effectiveStatus === 'expired') view.append(el('p', notices.expiredHardHold, 'banner danger'));
  if (ev.effectiveStatus === 'suspended_or_revoked') view.append(el('p', notices.revokedHardHold, 'banner danger'));

  const card = el('section', null, 'card');
  const dl = el('dl', null, 'facts');
  const addFact = (label, val) => { dl.append(el('dt', label), el('dd', val || '—')); };
  addFact(t('profile.bar'), lawyer.bar_association);
  addFact(t('profile.regNo'), lawyer.registration_number);
  addFact(t('profile.office'), lawyer.office_name);
  addFact(t('profile.prefecture'), PREFECTURE_MAP[lawyer.prefecture_code] || lawyer.prefecture_code);
  addFact(t('profile.address'), lawyer.address);
  addFact(t('profile.phone'), lawyer.phone);
  addFact(t('profile.fax'), lawyer.fax);
  addFact(t('profile.website'), lawyer.website_url);
  addFact(t('profile.areas'), (lawyer.practice_areas || []).join(' / '));
  addFact(t('profile.career'), (lawyer.career_facts || []).join('\n'));
  addFact(t('profile.languages'), (lawyer.languages || []).join(', '));
  addFact(t('profile.houterasu'), lawyer.legal_aid_houterasu ? t('search.yes') : t('search.no'));
  addFact(t('profile.feeNote'), lawyer.initial_consultation_fee_note);
  card.append(dl);
  view.append(card);

  const vCard = el('section', null, 'card');
  vCard.append(el('h3', t('profile.verificationTitle')));
  const vdl = el('dl', null, 'facts');
  vdl.append(
    el('dt', t('profile.method')), el('dd', ev.method || '—'),
    el('dt', t('profile.verifiedAt')), el('dd', ev.verifiedAt || '—'),
    el('dt', t('profile.expiresAt')), el('dd', ev.expiresAt || '—'),
    el('dt', t('profile.attestation')), el('dd', ev.attestationDigest || '—', 'mono'),
  );
  vCard.append(vdl, nichibenrenLink());
  view.append(vCard);

  const exportBox = el('pre', '', 'code-box');
  exportBox.hidden = true;

  const actions = el('div', null, 'actions');
  const backBtn = el('button', t('profile.back'), 'secondary');
  backBtn.type = 'button';
  backBtn.addEventListener('click', () => { location.hash = '#/search'; });

  const exportBtn = el('button', t('profile.exportCard'), 'tonal');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', () => {
    const cardJson = exportLawyerCard(lawyer);
    exportBox.textContent = JSON.stringify(cardJson, null, 2);
    exportBox.hidden = false;
    say(t('profile.cardExported'));
  });

  const composeBtn = el('button', gate.allowed ? t('profile.composeCta') : t('profile.blockedCta'));
  composeBtn.type = 'button';
  composeBtn.disabled = !gate.allowed;
  composeBtn.addEventListener('click', () => {
    if (!state.draft) state.draft = emptyInquiryDraft(lawyer.id);
    else state.draft.lawyerId = lawyer.id;
    location.hash = '#/contact/compose';
  });

  actions.append(backBtn, exportBtn, composeBtn);
  view.append(actions, exportBox);
}

// ---- View 3: contact.compose ----
async function renderContactCompose() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('compose.heading')));

  if (!state.draft) state.draft = emptyInquiryDraft(selectedLawyerId);
  if (!state.draft.lawyerId) state.draft.lawyerId = selectedLawyerId;
  const draft = state.draft;

  let targetLawyer = null;
  try {
    targetLawyer = (await engine.execute('lawyer.get', { lawyerId: draft.lawyerId }, { actor: 'ui' })).lawyer;
  } catch { /* none */ }

  if (!targetLawyer) {
    view.append(el('p', t('compose.selectTarget'), 'banner warn'));
  } else {
    const info = el('div', null, 'card');
    info.append(
      el('p', `${t('compose.target')}: ${targetLawyer.name}（${targetLawyer.bar_association}）`),
      verificationBadge(targetLawyer.evaluatedVerification.effectiveStatus),
    );
    view.append(info);
  }

  // Soudan memo import block
  const importCard = el('details', null, 'panel');
  importCard.append(el('summary', t('compose.importTitle')), el('p', t('compose.importHint'), 'muted'));
  const jsonArea = el('textarea');
  jsonArea.placeholder = '{"schema":"soudan.memo.export.v1","memo":{"category":"work","name":"...","otherParty":"...","summary":"..."}}';
  const importBtn = el('button', t('compose.importBtn'), 'tonal');
  importBtn.type = 'button';
  importBtn.addEventListener('click', async () => {
    try {
      await engine.execute('inquiry.import_memo', { json: jsonArea.value, lawyerId: draft.lawyerId }, { actor: 'ui' });
      say(t('compose.importOk'));
      renderContactCompose();
    } catch (e) {
      say(t('compose.importFail', { code: e?.code || 'invalid' }));
    }
  });
  importCard.append(jsonArea, el('div', null, 'actions'));
  importCard.lastChild.append(importBtn);
  view.append(importCard);

  // Main form
  const form = el('section', null, 'card grid');
  const catSel = el('select');
  for (const c of INQUIRY_CATEGORIES) {
    const o = el('option', t('category.' + c));
    o.value = c;
    o.selected = draft.category === c;
    catSel.append(o);
  }
  catSel.addEventListener('change', () => { draft.category = catSel.value; });

  const nameIn = Object.assign(el('input'), { value: draft.clientName || '' });
  nameIn.addEventListener('input', () => { draft.clientName = nameIn.value; });

  const contactIn = Object.assign(el('input'), { value: draft.clientContact || '' });
  contactIn.addEventListener('input', () => { draft.clientContact = contactIn.value; });

  const counterIn = Object.assign(el('input'), { value: draft.counterpartyName || '' });
  counterIn.addEventListener('input', () => { draft.counterpartyName = counterIn.value; });

  const sumArea = Object.assign(el('textarea'), { value: draft.summary || '' });
  sumArea.addEventListener('input', () => { draft.summary = sumArea.value; });

  const wishArea = Object.assign(el('textarea'), { value: draft.wish || '' });
  wishArea.addEventListener('input', () => { draft.wish = wishArea.value; });

  const deadIn = Object.assign(el('input'), { value: draft.deadline || '' });
  deadIn.addEventListener('input', () => { draft.deadline = deadIn.value; });

  const evArea = el('textarea');
  evArea.value = (draft.evidenceHashes || []).map(e => `${e.url || ''} | ${e.shotName || ''} | ${e.sha256 || ''}`).join('\n');
  evArea.addEventListener('input', () => {
    draft.evidenceHashes = evArea.value
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const [url = '', shotName = '', sha256 = ''] = l.split('|').map(x => x.trim());
        return { url, shotName, sha256 };
      });
  });

  form.append(
    fieldWrap(t('compose.category'), 'c-cat', catSel),
    fieldWrap(t('compose.clientName'), 'c-name', nameIn),
    fieldWrap(t('compose.clientContact'), 'c-contact', contactIn),
    fieldWrap(t('compose.counterparty'), 'c-counter', counterIn),
    fieldWrap(t('compose.summary'), 'c-summary', sumArea),
    fieldWrap(t('compose.wish'), 'c-wish', wishArea),
    fieldWrap(t('compose.deadline'), 'c-deadline', deadIn),
    fieldWrap(t('compose.evidence'), 'c-evidence', evArea),
  );

  // Optional murakumo.cloud neutral structuring assist
  const assistOut = el('pre', '', 'code-box');
  assistOut.hidden = true;
  const assistBtn = el('button', t('compose.assistBtn'), 'secondary');
  assistBtn.type = 'button';
  assistBtn.addEventListener('click', async () => {
    say('');
    try {
      const res = await engine.execute('inference.assist', { rawText: draft.summary || '' }, { actor: 'ui' });
      assistOut.textContent = res.structuredDraft;
      assistOut.hidden = false;
      say(t('compose.assistOk'));
    } catch (e) {
      if (String(e?.message || '').includes('not approved')) say(t('compose.assistDenied'));
      else say(t('compose.assistError', { code: e?.code || e?.message || 'error' }));
    }
  });

  const actions = el('div', null, 'actions');
  const saveBtn = el('button', t('compose.saveDraft'), 'tonal');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    await engine.execute('inquiry.draft', { draft }, { actor: 'ui' });
    say(t('compose.draftSaved'));
  });

  const nextBtn = el('button', t('compose.toConsent'));
  nextBtn.type = 'button';
  nextBtn.addEventListener('click', async () => {
    const res = await engine.execute('inquiry.draft', { draft }, { actor: 'ui' });
    if (res.problems.length) {
      say('入力不足: ' + res.problems.join(', '));
      return;
    }
    location.hash = '#/contact/consent';
  });

  actions.append(saveBtn, assistBtn, nextBtn);
  form.append(el('p', t('compose.assistNote'), 'muted'), actions, assistOut);
  view.append(form);
}

// ---- View 4: contact.consent ----
async function renderContactConsent() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('consent.heading')));

  const draft = state.draft;
  const problems = validateInquiryDraft(draft);
  if (problems.length) {
    view.append(el('p', t('consent.noDraft'), 'banner warn'));
    return;
  }

  const { lawyer } = await engine.execute('lawyer.get', { lawyerId: draft.lawyerId }, { actor: 'ui' });
  const gate = canSendToLawyer(lawyer, { syntheticDemoMode: state.settings.syntheticDemoMode });

  const card = el('section', null, 'card');
  card.append(
    el('h3', t('consent.recipient')),
    el('p', `${lawyer.name}（${lawyer.bar_association} ／ 登録番号 ${lawyer.registration_number || '-'}）`),
    verificationBadge(lawyer.evaluatedVerification.effectiveStatus),
    el('h3', t('consent.e2ee')),
    el('p', t('consent.e2eeDetail'), 'muted'),
    el('h3', t('consent.preview')),
    el('pre', JSON.stringify({
      recipientLawyerId: lawyer.id,
      verificationStatus: lawyer.evaluatedVerification.effectiveStatus,
      e2eeKeyFingerprint: lawyer.e2ee_key_fingerprint,
      conflictHeader: {
        clientName: draft.clientName,
        counterpartyName: draft.counterpartyName,
        category: draft.category,
      },
      plaintextSummaryLength: [...draft.summary].length,
      evidenceHashCount: (draft.evidenceHashes || []).length,
      relayMode: state.settings.relayEndpoint ? 'configured' : 'staged_local_dry_run',
    }, null, 2), 'code-box'),
  );

  const discCard = el('section', null, 'card');
  discCard.append(el('h3', t('consent.disclosures')));
  const ul = el('ul');
  for (const item of requiredConsentDisclosures(locale)) ul.append(el('li', item));
  discCard.append(ul, nichibenrenLink());

  const actions = el('div', null, 'actions');
  const cancelBtn = el('button', t('consent.cancel'), 'secondary');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => {
    say(t('consent.cancelled'));
    location.hash = '#/contact/compose';
  });

  const approveBtn = el('button', t('consent.approve'));
  approveBtn.type = 'button';
  approveBtn.disabled = !gate.allowed;
  approveBtn.addEventListener('click', async e => {
    if (!e.isTrusted) return;
    say('');
    try {
      await engine.execute('inquiry.send', { draft, dryRun: !state.settings.relayEndpoint }, { actor: 'ui' });
      say(t('consent.sentDryRun'));
      location.hash = '#/requests';
    } catch (err) {
      say(t('consent.blocked', { code: err?.code || err?.message || 'denied' }));
    }
  });

  actions.append(cancelBtn, approveBtn);
  view.append(card, discCard, actions);
}

// ---- View 5: requests ----
async function renderRequests() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('requests.heading')));
  view.append(el('p', getLegalNotices(locale).lawyerCopyRetention, 'banner warn'));

  const res = await engine.execute('inquiry.list', {}, { actor: 'ui' });
  if (!res.inquiries.length) {
    view.append(el('p', t('requests.empty'), 'card'));
    return;
  }

  for (const item of res.inquiries) {
    const card = el('article', null, 'card');
    card.append(
      el('h3', `${item.lawyerName}（${item.barAssociation}）`),
      el('p', `${item.sentAt} ／ ${item.relayStatus} ／ ID: ${item.inquiryId}`, 'muted mono'),
      el('p', `相手方: ${item.conflictHeader.counterpartyName} ／ 分野: ${t('category.' + item.conflictHeader.category)}`),
    );

    const envDetails = el('details', null, 'panel');
    envDetails.append(
      el('summary', t('requests.inspectEnvelope')),
      el('pre', JSON.stringify(item.envelope, null, 2), 'code-box'),
    );

    const delBtn = el('button', t('requests.deleteLocal'), 'danger');
    delBtn.type = 'button';
    delBtn.addEventListener('click', async () => {
      await engine.execute('inquiry.list', { deleteInquiryId: item.inquiryId }, { actor: 'ui' });
      say(t('requests.deleted'));
      renderRequests();
    });

    card.append(envDetails, el('div', null, 'actions'));
    card.lastChild.append(delBtn);
    view.append(card);
  }
}

// ---- View 6: lawyer.onboarding ----
function renderLawyerOnboarding() {
  const view = $('view');
  view.replaceChildren();
  view.append(
    el('h2', t('onboarding.heading')),
    el('p', t('onboarding.guide'), 'banner'),
    el('p', t('onboarding.noIdPhoto'), 'banner warn'),
  );

  const form = el('section', null, 'card grid');
  const fields = {
    name: el('input'),
    name_kana: el('input'),
    bar_association: el('input'),
    registration_number: el('input'),
    office_name: el('input'),
    phone: el('input'),
  };
  fields.bar_association.placeholder = '東京弁護士会';
  fields.registration_number.placeholder = '990101';

  form.append(
    fieldWrap('氏名（規程9条必須）', 'ob-name', fields.name),
    fieldWrap('ふりがな', 'ob-kana', fields.name_kana),
    fieldWrap('所属弁護士会（規程9条必須）', 'ob-bar', fields.bar_association),
    fieldWrap('登録番号（4〜7桁数字）', 'ob-reg', fields.registration_number),
    fieldWrap('法律事務所名', 'ob-office', fields.office_name),
    fieldWrap('事務所電話番号（a2確認連絡用）', 'ob-phone', fields.phone),
  );

  const keyInfo = el('p', sessionLawyerKeyPair ? `鍵指紋: ${sessionLawyerKeyPair.keyFingerprint}` : '未生成', 'mono muted');
  const genBtn = el('button', t('onboarding.generateKeys'), 'tonal');
  genBtn.type = 'button';
  genBtn.addEventListener('click', async () => {
    sessionLawyerKeyPair = await generateLawyerKeyPair();
    keyInfo.textContent = `鍵指紋: ${sessionLawyerKeyPair.keyFingerprint}`;
    say(t('onboarding.keysGenerated', { fp: sessionLawyerKeyPair.keyFingerprint.slice(0, 16) + '...' }));
  });

  const submitBtn = el('button', t('onboarding.submit'));
  submitBtn.type = 'button';
  submitBtn.addEventListener('click', async () => {
    const submission = {
      name: fields.name.value.trim(),
      bar_association: fields.bar_association.value.trim(),
      registration_number: fields.registration_number.value.trim(),
      office_name: fields.office_name.value.trim(),
      phone: fields.phone.value.trim(),
      verification_method: 'self_declared',
    };
    const probs = validateOnboardingSubmission(submission);
    if (probs.length) {
      say(t('profileEdit.rejected', { reasons: probs.map(p => `${p.field}:${p.code}`).join(', ') }));
      return;
    }
    if (!sessionLawyerKeyPair) sessionLawyerKeyPair = await generateLawyerKeyPair();
    const profile = {
      id: 'local-lawyer-' + submission.registration_number,
      synthetic: true,
      tenant_id: state.settings.tenantId,
      name: submission.name,
      name_kana: fields.name_kana.value.trim() || submission.name,
      bar_association: submission.bar_association,
      registration_number: submission.registration_number,
      office_name: submission.office_name,
      prefecture_code: '13',
      address: '',
      phone: submission.phone,
      fax: '',
      website_url: '',
      practice_areas: ['民事一般'],
      career_facts: [],
      languages: ['日本語'],
      legal_aid_houterasu: false,
      initial_consultation_fee_note: '',
      nichibenren_search_url: NICHIBENREN_SEARCH_URL,
      verification: {
        status: 'unverified_self_declared',
        verified_at: null,
        expires_at: null,
        method: 'self_declared',
        attestation_digest: null,
      },
      e2ee_public_key_jwk: sessionLawyerKeyPair.publicKeyJwk,
      e2ee_key_fingerprint: sessionLawyerKeyPair.keyFingerprint,
    };
    await engine.execute('lawyer.profile.update', { profile }, { actor: 'ui' });
    say(t('onboarding.submitted'));
    location.hash = '#/lawyer/profile';
  });

  const actions = el('div', null, 'actions');
  actions.append(genBtn, submitBtn);
  form.append(keyInfo, actions, nichibenrenLink());
  view.append(form);
}

// ---- View 7: lawyer.profile.edit ----
function renderLawyerProfileEdit() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('profileEdit.heading')), el('p', t('profileEdit.note'), 'banner'));

  const current = state.lawyerProfile || structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  const liveAlert = el('div', '', 'banner danger');
  liveAlert.hidden = true;

  const form = el('section', null, 'card grid');
  const nameIn = Object.assign(el('input'), { value: current.name || '' });
  const barIn = Object.assign(el('input'), { value: current.bar_association || '' });
  const officeIn = Object.assign(el('input'), { value: current.office_name || '' });
  const areasIn = Object.assign(el('input'), { value: (current.practice_areas || []).join(', ') });
  const careerIn = Object.assign(el('textarea'), { value: (current.career_facts || []).join('\n') });
  const feeIn = Object.assign(el('input'), { value: current.initial_consultation_fee_note || '' });

  function buildCandidate() {
    return {
      ...current,
      name: nameIn.value.trim(),
      bar_association: barIn.value.trim(),
      office_name: officeIn.value.trim(),
      practice_areas: areasIn.value.split(',').map(x => x.trim()).filter(Boolean),
      career_facts: careerIn.value.split('\n').map(x => x.trim()).filter(Boolean),
      initial_consultation_fee_note: feeIn.value.trim(),
    };
  }

  function validateLive() {
    const probs = validateLawyerRecord(buildCandidate());
    if (probs.length) {
      liveAlert.hidden = false;
      liveAlert.textContent = t('profileEdit.rejected', {
        reasons: probs.map(p => `${p.field} (${p.code}${p.match ? `: "${p.match}"` : ''})`).join(' / '),
      });
    } else {
      liveAlert.hidden = true;
      liveAlert.textContent = '';
    }
    saveBtn.disabled = probs.length > 0;
  }

  for (const ctrl of [nameIn, barIn, officeIn, areasIn, careerIn, feeIn]) {
    ctrl.addEventListener('input', validateLive);
  }

  const saveBtn = el('button', t('profileEdit.save'));
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    try {
      await engine.execute('lawyer.profile.update', { profile: buildCandidate() }, { actor: 'ui' });
      say(t('profileEdit.saved'));
    } catch (e) {
      say(t('profileEdit.rejected', { reasons: (e.problems || []).map(p => p.code).join(', ') }));
    }
  });

  form.append(
    liveAlert,
    fieldWrap('氏名（必須）', 'pe-name', nameIn),
    fieldWrap('所属弁護士会（必須）', 'pe-bar', barIn),
    fieldWrap('法律事務所名', 'pe-office', officeIn),
    fieldWrap('取扱分野（カンマ区切り・専門表記は自動拒否）', 'pe-areas', areasIn),
    fieldWrap('経歴（事実のみ・1行1件）', 'pe-career', careerIn),
    fieldWrap('初回相談条件（事実のみ）', 'pe-fee', feeIn),
    el('div', null, 'actions'),
  );
  form.lastChild.append(saveBtn);
  view.append(form);
  validateLive();
}

// ---- View 8: lawyer.inbox ----
async function renderLawyerInbox() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('inbox.heading')), el('p', t('inbox.note'), 'banner'));

  const seedBtn = el('button', t('inbox.seedQa'), 'tonal');
  seedBtn.type = 'button';
  seedBtn.addEventListener('click', async () => {
    sessionLawyerKeyPair = await generateLawyerKeyPair();
    revealedBodies.clear();
    state.intakeRecords = await buildSyntheticQaIntakeRecords(
      state.lawyerProfile?.id || SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id,
      sessionLawyerKeyPair.publicKeyJwk,
    );
    await persistState();
    say(t('inbox.seeded'));
    renderLawyerInbox();
  });
  const topActions = el('div', null, 'actions');
  topActions.append(seedBtn);
  view.append(topActions);

  const { items } = await engine.execute('intake.list', {}, { actor: 'ui' });
  if (!items.length) {
    view.append(el('p', t('inbox.empty'), 'card'));
  } else {
    for (const item of items) {
      const card = el('article', null, 'card');
      const gateCls =
        item.conflictCheck?.result === 'conflict_detected' ? 'badge danger' :
        item.revealGate.allowed ? 'badge ok' : 'badge warn';
      const gateLabel =
        item.conflictCheck?.result === 'conflict_detected' ? '⛔ 利益相反検出 (HARD BLOCK)' :
        item.revealGate.allowed ? '✓ 利益相反なし確認済み' : '🔒 未確認（本文暗号化ロック）';
      card.append(
        el('span', gateLabel, gateCls),
        el('h3', `${item.conflictHeader.clientName} vs ${item.conflictHeader.counterpartyName}`),
        el('p', `分野: ${t('category.' + item.conflictHeader.category)} ／ 受信: ${item.receivedAt}`, 'muted'),
      );
      const openBtn = el('button', t('inbox.openGate'));
      openBtn.type = 'button';
      openBtn.addEventListener('click', () => {
        selectedInquiryId = item.inquiryId;
        location.hash = '#/lawyer/inquiry/' + encodeURIComponent(item.inquiryId);
      });
      card.append(el('div', null, 'actions'));
      card.lastChild.append(openBtn);
      view.append(card);
    }
  }

  // Local conflict ledger management
  const ledgerCard = el('section', null, 'card');
  ledgerCard.append(el('h3', t('inbox.ledgerTitle')));
  const ul = el('ul');
  for (const row of state.conflictLedger) {
    ul.append(el('li', `${row.partyName}（${row.role} / ${row.matterRef}）`));
  }
  const addIn = el('input');
  addIn.placeholder = '追加する依頼者・相手方名（例: ○○株式会社）';
  const addBtn = el('button', t('inbox.ledgerAdd'), 'secondary');
  addBtn.type = 'button';
  addBtn.addEventListener('click', async () => {
    if (!addIn.value.trim()) return;
    state.conflictLedger.push({
      id: 'ledger-' + Date.now(),
      partyName: addIn.value.trim(),
      role: 'existing_client',
      matterRef: 'ローカル追加',
    });
    await persistState();
    renderLawyerInbox();
  });
  ledgerCard.append(ul, addIn, el('div', null, 'actions'));
  ledgerCard.lastChild.append(addBtn);
  view.append(ledgerCard);
}

// ---- View 9: lawyer.inquiry.detail (AWAI-3235 HARD conflict-check gate) ----
async function renderLawyerInquiryDetail(inquiryId) {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('inquiryDetail.heading')), el('p', getLegalNotices(locale).conflictHardGate, 'banner'));

  const rec = state.intakeRecords.find(r => r.inquiryId === inquiryId);
  if (!rec) {
    view.append(el('p', t('inbox.empty'), 'card'));
    return;
  }
  selectedInquiryId = rec.inquiryId;
  const gate = canRevealInquiryBody(rec);

  // Minimal conflict-check header ONLY
  const hCard = el('section', null, 'card');
  hCard.append(el('h3', t('inquiryDetail.headerTitle')));
  const dl = el('dl', null, 'facts');
  dl.append(
    el('dt', 'Inquiry ID'), el('dd', rec.inquiryId, 'mono'),
    el('dt', '依頼者名'), el('dd', rec.conflictHeader.clientName),
    el('dt', '相手方名'), el('dd', rec.conflictHeader.counterpartyName),
    el('dt', '分野'), el('dd', t('category.' + rec.conflictHeader.category)),
    el('dt', '受信日時'), el('dd', rec.receivedAt),
  );
  hCard.append(dl);

  const checkBtn = el('button', t('inquiryDetail.runCheck'), 'tonal');
  checkBtn.type = 'button';
  checkBtn.addEventListener('click', async () => {
    await engine.execute('intake.conflict_check', { inquiryId: rec.inquiryId, confirmClear: false }, { actor: 'ui' });
    renderLawyerInquiryDetail(rec.inquiryId);
  });
  hCard.append(el('div', null, 'actions'));
  hCard.lastChild.append(checkBtn);
  view.append(hCard);

  if (rec.conflictCheck) {
    const cc = rec.conflictCheck;
    const resCard = el('section', null, 'card');
    if (cc.result === 'conflict_detected') {
      resCard.append(el('p', t('inquiryDetail.conflictDetected'), 'banner danger'));
      const ul = el('ul');
      for (const m of cc.matches) ul.append(el('li', `一致: ${m.partyName}（${m.role} / ${m.matterRef}）`));
      resCard.append(ul, el('p', `確認ダイジェスト: ${cc.receiptDigest}`, 'mono muted'));
      const decBtn = el('button', t('inquiryDetail.declineConflict'), 'danger');
      decBtn.type = 'button';
      decBtn.addEventListener('click', async () => {
        await engine.execute('intake.decide', { inquiryId: rec.inquiryId, action: 'decline_conflict' }, { actor: 'ui' });
        say('利益相反による辞退を記録しました（本文は復号されていません）。');
        renderLawyerInquiryDetail(rec.inquiryId);
      });
      resCard.append(el('div', null, 'actions'));
      resCard.lastChild.append(decBtn);
    } else {
      resCard.append(
        el('p', `ローカル台帳照合結果: 利益相反なし（一致0件）`, 'banner ok'),
        el('p', `確認ダイジェスト: ${cc.receiptDigest}`, 'mono muted'),
      );
      const confirmBox = el('input');
      confirmBox.type = 'checkbox';
      confirmBox.checked = Boolean(cc.confirmedByLawyer);
      confirmBox.addEventListener('change', async () => {
        await engine.execute('intake.conflict_check', { inquiryId: rec.inquiryId, confirmClear: confirmBox.checked }, { actor: 'ui' });
        renderLawyerInquiryDetail(rec.inquiryId);
      });
      const lab = el('label', t('inquiryDetail.confirmLabel'), 'check');
      lab.prepend(confirmBox);
      resCard.append(lab);

      const revealBtn = el('button', t('inquiryDetail.revealBtn'));
      revealBtn.type = 'button';
      revealBtn.disabled = !gate.allowed;
      revealBtn.addEventListener('click', async () => {
        try {
          const out = await engine.execute('intake.decide', { inquiryId: rec.inquiryId, action: 'reveal' }, { actor: 'ui' });
          revealedBodies.set(rec.inquiryId, out.plaintext);
          renderLawyerInquiryDetail(rec.inquiryId);
        } catch (err) {
          say(err?.code || err?.message || 'reveal-blocked');
        }
      });
      resCard.append(el('div', null, 'actions'));
      resCard.lastChild.append(revealBtn);
    }
    view.append(resCard);
  }

  // Revealed body & encrypted reply (ONLY when conflict gate cleared & decrypted locally)
  const decrypted = revealedBodies.get(rec.inquiryId);
  if (gate.allowed && decrypted) {
    const bodyCard = el('section', null, 'card');
    bodyCard.append(
      el('h3', t('inquiryDetail.bodyTitle')),
      el('pre', JSON.stringify(decrypted, null, 2), 'code-box'),
    );
    const replyArea = el('textarea');
    replyArea.placeholder = t('inquiryDetail.replyPlaceholder');
    const acceptBtn = el('button', t('inquiryDetail.acceptBtn'));
    acceptBtn.type = 'button';
    acceptBtn.addEventListener('click', async e => {
      if (!e.isTrusted) return;
      try {
        await engine.execute('intake.decide', { inquiryId: rec.inquiryId, action: 'accept', replyText: replyArea.value || '初回面談の日程候補をお送りします。' }, { actor: 'ui' });
        say('暗号化応答を記録しました。');
        renderLawyerInquiryDetail(rec.inquiryId);
      } catch (err) { say(err?.message || 'blocked'); }
    });
    const declineBtn = el('button', t('inquiryDetail.declineBtn'), 'secondary');
    declineBtn.type = 'button';
    declineBtn.addEventListener('click', async e => {
      if (!e.isTrusted) return;
      try {
        await engine.execute('intake.decide', { inquiryId: rec.inquiryId, action: 'decline', replyText: replyArea.value || '誠に恐れ入りますが受任を見送らせていただきます。' }, { actor: 'ui' });
        say('辞退応答を記録しました。');
        renderLawyerInquiryDetail(rec.inquiryId);
      } catch (err) { say(err?.message || 'blocked'); }
    });
    bodyCard.append(replyArea, el('div', null, 'actions'), el('p', t('inquiryDetail.noForward'), 'muted'));
    bodyCard.querySelector('.actions').append(acceptBtn, declineBtn);
    view.append(bodyCard);
  }
}

// ---- View 10: audit ----
async function renderAudit() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('audit.heading')));
  const res = await engine.execute('audit.list', { limit: 100 }, { actor: 'ui' });
  view.append(el('p', res.integrity.ok ? t('audit.chainOk', { count: res.total }) : t('audit.chainBroken'), res.integrity.ok ? 'banner ok' : 'banner danger'));
  if (!res.entries.length) {
    view.append(el('p', t('audit.empty'), 'card'));
    return;
  }
  for (const e of res.entries) {
    const card = el('article', null, 'card');
    card.append(
      el('p', `#${e.seq} [${e.actor}] ${e.operation} -> ${e.outcome}`, 'mono'),
      el('p', `${e.timestamp} — ${e.summary}`),
      el('p', `SHA-256: ${e.entryHash}`, 'mono muted'),
    );
    view.append(card);
  }
}

// ---- View 11: embed.mcp (SEP-1865 APP-01..APP-04) ----
function renderEmbedMcp() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('embed.heading')), el('p', t('embed.note'), 'banner'));

  const origin = location.origin && location.origin !== 'null' ? location.origin : 'https://bengoshi.itonami.app';
  const sessionToken = 'sep1865-local-qa-session';
  const bridge = createMcpEmbedBridge({ allowedOrigin: origin, expectedSessionToken: sessionToken });
  const logBox = el('pre', 'Ready. Phase: ' + bridge.getPhase(), 'code-box');

  const logReply = (label, msg) => {
    logBox.textContent = `${label}\nPhase: ${bridge.getPhase()}\n${JSON.stringify(msg, null, 2)}`;
  };

  const bPre = el('button', t('embed.simPreInit'), 'secondary');
  bPre.type = 'button';
  bPre.addEventListener('click', () => {
    const out = bridge.handleMessage({
      origin,
      data: { jsonrpc: '2.0', id: 99, method: 'tools/call', params: { sessionToken, name: 'directory.search', arguments: {} } },
    });
    logReply('Pre-init negative test (APP-01):', out);
  });

  const bInit = el('button', t('embed.simInit'), 'tonal');
  bInit.type = 'button';
  bInit.addEventListener('click', () => {
    const r1 = bridge.handleMessage({ origin, data: { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { sessionToken } } });
    bridge.handleMessage({ origin, data: { jsonrpc: '2.0', method: 'ui/notifications/initialized', params: { sessionToken } } });
    logReply('Initialized (APP-01/02):', r1);
  });

  const bSearch = el('button', t('embed.simSearch'));
  bSearch.type = 'button';
  bSearch.addEventListener('click', () => {
    const out = bridge.handleMessage({
      origin,
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { sessionToken, name: 'directory.search', arguments: { sort: 'kana_asc' } } },
    });
    logReply('Read-only directory.search (APP-03/04):', out);
  });

  const bWrite = el('button', t('embed.simWrite'), 'danger');
  bWrite.type = 'button';
  bWrite.addEventListener('click', () => {
    const out = bridge.handleMessage({
      origin,
      data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { sessionToken, name: 'inquiry.send', arguments: {} } },
    });
    logReply('Unauthorized write negative test (APP-03):', out);
  });

  const actions = el('div', null, 'actions');
  actions.append(bPre, bInit, bSearch, bWrite);
  view.append(actions, logBox);

  // Live host iframe postMessage listener when embedded with explicit allowed parent origin
  if (window.parent && window.parent !== window) {
    const allowedParent = new URLSearchParams(location.search).get('parentOrigin');
    if (allowedParent && /^https:\/\/[^*\s]+$/.test(allowedParent)) {
      const liveBridge = createMcpEmbedBridge({
        allowedOrigin: allowedParent,
        expectedSessionToken: new URLSearchParams(location.search).get('sessionToken') || null,
        postReply: (reply, target) => window.parent.postMessage(reply, target),
      });
      window.addEventListener('message', ev => { liveBridge.handleMessage(ev); });
    }
  }
}

async function route() {
  const hash = location.hash || '#/search';
  if (hash.startsWith('#/lawyer/')) activeMode = 'lawyer';
  else if (hash === '#/audit' || hash === '#/embed/mcp') activeMode = 'shared';
  else activeMode = 'user';

  renderChrome();

  if (hash.startsWith('#/profile/')) {
    await renderProfileDetail(decodeURIComponent(hash.slice('#/profile/'.length)));
  } else if (hash === '#/contact/compose') {
    await renderContactCompose();
  } else if (hash === '#/contact/consent') {
    await renderContactConsent();
  } else if (hash === '#/requests') {
    await renderRequests();
  } else if (hash === '#/lawyer/onboarding') {
    renderLawyerOnboarding();
  } else if (hash === '#/lawyer/profile') {
    renderLawyerProfileEdit();
  } else if (hash === '#/lawyer/inbox') {
    await renderLawyerInbox();
  } else if (hash.startsWith('#/lawyer/inquiry/')) {
    await renderLawyerInquiryDetail(decodeURIComponent(hash.slice('#/lawyer/inquiry/'.length)));
  } else if (hash === '#/audit') {
    await renderAudit();
  } else if (hash === '#/embed/mcp') {
    renderEmbedMcp();
  } else {
    await renderSearch();
  }
}

async function start() {
  const integrity = verifySyntheticCatalogIntegrity();
  if (!integrity.ok) throw new Error('synthetic-catalog-integrity-failed');
  try { await host.initialize(); } catch { /* web runtime */ }
  await loadState();
  buildBroker();

  $('lang-toggle').addEventListener('click', async () => {
    locale = locale === 'ja' ? 'en' : 'ja';
    t = translator(locale);
    state.settings.locale = locale;
    buildBroker();
    await persistState();
    route();
  });

  window.addEventListener('hashchange', route);
  await route();
}

start();
