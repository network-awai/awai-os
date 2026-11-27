// Shared PR #29 semantic view & operation store for Soudan (human UI + MCP Apps / Agent Plugins).
// Single noun.verb operation contract:
// - soudan.draft.create
// - soudan.draft.select
// - soudan.draft.update
// - soudan.draft.delete       (irreversible: agent/MCP can ONLY request human approval; only human may finalize)
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

// Merged app-itonami-gamen-sekkei#31 (1faaabc6) §3.2:
// Remote inference (`soudan.inference.organize`) is active ONLY on allowed non-Android surfaces
// ('web' | 'awai-pc') when explicitly opt-in enabled with valid in-house `mishima` config.
export const ALLOWED_INFERENCE_SURFACES = Object.freeze(['web', 'awai-pc']);
export const DISABLED_REASON_ANDROID_OR_LOCAL_ONLY = 'android-no-internet-or-local-only';

export function resolveSurface({surface = null, route = 'web-device-save'} = {}) {
  if (typeof surface === 'string' && surface.trim()) return surface.trim();
  return route === 'android-share-sheet' ? 'android' : 'web';
}

export function computeSemanticOps({
  surface = 'web',
  inferenceConfig = DEFAULT_INFERENCE_CONFIG,
  sandboxedIframe = false,
} = {}) {
  const cfgCheck = validateInferenceConfig(inferenceConfig);
  const allowedSurface = ALLOWED_INFERENCE_SURFACES.includes(surface);
  const inferenceRemoteEnabled = !sandboxedIframe && allowedSurface && cfgCheck.ok;
  const activeOps = [];
  const disabledOps = [];
  for (const op of SEMANTIC_OPERATIONS) {
    if (op === 'soudan.memo.send' && sandboxedIframe) {
      disabledOps.push({op, disabledReason: 'iframe-no-direct-external-egress'});
      continue;
    }
    if (op === 'soudan.inference.organize' && !inferenceRemoteEnabled) {
      disabledOps.push({
        op,
        disabledReason: (!allowedSurface || !cfgCheck.ok)
          ? DISABLED_REASON_ANDROID_OR_LOCAL_ONLY
          : 'iframe-no-direct-external-egress',
      });
      continue;
    }
    activeOps.push(op);
  }
  return {
    surface,
    inferenceMode: inferenceRemoteEnabled ? 'opt-in-route-b' : 'local-only',
    inferenceEnabled: inferenceRemoteEnabled,
    activeOps,
    disabledOps,
  };
}

function normalizeActor(actor) {
  const kind = actor?.kind === 'agent' ? 'agent' : 'human';
  return {kind};
}

function cloneState(s) {
  return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));
}

