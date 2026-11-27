// Bengoshi SPA (network.itonami.bengoshi) — Static-first, zero external network calls (`operations: []`).
// Default landing: Official Lawyer Search Guide (MOJ 2026 注 20 compliant) + Lawyer Participation Policy preview.
// Preview screens (synthetic samples only, Method A primary contact, Art. 11 3-year export, local AWAI-3235 conflict gate):
// - Guide & User Preview: guide (default), search, profile.detail, contact.compose, contact.consent, requests
// - Lawyer Preview: lawyer.onboarding, lawyer.profile.edit, lawyer.inbox, lawyer.inquiry.detail
// - Audit & MCP POC: audit, embed.mcp
// Forms strictly use `type="button" data-submit` + `bindForm` (no native form submission).

import { createHost } from './host.js';
import { persistLocalState, isStoragePersistError } from './storage.js';
import { clientRuntimeProblems } from './runtime.js';
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
  formatManualContactText,
  formatDraftCopyText,
  canRevealInquiryBody,
  sanitizeEntryLocation,
} from './model.js';
import { generateLawyerKeyPair } from './crypto.js';
import {
  PUBLIC_SEARCH_GUIDE_LINKS,
  getLegalNotices,
  getParticipationPolicy,
  requiredConsentDisclosures,
  NICHIBENREN_SEARCH_URL,
} from './legal-notices.js';
import { getOperatorDisclosure } from './operator-disclosure.js';
import { pickLocale, translator } from './messages.js';
import { runtimeDescriptor, REQUESTED_CAPABILITIES } from './runtime-descriptor.js';
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

// AwaiSpec form helper: binds `type="button" data-submit` inside a plain container.
// Uses explicit button clicks and Enter-key handling instead of native form submission.
export function bindForm(container, onSubmit) {
  if (!container || typeof onSubmit !== 'function') return;
  const trigger = async (ev) => {
    await onSubmit(ev);
  };
  for (const btn of container.querySelectorAll('button[type="button"][data-submit]')) {
    btn.addEventListener('click', trigger);
  }
  container.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target && ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox') {
      const btn = container.querySelector('button[type="button"][data-submit]');
      if (btn && !btn.disabled) {
        ev.preventDefault();
        trigger(ev);
      }
    }
  });
}

async function copyText(text, successMsg) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = el('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    say(successMsg);
  } catch {
    say(successMsg);
  }
}

let locale = pickLocale(navigator.languages);
let t = translator(locale);
const host = createHost({ appId: 'network.itonami.bengoshi' });
let revision = 0;
let state = createInitialLocalState();
state.settings.locale = locale;
let lastCommittedState = structuredClone(state);

const TRACKED_STATE_SECTIONS = Object.freeze([
  'draft',
  'lawyerProfile',
  'sentInquiries',
  'intakeRecords',
  'conflictLedger',
  'settings',
  'auditLog',
]);

function normalizeLocalState(rawData) {
  const base = createInitialLocalState();
  if (!rawData || typeof rawData !== 'object') {
    base.settings.locale = locale;
    return base;
  }
  const normalized = {
    ...base,
    ...structuredClone(rawData),
    settings: { ...base.settings, ...(rawData.settings && typeof rawData.settings === 'object' ? structuredClone(rawData.settings) : {}) },
  };
  if (!Array.isArray(normalized.sentInquiries)) normalized.sentInquiries = [];
  if (!Array.isArray(normalized.lawyerEditHistory)) normalized.lawyerEditHistory = [];
  if (!Array.isArray(normalized.conflictLedger)) normalized.conflictLedger = [...base.conflictLedger];
  if (!Array.isArray(normalized.intakeRecords)) normalized.intakeRecords = [];
  if (!Array.isArray(normalized.auditLog)) normalized.auditLog = [];
  return normalized;
}

function replaceInMemoryState(nextData) {
  const normalized = normalizeLocalState(nextData);
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, normalized);
}

function diffStateSections(prevState, nextState) {
  const changed = [];
  for (const key of TRACKED_STATE_SECTIONS) {
    if (JSON.stringify(prevState?.[key] ?? null) !== JSON.stringify(nextState?.[key] ?? null)) {
      changed.push(key);
    }
  }
  return changed;
}

// Ephemeral device-only QA private key (kept in memory only; never persisted outside session)
let sessionLawyerKeyPair = null;
let revealedBodies = new Map();
let activeMode = 'user'; // user | lawyer | shared
let selectedLawyerId = SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id;
let pendingComposeLawyerId = '';
let selectedInquiryId = '';
let firewallRejectedParams = [];
let searchFilter = {
  query: '',
  prefectureCode: '',
  practiceArea: '',
  language: '',
  legalAidHouterasu: null,
  verificationStatus: '',
  sort: 'kana_asc',
};

let engine = null;

function say(msg) {
  const elStatus = $('status');
  if (elStatus) elStatus.textContent = msg || '';
}

function formatStorageError(result, { activeSection = null } = {}) {
  const code = result?.code || result?.causeCode || result?.error?.code || result?.error?.name || 'storage-write-failed';
  if (code === 'state-conflict' && result?.refreshed) {
    const from = Number.isSafeInteger(result.previousRevision) ? result.previousRevision : 0;
    const to = Number.isSafeInteger(result.latestRevision) ? result.latestRevision : revision;
    const sections = Array.isArray(result.changedSections) ? result.changedSections : [];
    const displaySections = sections.filter(s => s !== 'auditLog');
    const sectionLabels = (displaySections.length ? displaySections : sections)
      .map(s => t('storage.section.' + s))
      .join(' / ');
    let msg = sectionLabels
      ? t('storage.conflictRefreshedWithSections', { from, to, sections: sectionLabels })
      : t('storage.conflictRefreshed', { from, to });
    if (activeSection && sections.includes(activeSection)) {
      msg += ' ' + t('storage.conflictSameEntityNote', { section: t('storage.section.' + activeSection) });
    }
    return msg;
  }

  let reason;
  if (code === 'atomic-write-unavailable' || code === 'lock-unavailable') {
    reason = t('storage.reason.atomicUnavailable');
  } else if (code === 'unreadable-state') {
    reason = t('storage.reason.unreadable');
  } else if (code === 'quota-exceeded' || code === 'QuotaExceededError' || code === 'data-too-large') {
    reason = t('storage.reason.quota');
  } else if (code === 'storage-unavailable' || code === 'SecurityError') {
    reason = t('storage.reason.unavailable');
  } else if (code === 'state-conflict') {
    reason = t('storage.reason.conflict');
  } else {
    reason = t('storage.reason.generic', { detail: result?.message || code });
  }
  return t('storage.saveFailed', { reason });
}

function createStorageAlert() {
  const box = el('div', '', 'banner danger');
  box.setAttribute('role', 'alert');
  box.dataset.storageAlert = 'true';
  box.hidden = true;
  return box;
}

