// Shared PR #29 semantic view & operation store for Soudan (human UI + MCP Apps / Agent Plugins).
// Single noun.verb operation contract:
// - soudan.draft.create
// - soudan.draft.select
// - soudan.draft.update
// - soudan.draft.delete       (irreversible: dry-run + explicit confirmation + audit)
// - soudan.evidence.add
// - soudan.evidence.remove
// - soudan.memo.assemble
// - soudan.memo.send          (X1, irreversible: dry-run + canonical each-operation consent + audit)
// - soudan.inference.organize (murakumo.cloud slot: pre-flight guard + canonical consent + fail-closed fallback + audit)
// - soudan.audit.list
// Machine-readable UI states (MCP Apps / semantic product UI):
//   'idle' | 'proposal.ready' | 'governor.blocked' | 'consent.required' | 'audit.recorded'

import {
  LIMITS, activeDraftRecord, addressedMemo, assembleMemo, buildMemoExportV1, createDraftRecord,
  draftDisplayTitle, draftProblems, emptyDraft, formatMemoMarkdown, newEvidence,
  recipientProblems, restoreAppState, restoreDraft,
} from './model.js';
import {
  DEFAULT_INFERENCE_CONFIG, INFERENCE_LIMITS, MURAKUMO_ENDPOINT_URL, buildInferenceHeaders,
  buildInferenceRequestBody, buildProposalFromCompletion, evaluateGovernorGuard,
  isCapacityOrRateLimitError, organizeLocally, validateInferenceConfig,
} from './inference.js';
import {INFERENCE_SELECTOR, SEND_SELECTOR} from './operations.js';
import {translator} from './messages.js';

export const SEMANTIC_STATES = Object.freeze([
  'idle',
  'proposal.ready',
  'governor.blocked',
  'consent.required',
  'audit.recorded',
]);

export const SEMANTIC_OPERATIONS = Object.freeze([
  'soudan.draft.create',
  'soudan.draft.select',
  'soudan.draft.update',
  'soudan.draft.delete',
  'soudan.evidence.add',
  'soudan.evidence.remove',
  'soudan.memo.assemble',
  'soudan.memo.send',
  'soudan.inference.organize',
  'soudan.audit.list',
]);

function normalizeActor(actor) {
  const kind = actor?.kind === 'agent' ? 'agent' : 'human';
  return {kind};
}