export function createSemanticStore({
  initialState = null,
  locale = 'ja',
  broker = null,
  inferenceConfig = DEFAULT_INFERENCE_CONFIG,
  authHeaderProvider = null,
  route = 'web-device-save',
  surface = null,
  sandboxedIframe = false,
  now = () => new Date().toISOString(),
  onPersist = null,
} = {}) {
  const t = translator(locale);
  const resolvedSurface = resolveSurface({surface, route});
  let state = restoreAppState(initialState, now());
  let uiState = 'idle';
  let lastProposal = null; // Always bound to { ..., targetDraftId }
  let lastGuard = null;
  let seq = state.audit.length;
  let monotonicAuditId = state.audit.length;
  let inferenceInFlight = 0;
  let dailyBucket = {day: '', count: 0};
  // FIFO queue of unpersisted post-share audit entries (deduplicated by collision-free entry id).
  const MAX_AUDIT_ENTRIES = LIMITS.audit;
  let pendingAuditEntries = [];
  const pendingDeletions = new Map();

  function generateAuditId() {
    monotonicAuditId += 1;
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return `aud-${globalThis.crypto.randomUUID()}`;
    }
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(12);
      globalThis.crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `aud-${hex}-${monotonicAuditId}`;
    }
    return `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${monotonicAuditId}`;
  }

  function enqueuePendingAudit(entry) {
    if (entry && !pendingAuditEntries.some(e => e.id === entry.id)) {
      pendingAuditEntries.push(entry);
    }
  }

  function mergeAuditsIntoState(entries) {
    if (!entries.length) return [];
    const existingIds = new Set(state.audit.map(e => e.id));
    const missing = entries.filter(e => e && !existingIds.has(e.id));
    if (missing.length) {
      state.audit = [...state.audit, ...missing].slice(-MAX_AUDIT_ENTRIES);
      seq = Math.max(seq, state.audit.length);
    }
    return missing;
  }

  function todayKey() {
    return String(now()).slice(0, 10);
  }

  function recordAudit({op, actor, outcome, targetKind, gateName = null}) {
    seq += 1;
    // O8 minimization: NEVER store consultation text, names, contacts, URLs, or PII.
    const entry = {
      id: generateAuditId(),
      timestamp: now(),
      op,
      actor: normalizeActor(actor),
      outcome,
      targetKind,
      ...(gateName ? {gateName} : {}),
    };
    state.audit = [...state.audit, entry].slice(-MAX_AUDIT_ENTRIES);
    return entry;
  }

  async function persistOrRollback(prevState, prevSeq) {
    if (typeof onPersist !== 'function') return {ok: true};
    let result;
    try {
      const raw = await onPersist(state);
      result = raw === undefined ? {ok: true} : raw;
    } catch (err) {
      result = {ok: false, conflict: err?.code === 'state-conflict', code: err?.code ?? 'storage-unavailable'};
    }
    if (result && result.ok === true) return {ok: true};
    // Roll back to reloaded authoritative state (on conflict) or pre-mutation snapshot.
    if (result?.reloadedState !== undefined) {
      state = restoreAppState(result.reloadedState, now());
      seq = Math.max(prevSeq, state.audit.length);
    } else {
      state = prevState;
      seq = prevSeq;
    }
    uiState = result?.conflict ? 'idle' : 'governor.blocked';
    return {
      ok: false,
      persisted: false,
      conflict: Boolean(result?.conflict),
      error: result?.code ?? 'persist-failed',
      state: uiState,
      disclaimer: t('disclaimer.fixed'),
    };
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
      const prevState = cloneState(state);
      const prevSeq = seq;
      const id = nextDraftId();
      const rec = createDraftRecord({id, title: typeof params?.title === 'string' ? params.title : '', draft: params?.draft ?? emptyDraft(), now: now()});
      state.drafts.push(rec);
      state.activeDraftId = rec.id;
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'draft'});
      uiState = 'audit.recorded';
      const p = await persistOrRollback(prevState, prevSeq);
      if (!p.ok) return p;
      lastProposal = null;
      return {ok: true, state: uiState, activeDraftId: rec.id, draftCount: state.drafts.length, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.draft.select') {
      const target = state.drafts.find(d => d.id === params?.id);
      if (!target) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'draft'});
        return {ok: false, state: uiState, error: 'draft-not-found', disclaimer: t('disclaimer.fixed')};
      }
      const prevState = cloneState(state);
      const prevSeq = seq;
      state.activeDraftId = target.id;
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'draft'});
      uiState = 'audit.recorded';
      const p = await persistOrRollback(prevState, prevSeq);
      if (!p.ok) return p;
      // Scope proposals strictly to their originating draftId: never carry across switches.
      if (lastProposal && lastProposal.targetDraftId !== target.id) lastProposal = null;
      return {ok: true, state: uiState, activeDraftId: target.id, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.draft.update') {
      const target = params?.id ? state.drafts.find(d => d.id === params.id) : activeDraftRecord(state);
      if (!target) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'draft'});
        return {ok: false, state: uiState, error: 'draft-not-found', disclaimer: t('disclaimer.fixed')};
      }
      // P1 #4: if applying an organization proposal, enforce exact draftId binding against active draft.
      if (params?.proposalDraftId !== undefined) {
        if (params.proposalDraftId !== target.id || params.proposalDraftId !== state.activeDraftId
          || (lastProposal && lastProposal.targetDraftId !== target.id)) {
          recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'draft', gateName: 'proposal-draft-mismatch'});
          uiState = 'governor.blocked';
          return {
            ok: false,
            state: uiState,
            gateName: 'proposal-draft-mismatch',
            error: 'proposal-draft-mismatch',
            disclaimer: t('disclaimer.fixed'),
          };
        }
      }
      const prevState = cloneState(state);
      const prevSeq = seq;
      const patch = params?.patch && typeof params.patch === 'object' ? params.patch : {};
      const merged = restoreDraft({...target.draft, ...patch, recipient: patch.recipient ? {...target.draft.recipient, ...patch.recipient} : target.draft.recipient});
      target.draft = merged;
      if (typeof params?.title === 'string') target.title = [...params.title].slice(0, LIMITS.draftTitle).join('');
      target.updatedAt = now();
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'draft'});
      uiState = 'audit.recorded';
      const p = await persistOrRollback(prevState, prevSeq);
      if (!p.ok) return p;
      if (params?.proposalDraftId === target.id) lastProposal = null;
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
      // P1 #2: Non-human actors (MCP / agent) MUST NEVER finalize irreversible draft deletion,
      // even if confirm:true / confirmed:true is supplied. Record a pending human-approval request instead.
      if (normActor.kind !== 'human') {
        pendingDeletions.set(target.id, {...preview, requestedAt: now(), requestedBy: normActor.kind});
        recordAudit({op, actor: normActor, outcome: 'dry-run', targetKind: 'draft', gateName: 'human-approval-required'});
        uiState = 'consent.required';
        return {
          ok: false,
          state: uiState,
          requiresHumanApproval: true,
          gateName: 'human-approval-required',
          preview,
          disclaimer: t('disclaimer.fixed'),
        };
      }
      if (params?.dryRun === true || params?.confirmed !== true) {
        pendingDeletions.set(target.id, {...preview, requestedAt: now(), requestedBy: 'human'});
        recordAudit({op, actor: normActor, outcome: 'dry-run', targetKind: 'draft'});
        uiState = 'consent.required';
        return {ok: true, state: uiState, preview, disclaimer: t('disclaimer.fixed')};
      }
      const prevState = cloneState(state);
      const prevSeq = seq;
      state.drafts.splice(idx, 1);
      if (state.drafts.length === 0) {
        const fresh = createDraftRecord({id: 'draft-1', now: now()});
        state.drafts.push(fresh);
      }
      if (state.activeDraftId === targetId) state.activeDraftId = state.drafts[0].id;
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'draft'});
      uiState = 'audit.recorded';
      const p = await persistOrRollback(prevState, prevSeq);
      if (!p.ok) return p;
      pendingDeletions.delete(targetId);
      if (lastProposal && lastProposal.targetDraftId === targetId) lastProposal = null;
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
      const prevState = cloneState(state);
      const prevSeq = seq;
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
      const p = await persistOrRollback(prevState, prevSeq);
      if (!p.ok) return p;
      return {ok: true, state: uiState, index: rec.draft.evidence.length - 1, evidenceCount: rec.draft.evidence.length, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.evidence.remove') {
      const rec = activeDraftRecord(state);
      const index = params?.index;
      if (!rec || !Number.isSafeInteger(index) || index < 0 || index >= rec.draft.evidence.length) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'evidence'});
        return {ok: false, state: uiState, error: 'evidence-not-found', disclaimer: t('disclaimer.fixed')};
      }
      const prevState = cloneState(state);
      const prevSeq = seq;
      rec.draft.evidence.splice(index, 1);
      rec.updatedAt = now();
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'evidence'});
      uiState = 'audit.recorded';
      const p = await persistOrRollback(prevState, prevSeq);
      if (!p.ok) return p;
      return {ok: true, state: uiState, evidenceCount: rec.draft.evidence.length, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.memo.assemble') {
      const rec = activeDraftRecord(state);
      const problems = draftProblems(rec?.draft);
      if (problems.length) {
        recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'memo'});
        return {ok: false, state: uiState, problems, disclaimer: t('disclaimer.fixed')};
      }
      const prevState = cloneState(state);
      const prevSeq = seq;
      const memo = assembleMemo(rec.draft, t);
      recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'memo'});
      uiState = 'audit.recorded';
      const p = await persistOrRollback(prevState, prevSeq);
      if (!p.ok) return p;
      return {ok: true, state: uiState, memo, disclaimer: t('disclaimer.fixed')};
    }

    if (op === 'soudan.memo.send') {
      if (sandboxedIframe) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'memo', gateName: 'iframe-no-direct-external-egress'});
        uiState = 'governor.blocked';
        lastGuard = {blocked: true, state: uiState, gateName: 'iframe-no-direct-external-egress'};
        return {ok: false, sent: false, state: uiState, gateName: 'iframe-no-direct-external-egress', disclaimer: t('disclaimer.fixed')};
      }
      const rec = activeDraftRecord(state);
      // P1 #2: Dry-run may inspect an in-memory editing snapshot (params.draft) WITHOUT persisting
      // or mutating stored drafts, revision, or audit history.
      const sourceDraft = (params?.dryRun === true && params?.draft && typeof params.draft === 'object')
        ? restoreDraft(params.draft)
        : rec?.draft;
      const dProblems = draftProblems(sourceDraft);
      const rProblems = recipientProblems(sourceDraft?.recipient);
      if (dProblems.length || rProblems.length) {
        if (params?.dryRun !== true) recordAudit({op, actor: normActor, outcome: 'error', targetKind: 'memo'});
        return {ok: false, sent: false, state: uiState, problems: [...dProblems, ...rProblems], disclaimer: t('disclaimer.fixed')};
      }
      const memo = assembleMemo(sourceDraft, t);
      const to = {
        name: sourceDraft.recipient.name.trim(),
        office: (sourceDraft.recipient.office ?? '').trim(),
        contact: sourceDraft.recipient.contact.trim(),
      };
      const addressed = addressedMemo(memo.text, to, t);
      if (/data:image\//i.test(addressed)) {
        if (params?.dryRun !== true) {
          recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'memo', gateName: 'image-bytes-forbidden'});
        }
        uiState = 'governor.blocked';
        return {ok: false, sent: false, state: uiState, gateName: 'image-bytes-forbidden', disclaimer: t('disclaimer.fixed')};
      }
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
        uiState = 'consent.required';
        return {ok: true, sent: false, state: uiState, preview, disclaimer: t('disclaimer.fixed')};
      }
      // Pre-share backlog guard: fail closed at MAX_AUDIT_ENTRIES (100) unrecorded share audits
      // without invoking external share so recovery must flush pending audits first.
      if (pendingAuditEntries.length >= MAX_AUDIT_ENTRIES) {
        uiState = 'governor.blocked';
        return {
          ok: false,
          sent: false,
          auditPersisted: false,
          pendingAuditCount: pendingAuditEntries.length,
          gateName: 'audit-recovery-required',
          error: 'audit-recovery-required',
          state: uiState,
          disclaimer: t('disclaimer.fixed'),
        };
      }
      if (!broker) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'memo', gateName: 'broker-unavailable'});
        uiState = 'governor.blocked';
        return {ok: false, sent: false, state: uiState, gateName: 'broker-unavailable', disclaimer: t('disclaimer.fixed')};
      }
      uiState = 'consent.required';
      const payload = {
        memo: addressed,
        recipient: to,
        ...(mode !== 'android-share' ? {
          mode,
          title: memo.title,
          markdown: formatMemoMarkdown(memo, to, t),
          exportJson: JSON.stringify(buildMemoExportV1(memo, to, sourceDraft, t, now()), null, 2),
        } : {}),
      };
      try {
        const result = await broker.invoke(SEND_SELECTOR, payload);
        // External share ALREADY succeeded here. Snapshot exact queued entries to flush alongside
        // this share's audit record, and after persist confirms ok:true remove ONLY IDs actually
        // present in the persisted post-truncation snapshot.
        const prevState = cloneState(state);
        const prevSeq = seq;
        const queuedSnapshot = [...pendingAuditEntries];
        mergeAuditsIntoState(queuedSnapshot);
        const auditEntry = recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'memo'});
        const entriesToFlush = [...queuedSnapshot, auditEntry];
        const persistedIds = new Set(state.audit.map(e => e.id));
        uiState = 'audit.recorded';
        const p = await persistOrRollback(prevState, prevSeq);
        if (!p.ok) {
          enqueuePendingAudit(auditEntry);
          return {
            ok: false,
            sent: true,
            auditPersisted: false,
            conflict: Boolean(p.conflict),
            auditError: p.error,
            error: p.error,
            pendingAuditEntry: auditEntry,
            pendingAuditEntries: [...pendingAuditEntries],
            pendingAuditCount: pendingAuditEntries.length,
            state: uiState,
            result,
            disclaimer: t('disclaimer.fixed'),
          };
        }
        const flushedEntries = entriesToFlush.filter(e => persistedIds.has(e.id));
        const flushedIds = new Set(flushedEntries.map(e => e.id));
        const flushedQueuedCount = queuedSnapshot.filter(e => flushedIds.has(e.id)).length;
        mergeAuditsIntoState(flushedEntries);
        pendingAuditEntries = pendingAuditEntries.filter(e => !flushedIds.has(e.id));
        if (!flushedIds.has(auditEntry.id)) enqueuePendingAudit(auditEntry);
        const allFlushed = flushedIds.size === entriesToFlush.length;
        if (!allFlushed) {
          uiState = 'governor.blocked';
          return {
            ok: false,
            sent: true,
            auditPersisted: false,
            auditError: 'audit-retention-cap-exceeded',
            error: 'audit-retention-cap-exceeded',
            flushedCount: flushedIds.size,
            flushedPendingCount: flushedQueuedCount,
            pendingAuditEntry: pendingAuditEntries[0] ?? auditEntry,
            pendingAuditEntries: [...pendingAuditEntries],
            pendingAuditCount: pendingAuditEntries.length,
            state: uiState,
            result,
            disclaimer: t('disclaimer.fixed'),
          };
        }
        return {
          ok: true,
          sent: true,
          auditPersisted: true,
          flushedCount: flushedIds.size,
          flushedPendingCount: flushedQueuedCount,
          pendingAuditCount: pendingAuditEntries.length,
          state: uiState,
          result,
          disclaimer: t('disclaimer.fixed'),
        };
      } catch (err) {
        const denied = /not approved/i.test(err?.message ?? '');
        const prevState = cloneState(state);
        const prevSeq = seq;
        recordAudit({op, actor: normActor, outcome: denied ? 'denied' : 'blocked', targetKind: 'memo', gateName: denied ? 'user-consent-denied' : 'broker-refused'});
        uiState = denied ? 'idle' : 'governor.blocked';
        const p = await persistOrRollback(prevState, prevSeq);
        return {
          ok: false,
          sent: false,
          auditPersisted: p.ok,
          ...(p.ok ? {} : {auditError: p.error}),
          state: uiState,
          error: err?.message ?? 'send-blocked',
          disclaimer: t('disclaimer.fixed'),
        };
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
      const originDraftId = rec?.id ?? state.activeDraftId;
      // P2 #2: Use the live unsaved editing snapshot when provided, without writing it to storage.
      const sourceDraft = (params?.draftSnapshot && typeof params.draftSnapshot === 'object')
        ? restoreDraft(params.draftSnapshot)
        : (rec?.draft ?? emptyDraft());
      const userPrompt = typeof params?.prompt === 'string' && params.prompt.trim()
        ? params.prompt
        : [sourceDraft.summary ?? '', sourceDraft.wish ?? '', ...(sourceDraft.timeline ?? []).map(e => e.event)].join('\n');
      if (/data:image\//i.test(userPrompt) || /data:image\//i.test(JSON.stringify(sourceDraft))) {
        const prevState = cloneState(state);
        const prevSeq = seq;
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: 'image-bytes-forbidden'});
        uiState = 'governor.blocked';
        lastGuard = {blocked: true, state: uiState, gateName: 'image-bytes-forbidden'};
        await persistOrRollback(prevState, prevSeq);
        return {ok: false, state: uiState, gateName: 'image-bytes-forbidden', disclaimer: t('disclaimer.fixed')};
      }
      const guard = evaluateGovernorGuard(userPrompt, t);
      if (guard.blocked) {
        const prevState = cloneState(state);
        const prevSeq = seq;
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: guard.gateName});
        uiState = 'governor.blocked';
        lastGuard = guard;
        await persistOrRollback(prevState, prevSeq);
        return {ok: false, state: uiState, gateName: guard.gateName, routes: guard.routes, disclaimer: t('disclaimer.fixed')};
      }
      const cfg = params?.config ?? inferenceConfig;
      const cfgCheck = validateInferenceConfig(cfg);
      if (!cfgCheck.ok) {
        if (['murakumo-free-forbidden', 'forbidden-model', 'forbidden-endpoint', 'endpoint-not-allowed', 'model-not-inhouse-allowlisted', 'max-tokens-out-of-bounds'].includes(cfgCheck.reason)) {
          const prevState = cloneState(state);
          const prevSeq = seq;
          recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: cfgCheck.reason});
          uiState = 'governor.blocked';
          lastGuard = {blocked: true, state: uiState, gateName: cfgCheck.reason};
          await persistOrRollback(prevState, prevSeq);
          return {ok: false, state: uiState, gateName: cfgCheck.reason, disclaimer: t('disclaimer.fixed')};
        }
        // Fail-closed disabled/unconfigured -> pure in-memory local offline fallback bound to originDraftId
        // (does NOT write unsaved draftSnapshot to storage or bump revision).
        const local = {...organizeLocally(sourceDraft, t), targetDraftId: originDraftId};
        lastProposal = local;
        uiState = 'proposal.ready';
        return {ok: true, state: uiState, fallback: 'local', reason: cfgCheck.reason, proposal: local, disclaimer: t('disclaimer.fixed')};
      }
      if (!ALLOWED_INFERENCE_SURFACES.includes(resolvedSurface)) {
        // Android (no-INTERNET) or non-allowed surface remains strictly fail-closed (:local-only).
        const local = {...organizeLocally(sourceDraft, t), targetDraftId: originDraftId};
        lastProposal = local;
        uiState = 'proposal.ready';
        return {
          ok: true,
          state: uiState,
          fallback: 'local',
          reason: DISABLED_REASON_ANDROID_OR_LOCAL_ONLY,
          proposal: local,
          disclaimer: t('disclaimer.fixed'),
        };
      }
      if (params?.localOnly === true || !broker) {
        // Pure local-only organization: builds proposal from live unsaved sourceDraft without persisting.
        const local = {...organizeLocally(sourceDraft, t), targetDraftId: originDraftId};
        lastProposal = local;
        uiState = 'proposal.ready';
        return {ok: true, state: uiState, fallback: 'local', proposal: local, disclaimer: t('disclaimer.fixed')};
      }
      if (inferenceInFlight >= INFERENCE_LIMITS.maxConcurrencyPerTab) {
        recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: 'concurrency-limit-exceeded'});
        uiState = 'governor.blocked';
        return {ok: false, state: uiState, gateName: 'concurrency-limit-exceeded', disclaimer: t('disclaimer.fixed')};
      }
      const day = todayKey();
      if (dailyBucket.day !== day) dailyBucket = {day, count: 0};
      if (dailyBucket.count >= INFERENCE_LIMITS.softDailyTurns) {
        const local = {...organizeLocally(sourceDraft, t), targetDraftId: originDraftId};
        lastProposal = local;
        uiState = 'proposal.ready';
        return {ok: true, state: uiState, fallback: 'local', reason: 'daily-limit-reached', proposal: local, disclaimer: t('disclaimer.fixed')};
      }

      uiState = 'consent.required';
      const extraHeaders = typeof authHeaderProvider === 'function' ? await authHeaderProvider() : null;
      const headers = buildInferenceHeaders({extraHeaders});
      const bodyObj = buildInferenceRequestBody({
        draft: sourceDraft,
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
        const rawBody = typeof resp?.text === 'function'
          ? await resp.text()
          : (typeof resp?.content === 'string' ? resp.content : resp);
        if (isCapacityOrRateLimitError(status, typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? ''))) {
          const local = {...organizeLocally(sourceDraft, t), targetDraftId: originDraftId};
          const prevState = cloneState(state);
          const prevSeq = seq;
          lastProposal = local;
          uiState = 'proposal.ready';
          recordAudit({op, actor: normActor, outcome: 'fallback', targetKind: 'inference', gateName: `capacity-or-rate-limit-${status}`});
          await persistOrRollback(prevState, prevSeq);
          return {ok: true, state: uiState, fallback: 'local', reason: 'capacity-or-rate-limit', status, proposal: local, disclaimer: t('disclaimer.fixed')};
        }
        const proposal = buildProposalFromCompletion(rawBody, t);
        if (proposal.blocked) {
          const prevState = cloneState(state);
          const prevSeq = seq;
          recordAudit({op, actor: normActor, outcome: 'blocked', targetKind: 'inference', gateName: proposal.gateName});
          uiState = 'governor.blocked';
          lastGuard = proposal;
          await persistOrRollback(prevState, prevSeq);
          return {ok: false, state: uiState, gateName: proposal.gateName, routes: proposal.routes, disclaimer: t('disclaimer.fixed')};
        }
        const bound = {...proposal, targetDraftId: originDraftId};
        const prevState = cloneState(state);
        const prevSeq = seq;
        dailyBucket.count += 1;
        lastProposal = bound;
        uiState = 'proposal.ready';
        recordAudit({op, actor: normActor, outcome: 'ok', targetKind: 'inference'});
        await persistOrRollback(prevState, prevSeq);
        return {ok: true, state: uiState, proposal: bound, disclaimer: t('disclaimer.fixed')};
      } catch (err) {
        const denied = /not approved/i.test(err?.message ?? '');
        const local = {...organizeLocally(sourceDraft, t), targetDraftId: originDraftId};
        const prevState = cloneState(state);
        const prevSeq = seq;
        lastProposal = local;
        uiState = 'proposal.ready';
        recordAudit({op, actor: normActor, outcome: denied ? 'denied' : 'fallback', targetKind: 'inference', gateName: denied ? 'user-consent-denied' : 'inference-unavailable'});
        await persistOrRollback(prevState, prevSeq);
        return {ok: true, state: uiState, fallback: 'local', reason: denied ? 'consent-denied' : 'inference-unavailable', proposal: local, disclaimer: t('disclaimer.fixed')};
      } finally {
        inferenceInFlight -= 1;
      }
    }

    return {ok: false, state: uiState, error: 'unhandled-operation', disclaimer: t('disclaimer.fixed')};
  }

  function getOpCapabilities() {
    return computeSemanticOps({
      surface: resolvedSurface,
      inferenceConfig,
      sandboxedIframe,
    });
  }

  function getSnapshot() {
    const caps = getOpCapabilities();
    const active = activeDraftRecord(state);
    return {
      schema: state.schema,
      uiState,
      surface: caps.surface,
      route,
      inferenceMode: caps.inferenceMode,
      activeDraftId: state.activeDraftId,
      draftCount: state.drafts.length,
      activeDraft: active ? cloneState(active) : null,
      auditCount: state.audit.length,
      pendingAuditCount: pendingAuditEntries.length,
      pendingDeletionCount: pendingDeletions.size,
      activeOps: caps.activeOps,
      disabledOps: caps.disabledOps,
      disclaimer: t('disclaimer.fixed'),
    };
  }

  return Object.freeze({
    getState: () => state,
    getSnapshot,
    getSurface: () => resolvedSurface,
    getActiveOps: () => getOpCapabilities().activeOps,
    getDisabledOps: () => getOpCapabilities().disabledOps,
    setState: next => {
      state = restoreAppState(next, now());
      if (lastProposal && lastProposal.targetDraftId !== state.activeDraftId) lastProposal = null;
    },
    getActiveDraft: () => activeDraftRecord(state),
    getUiState: () => uiState,
    setUiState: next => { if (SEMANTIC_STATES.includes(next)) uiState = next; },
    getLastProposal: (draftId = state.activeDraftId) => (
      lastProposal && lastProposal.targetDraftId === draftId ? lastProposal : null
    ),
    clearProposal: () => { lastProposal = null; uiState = 'idle'; },
    getPendingDeletions: () => [...pendingDeletions.values()],
    getPendingAudit: () => pendingAuditEntries[0] ?? null,
    getPendingAudits: () => [...pendingAuditEntries],
    getPendingAuditCount: () => pendingAuditEntries.length,
    // Retry persisting queued post-share audit entries in FIFO order WITHOUT ever repeating external share.
    // After persist confirms ok:true, inspects the actual persisted post-truncation snapshot and removes
    // ONLY those persisted IDs from pendingAuditEntries; any entry truncated by MAX_AUDIT_ENTRIES remains
    // queued with auditPersisted:false and auditError:'audit-retention-cap-exceeded' for follow-up retry.
    async retryPendingAudit() {
      if (pendingAuditEntries.length === 0) {
        return {ok: true, auditPersisted: true, flushedCount: 0, pendingAuditCount: 0, state: uiState, disclaimer: t('disclaimer.fixed')};
      }
      const prevState = cloneState(state);
      const prevSeq = seq;
      const entriesToFlush = [...pendingAuditEntries];
      mergeAuditsIntoState(entriesToFlush);
      const persistedIds = new Set(state.audit.map(e => e.id));
      uiState = 'audit.recorded';
      const p = await persistOrRollback(prevState, prevSeq);
      if (!p.ok) {
        return {
          ok: false,
          auditPersisted: false,
          conflict: Boolean(p.conflict),
          auditError: p.error,
          error: p.error,
          pendingAuditCount: pendingAuditEntries.length,
          state: uiState,
          disclaimer: t('disclaimer.fixed'),
        };
      }
      const flushedEntries = entriesToFlush.filter(e => persistedIds.has(e.id));
      const flushedIds = new Set(flushedEntries.map(e => e.id));
      mergeAuditsIntoState(flushedEntries);
      pendingAuditEntries = pendingAuditEntries.filter(e => !flushedIds.has(e.id));
      const allFlushed = flushedIds.size === entriesToFlush.length;
      if (!allFlushed) {
        uiState = 'governor.blocked';
        return {
          ok: false,
          auditPersisted: false,
          flushedCount: flushedIds.size,
          pendingAuditCount: pendingAuditEntries.length,
          auditError: 'audit-retention-cap-exceeded',
          error: 'audit-retention-cap-exceeded',
          state: uiState,
          disclaimer: t('disclaimer.fixed'),
        };
      }
      return {
        ok: true,
        auditPersisted: true,
        flushedCount: flushedIds.size,
        pendingAuditCount: pendingAuditEntries.length,
        state: uiState,
        disclaimer: t('disclaimer.fixed'),
      };
    },
    getLastGuard: () => lastGuard,
    execute,
  });
}