function showStorageError(result, localAlertEl = null, opts = {}) {
  say('');
  const msg = formatStorageError(result, opts);
  const target = localAlertEl || $('storage-alert');
  if (target) {
    target.textContent = msg;
    target.hidden = false;
  }
}

function clearStorageError(localAlertEl = null) {
  if (localAlertEl) {
    localAlertEl.textContent = '';
    localAlertEl.hidden = true;
  }
  const globalAlert = $('storage-alert');
  if (globalAlert) {
    globalAlert.textContent = '';
    globalAlert.hidden = true;
  }
}

function buildEngine() {
  const descriptor = runtimeDescriptor();
  const problems = clientRuntimeProblems(descriptor, [...REQUESTED_CAPABILITIES], location.origin);
  if (problems.length) throw new Error('invalid-runtime-descriptor: ' + JSON.stringify(problems));

  engine = createOperationsEngine({
    catalog: SYNTHETIC_CATALOG_BUNDLE.lawyers,
    state,
    getPrivateKeyJwk: async () => sessionLawyerKeyPair?.privateKeyJwk || null,
    onStateChange: persistState,
  });
}

export async function persistState() {
  const result = await persistLocalState({
    host,
    revision,
    state,
  });
  if (result.ok) {
    revision = result.revision;
    lastCommittedState = structuredClone(state);
    return result;
  }
  if (result.code === 'state-conflict' && typeof host.read === 'function') {
    try {
      const latest = await host.read();
      if (latest && Number.isSafeInteger(latest.revision)) {
        const previousRevision = revision;
        const latestState = normalizeLocalState(latest.data);
        const changedSections = diffStateSections(lastCommittedState, latestState);
        revision = latest.revision;
        lastCommittedState = structuredClone(latestState);
        replaceInMemoryState(latestState);
        return {
          ...result,
          refreshed: true,
          previousRevision,
          latestRevision: latest.revision,
          refreshedRevision: latest.revision,
          refreshedState: latestState,
          changedSections,
        };
      }
    } catch {
      // Return original state-conflict result if latest state cannot be read
    }
  }
  return result;
}

async function mutateAndPersist(mutator) {
  const snapshot = structuredClone(state);
  mutator(state);
  const res = await persistState();
  if (!res.ok) {
    if (res.refreshedState && typeof res.refreshedState === 'object') {
      replaceInMemoryState(res.refreshedState);
    } else {
      replaceInMemoryState(snapshot);
    }
    return res;
  }
  return res;
}