export function createSemanticStore({
  initialState = null,
  locale = 'ja',
  broker = null,
  inferenceConfig = DEFAULT_INFERENCE_CONFIG,
  authHeaderProvider = null,
  route = 'web-device-save',
  sandboxedIframe = false,
  now = () => new Date().toISOString(),
  onPersist = null,
} = {}) {
  const t = translator(locale);
  let state = restoreAppState(initialState, now());
  let uiState = 'idle';
  let lastProposal = null;
  let lastGuard = null;
  let seq = state.audit.length;
  let inferenceInFlight = 0;
  let dailyBucket = {day: '', count: 0};

  function todayKey() {
    return String(now()).slice(0, 10);
  }

  function recordAudit({op, actor, outcome, targetKind, gateName = null}) {
    seq += 1;
    // O8 minimization: NEVER store consultation text, names, contacts, URLs, or PII.
    const entry = {
      id: `aud-${seq}`,
      timestamp: now(),
      op,
      actor: normalizeActor(actor),
      outcome,
      targetKind,
      ...(gateName ? {gateName} : {}),
    };
    state.audit = [...state.audit, entry].slice(-LIMITS.audit);
    return entry;
  }

  async function persist() {
    if (typeof onPersist === 'function') await onPersist(state);
  }

  function nextDraftId() {
    const used = new Set(state.drafts.map(d => d.id));
    let n = state.drafts.length + 1;
    while (used.has(`draft-${n}`)) n += 1;
    return `draft-${n}`;
  }

  async function execute(op, params = {}, {actor = {kind: 'human'}} = {}) {
    if (!SEMANTIC_OPERATIONS.includes(op)) {
      throw Object.assign(Error(`unknown-operation:${op}`), {code: 'unknown-operation'});
    }
    const normActor = normalizeActor(actor);

    if (op === 'soudan.audit.list') {
      const limit = Number.isSafeInteger(params?.limit) && params.limit > 0 ? Math.min(params.limit, LIMITS.audit) : LIMITS.audit;
      return {
        ok: true,
        state: uiState,
        entries: state.audit.slice(-limit),
        disclaimer: t('disclaimer.fixed'),
      };
    }

    if (op === 'soudan.draft.create') {
      if (state.drafts.length >= LIMITS.drafts) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'draft', gateName: 'draft-limit'});
        return {ok: false, state: 'governor.blocked', gateName: 'draft-limit', disclaimer: t('disclaimer.fixed')};
      }
      const id = nextDraftId();
      const rec = createDraftRecord({id, title: typeof params?.title === 'string' ? params.title : '', draft: params?.draft ?? emptyDraft(), now: now()});
      state.drafts.push(rec);
      state.activeDraftId = rec.id;
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'draft'});
      uiState = 'audit.recorded';
      await persist();
      return {ok: true, state: uiState, activeDraftId: rec.id, draftCount: state.drafts.length, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.draft.select') {
      const target = state.drafts.find(d => d.id === params?.id);
      if (!target) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'draft'});
        return {ok: false, state: uiState, error: 'draft-not-found', disclaimer: t('disclaimer.fixed')};
      }
      state.activeDraftId = target.id;
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'draft'});
      uiState = 'audit.recorded';
      await persist();
      return {ok: true, state: uiState, activeDraftId: target.id, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.draft.update') {
      const target = params?.id ? state.drafts.find(d => d.id === params.id) : activeDraftRecord(state);
      if (!target) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'draft'});
        return {ok: false, state: uiState, error: 'draft-not-found', disclaimer: t('disclaimer.fixed')};
      }
      const patch = params?.patch && typeof params.patch === 'object' ? params.patch : {};
      const merged = restoreDraft({...target.draft, ...patch, recipient: patch.recipient ? {...target.draft.recipient, ...patch.recipient} : target.draft.recipient});
      target.draft = merged;
      if (typeof params?.title === 'string') target.title = [...params.title].slice(0, LIMITS.draftTitle).join('');
      target.updatedAt = now();
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'draft'});
      uiState = 'audit.recorded';
      await persist();
      return {ok: true, state: uiState, id: target.id, problems: draftProblems(target.draft), disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.draft.delete') {
      const targetId = params?.id ?? state.activeDraftId;
      const idx = state.drafts.findIndex(d => d.id === targetId);
      if (idx < 0) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'draft'});
        return {ok: false, state: uiState, error: 'draft-not-found', disclaimer: t('disclaimer.fixed')};
      }
      const target = state.drafts[idx];
      const preview = {
        dryRun: true,
        reversible: false,
        targetId: target.id,
        draftTitle: draftDisplayTitle(target, idx, t),
        evidenceCount: target.draft.evidence.length,
        confirmationRequired: true,
      };
      if (params?.dryRun === true || params?.confirmed !== true) {
        recordAudit({op, actor: normActor, outcome: 'dry-run', targetKind: 'draft'});
        uiState = 'consent.required';
        return {ok: true, state: uiState, preview, disclaimer: t('disclaimer.fixed')};
      }
      state.drafts.splice(idx, 1);
      if (state.drafts.length === 0) {
        const fresh = createDraftRecord({id: 'draft-1', now: now()});
        state.drafts.push(fresh);
      }
      if (state.activeDraftId === targetId) state.activeDraftId = state.drafts[0].id;
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'draft'});
      uiState = 'audit.recorded';
      await persist();
      return {ok: true, state: uiState, deletedId: targetId, activeDraftId: state.activeDraftId, draftCount: state.drafts.length, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.evidence.add') {
      const rec = activeDraftRecord(state);
      if (!rec) return {ok: false, state: uiState, error: 'draft-not-found', disclaimer: t('disclaimer.fixed')};
      if (rec.draft.evidence.length >= LIMITS.evidence) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'evidence', gateName: 'evidence-limit'});
        return {ok: false, state: 'governor.blocked', gateName: 'evidence-limit', disclaimer: t('disclaimer.fixed')};
      }
      const raw = params?.row && typeof params.row === 'object' ? params.row : {};
      // Never persist raw image bytes or data:image URLs.
      const serialized = JSON.stringify(raw);
      if (/data:image\//i.test(serialized) || raw.bytes || raw.imageBytes) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'evidence', gateName: 'image-bytes-forbidden'});
        uiState = 'governor.blocked';
        return {ok: false, state: uiState, gateName: 'image-bytes-forbidden', disclaimer: t('disclaimer.fixed')};
      }
      const row = {
        ...newEvidence(),
        url: typeof raw.url === 'string' ? raw.url : '',
        postedAt: typeof raw.postedAt === 'string' ? raw.postedAt : '',
        authorName: typeof raw.authorName === 'string' ? raw.authorName : '',
        authorId: typeof raw.authorId === 'string' ? raw.authorId : '',
        shotName: typeof raw.shotName === 'string' ? raw.shotName : '',
        shotSize: Number.isSafeInteger(raw.shotSize) && raw.shotSize >= 0 ? raw.shotSize : 0,
        sha256: typeof raw.sha256 === 'string' ? raw.sha256 : '',
        capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : '',
      };
      rec.draft.evidence.push(row);
      rec.updatedAt = now();
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'evidence'});
      uiState = 'audit.recorded';
      await persist();
      return {ok: true, state: uiState, index: rec.draft.evidence.length - 1, evidenceCount: rec.draft.evidence.length, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.evidence.remove') {
      const rec = activeDraftRecord(state);
      const index = params?.index;
      if (!rec || !Number.isSafeInteger(index) || index < 0 || index >= rec.draft.evidence.length) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'evidence'});
        return {ok: false, state: uiState, error: 'evidence-not-found', disclaimer: t('disclaimer.fixed')};
      }
      rec.draft.evidence.splice(index, 1);
      rec.updatedAt = now();
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'evidence'});
      uiState = 'audit.recorded';
      await persist();
      return {ok: true, state: uiState, evidenceCount: rec.draft.evidence.length, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.memo.assemble') {
      const rec = activeDraftRecord(state);
      const problems = draftProblems(rec?.draft);
      if (problems.length) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'memo'});
        return {ok: false, state: uiState, problems, disclaimer: t('disclaimer.fixed')};
      }
      const memo = assembleMemo(rec.draft, t);
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'memo'});
      uiState = 'audit.recorded';
      await persist();
      return {ok: true, state: uiState, memo, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.memo.send') {
      if (sandboxedIframe) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'memo', gateName: 'iframe-no-direct-external-egress'});
        uiState = 'governor.blocked';
        lastGuard = {blocked: true, state: uiState, gateName: 'iframe-no-direct-external-egress'};
        return {ok: false, state: uiState, gateName: 'iframe-no-direct-external-egress', disclaimer: t('disclaimer.fixed')};
      }
      const rec = activeDraftRecord(state);
      const dProblems = draftProblems(rec?.draft);
      const rProblems = recipientProblems(rec?.draft?.recipient);
      if (dProblems.length || rProblems.length) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'memo'});
        return {ok: false, state: uiState, problems: [...dProblems, ...rProblems], disclaimer: t('disclaimer.fixed')};
      }
      const memo = assembleMemo(rec.draft, t);
      const to = {
        name: rec.draft.recipient.name.trim(),
        office: (rec.draft.recipient.office ?? '').trim(),
        contact: rec.draft.recipient.contact.trim(),
      };
      const addressed = addressedMemo(memo.text, to, t);
      const mode = params?.mode ?? (route === 'android-share-sheet' ? 'android-share' : 'save-txt');
      const preview = {
        dryRun: true,
        reversible: false,
        route,
        mode,
        recipientFilled: true,
        charCount: addressed.length,
        imageBytesIncluded: false,
        consentRequired: true,
      };
      if (params?.dryRun === true) {
        recordAudit({op, actor: normActor, outcome: 'dry-run', targetKind: 'memo'});
        uiState = 'consent.required';
        return {ok: true, state: uiState, preview, disclaimer: t('disclaimer.fixed')};
      }
      if (!broker) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'memo', gateName: 'broker-unavailable'});
        uiState = 'governor.blocked';
        return {ok: false, state: uiState, gateName: 'broker-unavailable', disclaimer: t('disclaimer.fixed')};
      }
      uiState = 'consent.required';
      const payload = {
        memo: addressed,
        recipient: to,
        ...(mode !== 'android-share' ? {
          mode,
          title: memo.title,
          markdown: formatMemoMarkdown(memo, to, t),
          exportJson: JSON.stringify(buildMemoExportV1(memo, to, rec.draft, t, now()), null, 2),
        } : {}),
      };
      try {
        const result = await broker.invoke(SEND_SELECTOR, payload);
        recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'memo'});
        uiState = 'audit.recorded';
        await persist();
        return {ok: true, state: uiState, result, disclaimer: t('disclaimer.fixed')};
      } catch (err) {
        const denied = /not approved/i.test(err?.message ?? '');
        recordAudit({op, actor: normActor, outcome: denied ? 'denied' : 'blocked', targetKind: 'memo', gateName: denied ? 'user-consent-denied' : 'broker-refused'});
        uiState = denied ? 'idle' : 'governor.blocked';
        await persist();
        return {ok: false, state: uiState, error: err?.message ?? 'send-blocked', disclaimer: t('disclaimer.fixed')};
      }
    }

    if (op === 'soudan.inference.organize') {
      if (sandboxedIframe) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: 'iframe-no-direct-external-egress'});
        uiState = 'governor.blocked';
        lastGuard = {blocked: true, state: uiState, gateName: 'iframe-no-direct-external-egress'};
        return {ok: false, state: uiState, gateName: 'iframe-no-direct-external-egress', disclaimer: t('disclaimer.fixed')};
      }
      const rec = activeDraftRecord(state);
      const userPrompt = typeof params?.prompt === 'string' && params.prompt.trim()
        ? params.prompt
        : [rec?.draft?.summary ?? '', rec?.draft?.wish ?? '', ...(rec?.draft?.timeline ?? []).map(e => e.event)].join('\n');
      const guard = evaluateGovernorGuard(userPrompt, t);
      if (guard.blocked) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: guard.gateName});
        uiState = 'governor.blocked';
        lastGuard = guard;
        await persist();
        return {ok: false, state: uiState, gateName: guard.gateName, routes: guard.routes, disclaimer: t('disclaimer.fixed')};
      }
      const cfg = params?.config ?? inferenceConfig;
      const cfgCheck = validateInferenceConfig(cfg);
      if (!cfgCheck.ok) {
        if (['murakumo-free-forbidden', 'forbidden-model', 'forbidden-endpoint', 'endpoint-not-allowed', 'model-not-inhouse-allowlisted', 'max-tokens-out-of-bounds'].includes(cfgCheck.reason)) {
          recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: cfgCheck.reason});
          uiState = 'governor.blocked';
          lastGuard = {blocked: true, state: uiState, gateName: cfgCheck.reason};
          await persist();
          return {ok: false, state: uiState, gateName: cfgCheck.reason, disclaimer: t('disclaimer.fixed')};
        }
        // Fail-closed disabled/unconfigured -> graceful 100% local offline fallback.
        const local = organizeLocally(rec?.draft ?? emptyDraft(), t);
        lastProposal = local;
        uiState = 'proposal.ready';
        recordAudit({op, actor: normActor, outcome: 'fallback', targetKind: 'inference', gateName: cfgCheck.reason});
        await persist();
        return {ok: true, state: uiState, fallback: 'local', reason: cfgCheck.reason, proposal: local, disclaimer: t('disclaimer.fixed')};
      }
      if (params?.localOnly === true || !broker) {
        const local = organizeLocally(rec?.draft ?? emptyDraft(), t);
        lastProposal = local;
        uiState = 'proposal.ready';
        recordAudit({op, actor: normActor, outcome: 'fallback', targetKind: 'inference', gateName: 'local-only-selected'});
        await persist();
        return {ok: true, state: uiState, fallback: 'local', proposal: local, disclaimer: t('disclaimer.fixed')};
      }
      // Concurrency guard: max 1 in-flight request per tab.
      if (inferenceInFlight >= INFERENCE_LIMITS.maxConcurrencyPerTab) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: 'concurrency-limit-exceeded'});
        uiState = 'governor.blocked';
        return {ok: false, state: uiState, gateName: 'concurrency-limit-exceeded', disclaimer: t('disclaimer.fixed')};
      }
      // Soft daily client limit: 20 turns/day -> graceful local fallback.
      const day = todayKey();
      if (dailyBucket.day !== day) dailyBucket = {day, count: 0};
      if (dailyBucket.count >= INFERENCE_LIMITS.softDailyTurns) {
        const local = organizeLocally(rec?.draft ?? emptyDraft(), t);
        lastProposal = local;
        uiState = 'proposal.ready';
        recordAudit({op, actor: normActor, outcome: 'fallback', targetKind: 'inference', gateName: 'daily-limit-reached'});
        await persist();
        return {ok: true, state: uiState, fallback: 'local', reason: 'daily-limit-reached', proposal: local, disclaimer: t('disclaimer.fixed')};
      }

      uiState = 'consent.required';
      const extraHeaders = typeof authHeaderProvider === 'function' ? await authHeaderProvider() : null;
      const headers = buildInferenceHeaders({extraHeaders});
      const bodyObj = buildInferenceRequestBody({
        draft: rec?.draft ?? emptyDraft(),
        model: cfg.model,
        maxTokens: cfg.maxTokens ?? INFERENCE_LIMITS.defaultMaxTokens,
        history: params?.history ?? [],
        locale,
      });
      inferenceInFlight += 1;
      try {
        const resp = await broker.invoke(INFERENCE_SELECTOR, {
          input: MURAKUMO_ENDPOINT_URL,
          init: {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyObj),
          },
        });
        const status = typeof resp?.status === 'number' ? resp.status : 200;
        const rawBody = typeof resp?.text === 'function' ? await resp.text() : resp;
        if (isCapacityOrRateLimitError(status, typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? ''))) {
          const local = organizeLocally(rec?.draft ?? emptyDraft(), t);
          lastProposal = local;
          uiState = 'proposal.ready';
          recordAudit({op, actor: normActor, outcome: 'fallback', targetKind: 'inference', gateName: `capacity-or-rate-limit-${status}`});
          await persist();
          return {ok: true, state: uiState, fallback: 'local', reason: 'capacity-or-rate-limit', status, proposal: local, disclaimer: t('disclaimer.fixed')};
        }
        const proposal = buildProposalFromCompletion(rawBody, t);
        if (proposal.blocked) {
          recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: proposal.gateName});
          uiState = 'governor.blocked';
          lastGuard = proposal;
          await persist();
          return {ok: false, state: uiState, gateName: proposal.gateName, routes: proposal.routes, disclaimer: t('disclaimer.fixed')};
        }
        dailyBucket.count += 1;
        lastProposal = proposal;
        uiState = 'proposal.ready';
        recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'inference'});
        await persist();
        return {ok: true, state: uiState, proposal, disclaimer: t('disclaimer.fixed')};
      } catch (err) {
        const denied = /not approved/i.test(err?.message ?? '');
        const local = organizeLocally(rec?.draft ?? emptyDraft(), t);
        lastProposal = local;
        uiState = 'proposal.ready';
        recordAudit({op, actor: normActor, outcome: denied ? 'denied' : 'fallback', targetKind: 'inference', gateName: denied ? 'user-consent-denied' : 'inference-unavailable'});
        await persist();
        return {ok: true, state: uiState, fallback: 'local', reason: denied ? 'consent-denied' : 'inference-unavailable', proposal: local, disclaimer: t('disclaimer.fixed')};
      } finally {
        inferenceInFlight -= 1;
      }
    }

    return {ok: false, state: uiState, error: 'unhandled-operation', disclaimer: t('disclaimer.fixed')};
  }

  return Object.freeze({
    getState: () => state,
    setState: next => { state = restoreAppState(next, now()); },
    getActiveDraft: () => activeDraftRecord(state),
    getUiState: () => uiState,
    setUiState: next => { if (SEMANTIC_STATES.includes(next)) uiState = next; },
    getLastProposal: () => lastProposal,
    clearProposal: () => { lastProposal = null; uiState = 'idle'; },
    getLastGuard: () => lastGuard,
    execute,
  });
}