async function loadState() {
  try {
    const stored = await host.read();
    revision = stored.revision;
    if (stored.data && typeof stored.data === 'object') {
      replaceInMemoryState(stored.data);
      if (state.settings.locale === 'ja' || state.settings.locale === 'en') {
        locale = state.settings.locale;
        t = translator(locale);
      }
    }
    lastCommittedState = structuredClone(state);
  } catch {
    lastCommittedState = structuredClone(state);
  }
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

function participationPolicyCard() {
  const sec = el('section', null, 'card');
  sec.append(el('h3', t('guide.policyHeading')));
  const ul = el('ul');
  for (const item of getParticipationPolicy(locale)) {
    ul.append(el('li', item));
  }
  sec.append(ul);
  return sec;
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
    const nextScope = scopeSel.value;
    const res = await mutateAndPersist(s => { s.settings.directoryScope = nextScope; });
    if (!res.ok) {
      scopeSel.value = state.settings.directoryScope;
      showStorageError(res, null, { activeSection: 'settings' });
      return;
    }
    clearStorageError();
    route();
  });

  const demoCheck = el('input');
  demoCheck.type = 'checkbox';
  demoCheck.checked = Boolean(state.settings.syntheticDemoMode);
  demoCheck.addEventListener('change', async () => {
    const nextChecked = demoCheck.checked;
    const res = await mutateAndPersist(s => { s.settings.syntheticDemoMode = nextChecked; });
    if (!res.ok) {
      demoCheck.checked = Boolean(state.settings.syntheticDemoMode);
      showStorageError(res, null, { activeSection: 'settings' });
      return;
    }
    clearStorageError();
    route();
  });
  const demoLabel = el('label', t('settings.demoMode'), 'check');
  demoLabel.prepend(demoCheck);

  body.append(
    fieldWrap(t('settings.scope'), 'set-scope', scopeSel),
    demoLabel,
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
  $('preview-banner').textContent = getLegalNotices(locale).previewBanner;
  $('environment').textContent = t('env.line', {
    runtime: t(host.info().runtime === 'web' ? 'env.web' : 'env.tauri'),
  });

  const modeBar = $('mode-bar');
  modeBar.replaceChildren();
  for (const [m, key, defaultHash] of [
    ['user', 'mode.user', '#/guide'],
    ['lawyer', 'mode.lawyer', '#/lawyer/onboarding'],
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
          ['#/guide', t('nav.guide')],
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

  const currentHash = sanitizeEntryLocation('', location.hash || '#/guide').cleanHash;
  for (const [href, label] of links) {
    const a = el('a', label);
    a.href = href;
    const base = href.split('/').slice(0, 2).join('/');
    if (
      currentHash === href ||
      (href === '#/guide' && (currentHash === '#/' || currentHash === '')) ||
      (href.includes('/profile/') && currentHash.startsWith('#/profile/')) ||
      (href.includes('/lawyer/inquiry/') && currentHash.startsWith('#/lawyer/inquiry/'))
    ) {
      a.setAttribute('aria-current', 'page');
    } else if (base === '#/contact' && currentHash === href) {
      a.setAttribute('aria-current', 'page');
    }
    nav.append(a);
  }

  renderSettingsPanel();

  const footer = $('footer');
  footer.replaceChildren();
  const opDisc = getOperatorDisclosure(locale);
  const opBox = el('section', null, 'card');
  opBox.setAttribute('data-operator-disclosure', opDisc.status);
  opBox.append(
    el('p', opDisc.entityName, 'mono'),
    el('p', opDisc.domesticContact),
    el('p', opDisc.feePolicy),
    el('p', opDisc.legalBasisNote, 'muted'),
  );

  const ul = el('ul');
  for (const line of requiredConsentDisclosures(locale)) ul.append(el('li', line));
  ul.append(el('li', getLegalNotices(locale).soudanFirewall));
  ul.append(el('li', getLegalNotices(locale).publicReleaseGate));
  footer.append(opBox, ul, nichibenrenLink());
}

// ---- Default Landing View: Public Lawyer Search Guide (MOJ 2026 注 20) ----
function renderPublicGuide() {
  const view = $('view');
  view.replaceChildren();

  if (firewallRejectedParams.length) {
    view.append(el('p', t('guide.firewallNotice', { params: firewallRejectedParams.join(', ') }), 'banner warn'));
  }

  view.append(
    el('h2', t('guide.heading')),
    el('p', t('guide.intro'), 'muted'),
  );

  const grid = el('div', null, 'grid');
  for (const item of PUBLIC_SEARCH_GUIDE_LINKS) {
    const card = el('article', null, 'card');
    card.append(
      el('h3', item.title[locale]),
      el('p', item.summary[locale]),
    );
    const stepsUl = el('ul');
    for (const s of item.usageSteps[locale]) stepsUl.append(el('li', s));
    const link = el('a', `${t('guide.openOfficial')}: ${item.url}`, 'ext-link');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    card.append(stepsUl, link);
    grid.append(card);
  }
  view.append(grid);

  // Lawyer Participation Policy preview section
  view.append(participationPolicyCard());

  const actions = el('div', null, 'actions');
  const previewBtn = el('button', t('guide.previewCta'), 'tonal');
  previewBtn.type = 'button';
  previewBtn.addEventListener('click', () => { location.hash = '#/search'; });

  const composeBtn = el('button', t('guide.composeCta'), 'secondary');
  composeBtn.type = 'button';
  composeBtn.addEventListener('click', () => { location.hash = '#/contact/compose'; });

  actions.append(previewBtn, composeBtn);
  view.append(actions);
}

// ---- View: search (Synthetic Directory Preview) ----
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

  const storageAlert = createStorageAlert();
  const countEl = el('p', '', 'muted');
  const resultsWrap = el('div', null, 'grid');
  view.append(storageAlert, countEl, resultsWrap);

  async function renderResults() {
    const res = await engine.execute('directory.search', searchFilter, { actor: 'ui' });
    if (res.persistResult && res.persistResult.ok === false) {
      showStorageError(res.persistResult, storageAlert);
    } else {
      clearStorageError(storageAlert);
    }
    countEl.textContent = t('search.count', { count: res.total });
    resultsWrap.replaceChildren();
    if (!res.lawyers.length) {
      resultsWrap.append(el('p', t('search.empty'), 'card'));
      return;
    }
    for (const lawyer of res.lawyers) {
      const card = el('article', null, 'card');
      const head = el('div', null, 'chips');
      if (lawyer.synthetic) head.append(el('span', t('badge.synthetic'), 'badge warn'));
      head.append(verificationBadge(lawyer.evaluatedVerification.effectiveStatus));
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
      const actions = el('div', null, 'actions');
      actions.append(btn);
      card.append(actions);
      resultsWrap.append(card);
    }
  }

  await renderResults();
}

// ---- View: profile.detail ----
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
  const hardHold = ev.hardHold;

  view.append(el('h2', `${lawyer.name}（${lawyer.name_kana || ''}）`));
  const badges = el('div', null, 'chips');
  if (lawyer.synthetic) badges.append(el('span', t('badge.synthetic'), 'badge warn'));
  badges.append(verificationBadge(ev.effectiveStatus));
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
  addFact(t('profile.email'), lawyer.email);
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

  const storageAlert = createStorageAlert();
  const exportBox = el('pre', '', 'code-box');
  exportBox.hidden = true;

  const actions = el('div', null, 'actions');
  const backBtn = el('button', t('profile.back'), 'secondary');
  backBtn.type = 'button';
  backBtn.addEventListener('click', () => { location.hash = '#/search'; });

  const copyContactBtn = el('button', t('profile.copyContact'), 'tonal');
  copyContactBtn.type = 'button';
  copyContactBtn.disabled = hardHold;
  copyContactBtn.addEventListener('click', async () => {
    try {
      const res = await engine.execute('contact.format_manual', { lawyerId: lawyer.id }, { actor: 'ui' });
      clearStorageError(storageAlert);
      exportBox.textContent = res.text;
      exportBox.hidden = false;
      await copyText(res.text, t('profile.contactCopied'));
    } catch (err) {
      if (isStoragePersistError(err)) {
        showStorageError(err.persistResult || err, storageAlert);
        return;
      }
      say(t('profile.contactBlocked'));
    }
  });

  const exportBtn = el('button', t('profile.exportCard'), 'secondary');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', () => {
    const cardJson = exportLawyerCard(lawyer);
    exportBox.textContent = JSON.stringify(cardJson, null, 2);
    exportBox.hidden = false;
    say(t('profile.cardExported'));
  });

  const composeBtn = el('button', hardHold ? t('profile.blockedCta') : t('profile.composeCta'));
  composeBtn.type = 'button';
  composeBtn.disabled = hardHold;
  composeBtn.addEventListener('click', () => {
    pendingComposeLawyerId = lawyer.id;
    location.hash = '#/contact/compose';
  });

  actions.append(backBtn, copyContactBtn, exportBtn, composeBtn);
  view.append(storageAlert, actions, exportBox);
}

// ---- View: contact.compose (Method A primary + Soudan Memo Import) ----
async function renderContactCompose() {
  const view = $('view');
  view.replaceChildren();
  view.append(
    el('h2', t('compose.heading')),
    el('p', t('compose.methodANote'), 'banner'),
  );

  const draft = state.draft
    ? structuredClone(state.draft)
    : emptyInquiryDraft(pendingComposeLawyerId || selectedLawyerId);
  if (pendingComposeLawyerId) {
    draft.lawyerId = pendingComposeLawyerId;
    pendingComposeLawyerId = '';
  }
  if (!draft.lawyerId) draft.lawyerId = selectedLawyerId;

  let targetLawyer = null;
  try {
    targetLawyer = (await engine.execute('lawyer.get', { lawyerId: draft.lawyerId }, { actor: 'ui' })).lawyer;
  } catch { /* none */ }

  if (!targetLawyer) {
    view.append(el('p', t('compose.selectTarget'), 'banner warn'));
  } else {
    const info = el('div', null, 'card');
    const chips = el('div', null, 'chips');
    if (targetLawyer.synthetic) chips.append(el('span', t('badge.synthetic'), 'badge warn'));
    chips.append(verificationBadge(targetLawyer.evaluatedVerification.effectiveStatus));
    info.append(
      chips,
      el('p', `${t('compose.target')}: ${targetLawyer.name}（${targetLawyer.bar_association}） / ${targetLawyer.office_name || '—'}`),
    );
    view.append(info);
  }

  // Soudan memo import block (exact soudan.memo.export.v1)
  const importCard = el('details', null, 'panel');
  const importAlert = createStorageAlert();
  importCard.append(el('summary', t('compose.importTitle')), el('p', t('compose.importHint'), 'muted'));
  const jsonArea = el('textarea');
  jsonArea.placeholder = '{"schema":"soudan.memo.export.v1","template":"consultation-memo.jpn.v1","memo":{"category":"work","name":"...","otherParty":"...","summary":"...","wish":"...","deadline":"...","documents":[],"evidence_manifest":[]}}';
  const importBtn = el('button', t('compose.importBtn'), 'tonal');
  importBtn.type = 'button';
  importBtn.dataset.submit = '';
  const importActions = el('div', null, 'actions');
  importActions.append(importBtn);
  importCard.append(importAlert, jsonArea, importActions);
  bindForm(importCard, async () => {
    try {
      await engine.execute('inquiry.import_memo', { json: jsonArea.value, lawyerId: draft.lawyerId }, { actor: 'ui' });
      clearStorageError(importAlert);
      say(t('compose.importOk'));
      renderContactCompose();
    } catch (e) {
      if (isStoragePersistError(e)) {
        showStorageError(e.persistResult || e, importAlert, { activeSection: 'draft' });
        return;
      }
      say(t('compose.importFail', { code: e?.code || 'invalid' }));
    }
  });
  view.append(importCard);

  // Main input container (uses type="button" data-submit + bindForm)
  const form = el('section', null, 'card grid');
  const dirtyFields = new Set();

  const catSel = el('select');
  for (const c of INQUIRY_CATEGORIES) {
    const o = el('option', t('category.' + c));
    o.value = c;
    o.selected = draft.category === c;
    catSel.append(o);
  }
  catSel.addEventListener('change', () => { dirtyFields.add('category'); draft.category = catSel.value; });

  const nameIn = Object.assign(el('input'), { value: draft.clientName || '' });
  nameIn.addEventListener('input', () => { dirtyFields.add('clientName'); draft.clientName = nameIn.value; });

  const contactIn = Object.assign(el('input'), { value: draft.clientContact || '' });
  contactIn.addEventListener('input', () => { dirtyFields.add('clientContact'); draft.clientContact = contactIn.value; });

  const counterIn = Object.assign(el('input'), { value: draft.counterpartyName || '' });
  counterIn.addEventListener('input', () => { dirtyFields.add('counterpartyName'); draft.counterpartyName = counterIn.value; });

  const sumArea = Object.assign(el('textarea'), { value: draft.summary || '' });
  sumArea.addEventListener('input', () => { dirtyFields.add('summary'); draft.summary = sumArea.value; });

  const wishArea = Object.assign(el('textarea'), { value: draft.wish || '' });
  wishArea.addEventListener('input', () => { dirtyFields.add('wish'); draft.wish = wishArea.value; });

  const deadIn = Object.assign(el('input'), { value: draft.deadline || '' });
  deadIn.addEventListener('input', () => { dirtyFields.add('deadline'); draft.deadline = deadIn.value; });

  const docsArea = Object.assign(el('textarea'), { value: (draft.documents || []).join('\n') });
  docsArea.addEventListener('input', () => {
    dirtyFields.add('documents');
    draft.documents = docsArea.value.split('\n').map(l => l.trim()).filter(Boolean);
  });

  const evArea = el('textarea');
  evArea.readOnly = true;
  evArea.value = JSON.stringify(draft.evidenceManifest || [], null, 2);

  function syncUntouchedDraftFromLatest() {
    const latestDraft = state.draft;
    if (!latestDraft || typeof latestDraft !== 'object') return;
    if (!dirtyFields.has('category') && latestDraft.category) {
      draft.category = latestDraft.category;
      catSel.value = latestDraft.category;
    }
    if (!dirtyFields.has('clientName') && typeof latestDraft.clientName === 'string') {
      draft.clientName = latestDraft.clientName;
      nameIn.value = latestDraft.clientName;
    }
    if (!dirtyFields.has('clientContact') && typeof latestDraft.clientContact === 'string') {
      draft.clientContact = latestDraft.clientContact;
      contactIn.value = latestDraft.clientContact;
    }
    if (!dirtyFields.has('counterpartyName') && typeof latestDraft.counterpartyName === 'string') {
      draft.counterpartyName = latestDraft.counterpartyName;
      counterIn.value = latestDraft.counterpartyName;
    }
    if (!dirtyFields.has('summary') && typeof latestDraft.summary === 'string') {
      draft.summary = latestDraft.summary;
      sumArea.value = latestDraft.summary;
    }
    if (!dirtyFields.has('wish') && typeof latestDraft.wish === 'string') {
      draft.wish = latestDraft.wish;
      wishArea.value = latestDraft.wish;
    }
    if (!dirtyFields.has('deadline') && typeof latestDraft.deadline === 'string') {
      draft.deadline = latestDraft.deadline;
      deadIn.value = latestDraft.deadline;
    }
    if (!dirtyFields.has('documents') && Array.isArray(latestDraft.documents)) {
      draft.documents = [...latestDraft.documents];
      docsArea.value = draft.documents.join('\n');
    }
    if (Array.isArray(latestDraft.timeline) && !draft.timeline?.length) {
      draft.timeline = structuredClone(latestDraft.timeline);
    }
    if (Array.isArray(latestDraft.evidenceManifest) && !draft.evidenceManifest?.length) {
      draft.evidenceManifest = structuredClone(latestDraft.evidenceManifest);
      evArea.value = JSON.stringify(draft.evidenceManifest, null, 2);
    }
  }

  function buildDraftCandidate() {
    const base = state.draft && typeof state.draft === 'object' ? structuredClone(state.draft) : {};
    return {
      ...base,
      ...structuredClone(draft),
      lawyerId: draft.lawyerId || base.lawyerId || selectedLawyerId,
      category: dirtyFields.has('category') ? catSel.value : (catSel.value || draft.category || base.category),
      clientName: nameIn.value,
      clientContact: contactIn.value,
      counterpartyName: counterIn.value,
      summary: sumArea.value,
      wish: wishArea.value,
      deadline: deadIn.value,
      documents: docsArea.value.split('\n').map(l => l.trim()).filter(Boolean),
    };
  }

  form.append(
    fieldWrap(t('compose.category'), 'c-cat', catSel),
    fieldWrap(t('compose.clientName'), 'c-name', nameIn),
    fieldWrap(t('compose.clientContact'), 'c-contact', contactIn),
    fieldWrap(t('compose.counterparty'), 'c-counter', counterIn),
    fieldWrap(t('compose.summary'), 'c-summary', sumArea),
    fieldWrap(t('compose.wish'), 'c-wish', wishArea),
    fieldWrap(t('compose.deadline'), 'c-deadline', deadIn),
    fieldWrap(t('compose.documents'), 'c-docs', docsArea),
    fieldWrap(t('compose.evidence'), 'c-evidence', evArea),
  );

  const storageAlert = createStorageAlert();
  const actions = el('div', null, 'actions');
  const saveBtn = el('button', t('compose.saveDraft'), 'tonal');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    try {
      await engine.execute('inquiry.draft', { draft: buildDraftCandidate() }, { actor: 'ui' });
      clearStorageError(storageAlert);
      say(t('compose.draftSaved'));
    } catch (err) {
      if (isStoragePersistError(err)) {
        const res = err.persistResult || err;
        if (res?.code === 'state-conflict' && res?.refreshed) syncUntouchedDraftFromLatest();
        showStorageError(res, storageAlert, { activeSection: 'draft' });
        return;
      }
      say(err?.message || 'save-failed');
    }
  });

  const copyContactBtn = el('button', t('compose.copyContact'), 'secondary');
  copyContactBtn.type = 'button';
  copyContactBtn.disabled = !targetLawyer || targetLawyer.evaluatedVerification.hardHold;
  copyContactBtn.addEventListener('click', async () => {
    try {
      const res = await engine.execute('contact.format_manual', { lawyerId: targetLawyer.id }, { actor: 'ui' });
      clearStorageError(storageAlert);
      await copyText(res.text, t('profile.contactCopied'));
    } catch (err) {
      if (isStoragePersistError(err)) {
        showStorageError(err.persistResult || err, storageAlert);
        return;
      }
      say(t('profile.contactBlocked'));
    }
  });

  const copyDraftBtn = el('button', t('compose.copyDraft'), 'secondary');
  copyDraftBtn.type = 'button';
  copyDraftBtn.addEventListener('click', async () => {
    await copyText(formatDraftCopyText(buildDraftCandidate(), targetLawyer), t('compose.draftCopied'));
  });

  const nextBtn = el('button', t('compose.toConsent'));
  nextBtn.type = 'button';
  nextBtn.dataset.submit = '';

  actions.append(saveBtn, copyContactBtn, copyDraftBtn, nextBtn);
  form.append(storageAlert, actions);

  bindForm(form, async () => {
    try {
      const res = await engine.execute('inquiry.draft', { draft: buildDraftCandidate() }, { actor: 'ui' });
      clearStorageError(storageAlert);
      if (res.problems.length) {
        say('入力不足: ' + res.problems.join(', '));
        return;
      }
      location.hash = '#/contact/consent';
    } catch (err) {
      if (isStoragePersistError(err)) {
        const res = err.persistResult || err;
        if (res?.code === 'state-conflict' && res?.refreshed) syncUntouchedDraftFromLatest();
        showStorageError(res, storageAlert, { activeSection: 'draft' });
        return;
      }
      say(err?.message || 'save-failed');
    }
  });

  view.append(form);
}

// ---- View: contact.consent (Method A Direct Contact Primary Flow) ----
async function renderContactConsent() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('consent.heading')));

  const draft = state.draft ? structuredClone(state.draft) : null;
  const problems = validateInquiryDraft(draft);
  if (problems.length) {
    view.append(el('p', t('consent.noDraft'), 'banner warn'));
    return;
  }

  const { lawyer } = await engine.execute('lawyer.get', { lawyerId: draft.lawyerId }, { actor: 'ui' });
  const ev = lawyer.evaluatedVerification;
  const hardHold = ev.hardHold;
  const gate = canSendToLawyer(lawyer, { syntheticDemoMode: state.settings.syntheticDemoMode });
  const storageAlert = createStorageAlert();

  const card = el('section', null, 'card');
  const badges = el('div', null, 'chips');
  if (lawyer.synthetic) badges.append(el('span', t('badge.synthetic'), 'badge warn'));
  badges.append(verificationBadge(ev.effectiveStatus));

  card.append(
    el('h3', t('consent.recipient')),
    badges,
    el('p', `${lawyer.name}（${lawyer.bar_association} ／ 登録番号 ${lawyer.registration_number || '-'}）`),
  );

  if (hardHold) {
    card.append(el('p', ev.effectiveStatus === 'expired' ? getLegalNotices(locale).expiredHardHold : getLegalNotices(locale).revokedHardHold, 'banner danger'));
  }

  // Method A Direct Transition Links & Copy Controls (Primary Flow — ZERO server relay)
  const methodACard = el('section', null, 'card');
  methodACard.append(el('h3', t('consent.directTitle')));

  const directLinks = el('div', null, 'actions');
  if (!hardHold && lawyer.website_url) {
    const webA = el('a', `${t('consent.openWebsite')}: ${lawyer.website_url}`, 'ext-link');
    webA.href = lawyer.website_url;
    webA.target = '_blank';
    webA.rel = 'noopener noreferrer';
    directLinks.append(webA);
  }
  if (!hardHold && lawyer.email) {
    const mailA = el('a', `${t('consent.openMailto')}: ${lawyer.email}`, 'ext-link');
    mailA.href = `mailto:${encodeURIComponent(lawyer.email)}`;
    directLinks.append(mailA);
  }
  if (!hardHold && lawyer.phone) {
    const telA = el('a', `${t('consent.openTel')}: ${lawyer.phone}`, 'ext-link');
    telA.href = `tel:${lawyer.phone}`;
    directLinks.append(telA);
  }

  let contactText = t('profile.contactBlocked');
  if (!hardHold) {
    contactText = formatManualContactText(lawyer);
  }
  const draftText = formatDraftCopyText(draft, lawyer);

  const copyActions = el('div', null, 'actions');
  const copyContactBtn = el('button', t('consent.copyContact'));
  copyContactBtn.type = 'button';
  copyContactBtn.disabled = hardHold;
  copyContactBtn.addEventListener('click', async () => {
    try {
      const res = await engine.execute('contact.format_manual', { lawyerId: lawyer.id }, { actor: 'ui' });
      clearStorageError(storageAlert);
      await copyText(res.text, t('profile.contactCopied'));
    } catch (err) {
      if (isStoragePersistError(err)) {
        showStorageError(err.persistResult || err, storageAlert);
        return;
      }
      say(t('profile.contactBlocked'));
    }
  });

  const copyDraftBtn = el('button', t('consent.copyDraft'), 'tonal');
  copyDraftBtn.type = 'button';
  copyDraftBtn.addEventListener('click', async () => {
    await copyText(draftText, t('compose.draftCopied'));
  });

  copyActions.append(copyContactBtn, copyDraftBtn);
  methodACard.append(
    directLinks,
    copyActions,
    el('h4', t('consent.preview')),
    el('pre', contactText, 'code-box'),
    el('h4', t('consent.draftPreview')),
    el('pre', draftText, 'code-box'),
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

  const recordBtn = el('button', t('consent.recordLocal'), 'secondary');
  recordBtn.type = 'button';
  recordBtn.disabled = !gate.allowed;
  recordBtn.addEventListener('click', async () => {
    say('');
    try {
      await engine.execute('inquiry.send', { draft }, { actor: 'ui' });
      clearStorageError(storageAlert);
      say(t('consent.sentDryRun'));
      location.hash = '#/requests';
    } catch (err) {
      if (isStoragePersistError(err)) {
        showStorageError(err.persistResult || err, storageAlert, { activeSection: 'sentInquiries' });
        return;
      }
      say(t('consent.blocked', { code: err?.code || err?.message || 'blocked' }));
    }
  });

  actions.append(cancelBtn, recordBtn);
  view.append(card, methodACard, discCard, storageAlert, actions);
}

// ---- View: requests (Local records) ----
async function renderRequests() {
  const view = $('view');
  view.replaceChildren();
  const storageAlert = createStorageAlert();
  view.append(el('h2', t('requests.heading')));
  view.append(el('p', getLegalNotices(locale).lawyerCopyRetention, 'banner warn'));
  view.append(storageAlert);

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
      try {
        await engine.execute('inquiry.list', { deleteInquiryId: item.inquiryId }, { actor: 'ui' });
        clearStorageError(storageAlert);
        say(t('requests.deleted'));
        renderRequests();
      } catch (err) {
        if (isStoragePersistError(err)) {
          showStorageError(err.persistResult || err, storageAlert, { activeSection: 'sentInquiries' });
          return;
        }
        say(err?.message || 'delete-failed');
      }
    });

    const actions = el('div', null, 'actions');
    actions.append(delBtn);
    card.append(envDetails, actions);
    view.append(card);
  }
}

// ---- View: lawyer.onboarding (Participation policy + O4 preview + Art. 11 export) ----
function renderLawyerOnboarding() {
  const view = $('view');
  view.replaceChildren();
  view.append(
    el('h2', t('onboarding.heading')),
    el('p', t('onboarding.closedBanner'), 'banner warn'),
    participationPolicyCard(),
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
    fieldWrap('氏名（規程9条必須・架空入力のみ）', 'ob-name', fields.name),
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
  submitBtn.dataset.submit = '';

  const storageAlert = createStorageAlert();
  const art11Box = el('pre', '', 'code-box');
  art11Box.hidden = true;
  const art11Btn = el('button', t('onboarding.exportArt11'), 'secondary');
  art11Btn.type = 'button';
  art11Btn.addEventListener('click', async () => {
    try {
      const out = await engine.execute('lawyer.export_art11_record', {}, { actor: 'ui' });
      clearStorageError(storageAlert);
      art11Box.textContent = JSON.stringify(out.record, null, 2);
      art11Box.hidden = false;
      say(t('onboarding.art11Exported'));
    } catch (err) {
      if (isStoragePersistError(err)) {
        showStorageError(err.persistResult || err, storageAlert);
        return;
      }
      say(err?.message || 'export-failed');
    }
  });

  const actions = el('div', null, 'actions');
  actions.append(genBtn, submitBtn, art11Btn);
  form.append(keyInfo, storageAlert, actions, art11Box, nichibenrenLink());

  bindForm(form, async () => {
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
    if (!sessionLawyerKeyPair) {
      sessionLawyerKeyPair = await generateLawyerKeyPair();
      keyInfo.textContent = `鍵指紋: ${sessionLawyerKeyPair.keyFingerprint}`;
    }
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
      email: `sample-${submission.registration_number}@office.example.invalid`,
      website_url: `https://office-${submission.registration_number}.example.invalid/`,
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
    try {
      await engine.execute('lawyer.profile.update', { profile, action: 'onboarding_preview' }, { actor: 'ui' });
      clearStorageError(storageAlert);
      say(t('onboarding.submitted'));
      location.hash = '#/lawyer/profile';
    } catch (err) {
      if (isStoragePersistError(err)) {
        showStorageError(err.persistResult || err, storageAlert, { activeSection: 'lawyerProfile' });
        return;
      }
      say(t('profileEdit.rejected', { reasons: (err.problems || []).map(p => p.code).join(', ') || err?.message || 'error' }));
    }
  });

  view.append(form);
}

// ---- View: lawyer.profile.edit (Expanded O9 Validator + Art. 11 3-year export) ----
function renderLawyerProfileEdit() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('profileEdit.heading')), el('p', t('profileEdit.note'), 'banner'));

  const current = structuredClone(state.lawyerProfile || SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  const dirtyFields = new Set();
  const liveAlert = el('div', '', 'banner danger');
  liveAlert.hidden = true;
  const storageAlert = createStorageAlert();

  const form = el('section', null, 'card grid');
  const nameIn = Object.assign(el('input'), { value: current.name || '' });
  const barIn = Object.assign(el('input'), { value: current.bar_association || '' });
  const officeIn = Object.assign(el('input'), { value: current.office_name || '' });
  const areasIn = Object.assign(el('input'), { value: (current.practice_areas || []).join(', ') });
  const careerIn = Object.assign(el('textarea'), { value: (current.career_facts || []).join('\n') });
  const feeIn = Object.assign(el('input'), { value: current.initial_consultation_fee_note || '' });

  function syncUntouchedProfileFromLatest() {
    const latest = state.lawyerProfile;
    if (!latest || typeof latest !== 'object') return;
    if (!dirtyFields.has('name') && typeof latest.name === 'string') nameIn.value = latest.name;
    if (!dirtyFields.has('bar_association') && typeof latest.bar_association === 'string') barIn.value = latest.bar_association;
    if (!dirtyFields.has('office_name') && typeof latest.office_name === 'string') officeIn.value = latest.office_name;
    if (!dirtyFields.has('practice_areas') && Array.isArray(latest.practice_areas)) areasIn.value = latest.practice_areas.join(', ');
    if (!dirtyFields.has('career_facts') && Array.isArray(latest.career_facts)) careerIn.value = latest.career_facts.join('\n');
    if (!dirtyFields.has('initial_consultation_fee_note') && typeof latest.initial_consultation_fee_note === 'string') {
      feeIn.value = latest.initial_consultation_fee_note;
    }
    validateLive();
  }

  function buildCandidate() {
    const base = structuredClone(state.lawyerProfile || current);
    return {
      ...base,
      name: nameIn.value.trim(),
      bar_association: barIn.value.trim(),
      office_name: officeIn.value.trim(),
      practice_areas: areasIn.value.split(',').map(x => x.trim()).filter(Boolean),
      career_facts: careerIn.value.split('\n').map(x => x.trim()).filter(Boolean),
      initial_consultation_fee_note: feeIn.value.trim(),
    };
  }

  const saveBtn = el('button', t('profileEdit.save'));
  saveBtn.type = 'button';
  saveBtn.dataset.submit = '';

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

  for (const [fieldKey, ctrl] of [
    ['name', nameIn],
    ['bar_association', barIn],
    ['office_name', officeIn],
    ['practice_areas', areasIn],
    ['career_facts', careerIn],
    ['initial_consultation_fee_note', feeIn],
  ]) {
    ctrl.addEventListener('input', () => {
      dirtyFields.add(fieldKey);
      validateLive();
    });
  }

  const art11Box = el('pre', '', 'code-box');
  art11Box.hidden = true;
  const art11Btn = el('button', t('profileEdit.exportArt11'), 'tonal');
  art11Btn.type = 'button';
  art11Btn.addEventListener('click', async () => {
    try {
      const out = await engine.execute('lawyer.export_art11_record', { profile: buildCandidate() }, { actor: 'ui' });
      clearStorageError(storageAlert);
      art11Box.textContent = JSON.stringify(out.record, null, 2);
      art11Box.hidden = false;
      say(t('onboarding.art11Exported'));
    } catch (e) {
      if (isStoragePersistError(e)) {
        showStorageError(e.persistResult || e, storageAlert, { activeSection: 'lawyerProfile' });
        return;
      }
      say(t('profileEdit.rejected', { reasons: (e.problems || []).map(p => p.code).join(', ') }));
    }
  });

  const actions = el('div', null, 'actions');
  actions.append(saveBtn, art11Btn);

  form.append(
    liveAlert,
    fieldWrap('氏名（必須）', 'pe-name', nameIn),
    fieldWrap('所属弁護士会（必須）', 'pe-bar', barIn),
    fieldWrap('法律事務所名', 'pe-office', officeIn),
    fieldWrap('取扱分野（カンマ区切り・事実項目のみ）', 'pe-areas', areasIn),
    fieldWrap('経歴（事実のみ・1行1件）', 'pe-career', careerIn),
    fieldWrap('初回相談条件（事実のみ）', 'pe-fee', feeIn),
    storageAlert,
    actions,
    art11Box,
  );

  bindForm(form, async () => {
    try {
      await engine.execute('lawyer.profile.update', { profile: buildCandidate() }, { actor: 'ui' });
      clearStorageError(storageAlert);
      say(t('profileEdit.saved'));
    } catch (e) {
      if (isStoragePersistError(e)) {
        const res = e.persistResult || e;
        if (res?.code === 'state-conflict' && res?.refreshed) syncUntouchedProfileFromLatest();
        showStorageError(res, storageAlert, { activeSection: 'lawyerProfile' });
        return;
      }
      say(t('profileEdit.rejected', { reasons: (e.problems || []).map(p => p.code).join(', ') }));
    }
  });

  view.append(form);
  validateLive();
}

// ---- View: lawyer.inbox (Strictly Local Preview / Offline Import — NO server relay) ----
async function renderLawyerInbox() {
  const view = $('view');
  view.replaceChildren();
  const storageAlert = createStorageAlert();
  view.append(el('h2', t('inbox.heading')), el('p', t('inbox.note'), 'banner'), storageAlert);

  const seedBtn = el('button', t('inbox.seedQa'), 'tonal');
  seedBtn.type = 'button';
  seedBtn.addEventListener('click', async () => {
    const nextKeyPair = await generateLawyerKeyPair();
    const nextRecords = await buildSyntheticQaIntakeRecords(
      state.lawyerProfile?.id || SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id,
      nextKeyPair.publicKeyJwk,
    );
    const res = await mutateAndPersist(s => { s.intakeRecords = nextRecords; });
    if (!res.ok) {
      showStorageError(res, storageAlert, { activeSection: 'intakeRecords' });
      return;
    }
    sessionLawyerKeyPair = nextKeyPair;
    revealedBodies.clear();
    clearStorageError(storageAlert);
    say(t('inbox.seeded'));
    renderLawyerInbox();
  });
  const topActions = el('div', null, 'actions');
  topActions.append(seedBtn);
  view.append(topActions);

  // Offline E2EE envelope JSON import (zero server relay)
  const offlineImport = el('details', null, 'panel');
  const importAlert = createStorageAlert();
  offlineImport.append(el('summary', t('inbox.importEnvelopeTitle')));
  const envArea = el('textarea');
  envArea.placeholder = '{"schema":"bengoshi.e2ee.envelope.v1","conflictHeader":{...},...}';
  const envBtn = el('button', t('inbox.importEnvelopeBtn'), 'secondary');
  envBtn.type = 'button';
  envBtn.dataset.submit = '';
  const envActions = el('div', null, 'actions');
  envActions.append(envBtn);
  offlineImport.append(importAlert, envArea, envActions);
  bindForm(offlineImport, async () => {
    try {
      const parsed = JSON.parse(envArea.value);
      if (parsed?.schema !== 'bengoshi.e2ee.envelope.v1' || !parsed.conflictHeader) {
        throw new Error('invalid-e2ee-envelope');
      }
      const entry = {
        inquiryId: parsed.conflictHeader.inquiryId || 'inq-offline-' + Date.now(),
        receivedAt: parsed.conflictHeader.receivedAt || new Date().toISOString(),
        conflictHeader: parsed.conflictHeader,
        envelope: parsed,
        conflictCheck: null,
        decision: null,
        replySentAt: null,
      };
      const res = await mutateAndPersist(s => { s.intakeRecords.unshift(entry); });
      if (!res.ok) {
        showStorageError(res, importAlert, { activeSection: 'intakeRecords' });
        return;
      }
      clearStorageError(importAlert);
      say(t('inbox.importEnvelopeOk'));
      renderLawyerInbox();
    } catch (e) {
      say(t('inbox.importEnvelopeFail', { code: e?.message || 'invalid' }));
    }
  });
  view.append(offlineImport);

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
      const actions = el('div', null, 'actions');
      actions.append(openBtn);
      card.append(actions);
      view.append(card);
    }
  }

  // Local conflict ledger management (uses bindForm + data-submit)
  const ledgerCard = el('section', null, 'card');
  const ledgerAlert = createStorageAlert();
  ledgerCard.append(el('h3', t('inbox.ledgerTitle')));
  const ul = el('ul');
  for (const row of state.conflictLedger) {
    ul.append(el('li', `${row.partyName}（${row.role} / ${row.matterRef}）`));
  }
  const addIn = el('input');
  addIn.placeholder = '追加する依頼者・相手方名（例: ○○株式会社）';
  const addBtn = el('button', t('inbox.ledgerAdd'), 'secondary');
  addBtn.type = 'button';
  addBtn.dataset.submit = '';
  const ledgerActions = el('div', null, 'actions');
  ledgerActions.append(addBtn);
  ledgerCard.append(ul, ledgerAlert, addIn, ledgerActions);
  bindForm(ledgerCard, async () => {
    const partyName = addIn.value.trim();
    if (!partyName) return;
    const entry = {
      id: 'ledger-' + Date.now(),
      partyName,
      role: 'existing_client',
      matterRef: 'ローカル追加',
    };
    const res = await mutateAndPersist(s => { s.conflictLedger.push(entry); });
    if (!res.ok) {
      showStorageError(res, ledgerAlert, { activeSection: 'conflictLedger' });
      return;
    }
    clearStorageError(ledgerAlert);
    renderLawyerInbox();
  });
  view.append(ledgerCard);
}

// ---- View: lawyer.inquiry.detail (AWAI-3235 HARD conflict-check gate — local only) ----
async function renderLawyerInquiryDetail(inquiryId) {
  const view = $('view');
  view.replaceChildren();
  const storageAlert = createStorageAlert();
  view.append(el('h2', t('inquiryDetail.heading')), el('p', getLegalNotices(locale).conflictHardGate, 'banner'), storageAlert);

  const currentRec = () => state.intakeRecords.find(r => r.inquiryId === inquiryId);
  const rec = currentRec();
  if (!rec) {
    view.append(el('p', t('inbox.empty'), 'card'));
    return;
  }
  selectedInquiryId = rec.inquiryId;
  const gate = canRevealInquiryBody(rec);

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
    try {
      await engine.execute('intake.conflict_check', { inquiryId: rec.inquiryId, confirmClear: false }, { actor: 'ui' });
      clearStorageError(storageAlert);
      renderLawyerInquiryDetail(rec.inquiryId);
    } catch (err) {
      if (isStoragePersistError(err)) {
        showStorageError(err.persistResult || err, storageAlert);
        return;
      }
      say(err?.code || err?.message || 'conflict-check-failed');
    }
  });
  const checkActions = el('div', null, 'actions');
  checkActions.append(checkBtn);
  hCard.append(checkActions);
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
        try {
          await engine.execute('intake.decide', { inquiryId: rec.inquiryId, action: 'decline_conflict' }, { actor: 'ui' });
          clearStorageError(storageAlert);
          say('利益相反による辞退を記録しました（本文は復号されていません）。');
          renderLawyerInquiryDetail(rec.inquiryId);
        } catch (err) {
          if (isStoragePersistError(err)) {
            showStorageError(err.persistResult || err, storageAlert);
            return;
          }
          say(err?.code || err?.message || 'blocked');
        }
      });
      const decActions = el('div', null, 'actions');
      decActions.append(decBtn);
      resCard.append(decActions);
    } else {
      resCard.append(
        el('p', 'ローカル台帳照合結果: 利益相反なし（一致0件）', 'banner ok'),
        el('p', `確認ダイジェスト: ${cc.receiptDigest}`, 'mono muted'),
      );
      const confirmBox = el('input');
      confirmBox.type = 'checkbox';
      confirmBox.checked = Boolean(cc.confirmedByLawyer);
      confirmBox.addEventListener('change', async () => {
        try {
          await engine.execute('intake.conflict_check', { inquiryId: rec.inquiryId, confirmClear: confirmBox.checked }, { actor: 'ui' });
          clearStorageError(storageAlert);
          renderLawyerInquiryDetail(rec.inquiryId);
        } catch (err) {
          confirmBox.checked = Boolean(currentRec()?.conflictCheck?.confirmedByLawyer);
          if (isStoragePersistError(err)) {
            showStorageError(err.persistResult || err, storageAlert, { activeSection: 'intakeRecords' });
            return;
          }
          say(err?.code || err?.message || 'conflict-confirm-failed');
        }
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
          clearStorageError(storageAlert);
          revealedBodies.set(rec.inquiryId, out.plaintext);
          renderLawyerInquiryDetail(rec.inquiryId);
        } catch (err) {
          if (isStoragePersistError(err)) {
            showStorageError(err.persistResult || err, storageAlert);
            return;
          }
          say(err?.code || err?.message || 'reveal-blocked');
        }
      });
      const revActions = el('div', null, 'actions');
      revActions.append(revealBtn);
      resCard.append(revActions);
    }
    view.append(resCard);
  }

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
    acceptBtn.addEventListener('click', async () => {
      try {
        await engine.execute('intake.decide', { inquiryId: rec.inquiryId, action: 'accept', replyText: replyArea.value || '初回面談の日程候補（ローカル記録）' }, { actor: 'ui' });
        clearStorageError(storageAlert);
        say('受任検討・面談案内をローカル記録しました（外部通信 0 バイト）。');
        renderLawyerInquiryDetail(rec.inquiryId);
      } catch (err) {
        if (isStoragePersistError(err)) {
          showStorageError(err.persistResult || err, storageAlert);
          return;
        }
        say(err?.message || 'blocked');
      }
    });
    const declineBtn = el('button', t('inquiryDetail.declineBtn'), 'secondary');
    declineBtn.type = 'button';
    declineBtn.addEventListener('click', async () => {
      try {
        await engine.execute('intake.decide', { inquiryId: rec.inquiryId, action: 'decline', replyText: replyArea.value || '辞退（ローカル記録）' }, { actor: 'ui' });
        clearStorageError(storageAlert);
        say('辞退をローカル記録しました（外部通信 0 バイト）。');
        renderLawyerInquiryDetail(rec.inquiryId);
      } catch (err) {
        if (isStoragePersistError(err)) {
          showStorageError(err.persistResult || err, storageAlert);
          return;
        }
        say(err?.message || 'blocked');
      }
    });
    const replyActions = el('div', null, 'actions');
    replyActions.append(acceptBtn, declineBtn);
    bodyCard.append(replyArea, replyActions, el('p', t('inquiryDetail.noForward'), 'muted'));
    view.append(bodyCard);
  }
}

// ---- View: audit ----
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

// ---- View: embed.mcp (POC / Draft — SEP-1865 APP-01..APP-04) ----
function renderEmbedMcp() {
  const view = $('view');
  view.replaceChildren();
  view.append(el('h2', t('embed.heading')), el('p', t('embed.note'), 'banner'));

  const origin = location.origin && location.origin !== 'null' ? location.origin : 'https://bengoshi.itonami.app';
  const sessionToken = 'sep1865-local-qa-session';
  const bridge = createMcpEmbedBridge({ allowedOrigin: origin, expectedSessionToken: sessionToken });
  const logBox = el('pre', 'Ready (POC/Draft). Phase: ' + bridge.getPhase(), 'code-box');

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
    logReply('Read-only directory.search (APP-01 non-UI fallback + APP-03/04):', out);
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
  clearStorageError();
  // Soudan -> Bengoshi URL query parameter firewall
  const sanitized = sanitizeEntryLocation(location.search, location.hash);
  if (sanitized.rejected) {
    firewallRejectedParams = [...sanitized.rejectedParams];
    say(t('guide.firewallNotice', { params: firewallRejectedParams.join(', ') }));
    if (location.hash !== sanitized.cleanHash) {
      history.replaceState(null, '', location.pathname + sanitized.cleanHash);
    }
  }
  const hash = sanitized.cleanHash || '#/guide';

  if (hash.startsWith('#/lawyer/')) activeMode = 'lawyer';
  else if (hash === '#/audit' || hash === '#/embed/mcp') activeMode = 'shared';
  else activeMode = 'user';

  renderChrome();

  if (hash === '#/search') {
    await renderSearch();
  } else if (hash.startsWith('#/profile/')) {
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
    renderPublicGuide();
  }
}

export async function start() {
  const integrity = verifySyntheticCatalogIntegrity();
  if (!integrity.ok) throw new Error('synthetic-catalog-integrity-failed');
  try { await host.initialize(); } catch { /* web runtime */ }
  await loadState();
  buildEngine();

  $('lang-toggle').addEventListener('click', async () => {
    const nextLocale = locale === 'ja' ? 'en' : 'ja';
    const res = await mutateAndPersist(s => { s.settings.locale = nextLocale; });
    if (!res.ok) {
      showStorageError(res, null, { activeSection: 'settings' });
      return;
    }
    locale = nextLocale;
    t = translator(locale);
    clearStorageError();
    route();
  });

  window.addEventListener('hashchange', route);
  await route();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !globalThis.__BENGOSHI_DISABLE_AUTOSTART__) {
  start();
}
