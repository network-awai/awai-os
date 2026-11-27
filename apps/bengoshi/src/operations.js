// Canonical shared `noun.verb` operations for Bengoshi (network.itonami.bengoshi).
// Used identically by UI and MCP POC server/adapter.
// Enforces:
// - O2 (zero-fee, fee_jpy: 0)
// - O4 (verification HARD holds on expired / suspended_or_revoked)
// - O8 (100% device-local, zero external network calls, zero server relay, Method A primary)
// - O9 (expanded strict neutrality, anti-scout, no online retainer signing)
// - Art. 11 3-year preservation export (`lawyer.export_art11_record`)
// - AWAI-3235 (lawyer conflict-check HARD gate, strictly local preview / offline import)

import {
  ZERO_FEE_POLICY,
  filterAndSortLawyers,
  evaluateVerificationStatus,
  canSendToLawyer,
  validateLawyerRecord,
  validateInquiryDraft,
  parseSoudanMemoExport,
  formatManualContactText,
  exportArt11Record,
  extractConflictHeader,
  runLocalConflictCheck,
  canRevealInquiryBody,
  appendAuditEntry,
  verifyAuditChain,
  sha256Hex,
} from './model.js';
import { encryptEnvelope, decryptEnvelope } from './crypto.js';
import { SYNTHETIC_CATALOG_BUNDLE, DEFAULT_LOCAL_CONFLICT_LEDGER } from './fixtures.js';
import { getLegalNotices } from './legal-notices.js';

export const CANONICAL_OPERATIONS = Object.freeze([
  'directory.search',
  'lawyer.get',
  'qualification.verify_status',
  'contact.format_manual',
  'inquiry.import_memo',
  'inquiry.draft',
  'inquiry.send',
  'inquiry.list',
  'lawyer.profile.update',
  'lawyer.export_art11_record',
  'intake.list',
  'intake.conflict_check',
  'intake.decide',
  'audit.list',
]);

export const PROHIBITED_OPERATIONS = Object.freeze([
  'inference.assist',
  'referral.fee',
  'referral.commission',
  'fee.split',
  'ad.slot',
  'ad.sponsor',
  'lawyer.rank',
  'lawyer.recommend',
  'review.submit',
  'rating.submit',
  'scout.send',
  'offer.reverse',
  'retainer.sign_online',
  'contract.sign_online',
  'forward.firm_to_firm',
  'inquiry.forward_to_firm',
  'token.reward',
  'billing.subscribe',
]);

export function createInitialLocalState() {
  return {
    settings: {
      directoryScope: 'tenant_only',
      tenantId: 'default-tenant',
      syntheticDemoMode: false,
      locale: 'ja',
    },
    draft: null,
    sentInquiries: [],
    lawyerProfile: null,
    lawyerEditHistory: [],
    conflictLedger: [...DEFAULT_LOCAL_CONFLICT_LEDGER],
    intakeRecords: [],
    auditLog: [],
  };
}

export function createOperationsEngine({
  catalog = SYNTHETIC_CATALOG_BUNDLE.lawyers,
  state = createInitialLocalState(),
  getPrivateKeyJwk = null,
  now = () => new Date().toISOString(),
  onStateChange = null,
} = {}) {
  const catalogById = new Map();
  for (const l of catalog) catalogById.set(l.id, l);

  function allLawyers() {
    const list = [...catalog];
    if (state.lawyerProfile && state.lawyerProfile.id) {
      const idx = list.findIndex(x => x.id === state.lawyerProfile.id);
      if (idx >= 0) list[idx] = state.lawyerProfile;
      else list.push(state.lawyerProfile);
    }
    return list;
  }

  function findLawyer(lawyerId) {
    if (state.lawyerProfile && state.lawyerProfile.id === lawyerId) return state.lawyerProfile;
    return catalogById.get(lawyerId) || null;
  }

  function audit(actor, operation, outcome, summary, details = {}) {
    const next = appendAuditEntry(state.auditLog, {
      actor,
      operation,
      outcome,
      summary,
      details,
      timestamp: now(),
    });
    state.auditLog = next.log;
    return next.entry;
  }

  function restoreState(snapshot) {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, snapshot);
  }

  async function commitOrRollback(snapshot, { throwOnFailure = true } = {}) {
    if (typeof onStateChange !== 'function') return { ok: true };
    try {
      const result = await onStateChange(state);
      if (result && result.ok === false) {
        restoreState(snapshot);
        if (!throwOnFailure) return result;
        throw Object.assign(new Error(result.message || 'storage-persist-failed'), {
          code: 'storage-persist-failed',
          causeCode: result.code || result.error?.code || result.error?.name || 'storage-write-failed',
          error: result.error,
          persistResult: result,
        });
      }
      return result || { ok: true };
    } catch (err) {
      if (err?.code === 'storage-persist-failed') throw err;
      restoreState(snapshot);
      const persistResult = {
        ok: false,
        error: err,
        code: err?.code || err?.name || 'storage-write-failed',
        message: err?.message || String(err),
      };
      if (!throwOnFailure) return persistResult;
      throw Object.assign(new Error(persistResult.message || 'storage-persist-failed'), {
        code: 'storage-persist-failed',
        causeCode: persistResult.code,
        error: err,
        persistResult,
      });
    }
  }

  async function execute(operationName, params = {}, { actor = 'ui' } = {}) {
    if (PROHIBITED_OPERATIONS.includes(operationName)) {
      const snapshot = structuredClone(state);
      audit(actor, operationName, 'rejected', 'Prohibited by Legal addendum / O2 / O8 / O9 structural invariant');
      await commitOrRollback(snapshot, { throwOnFailure: false });
      throw Object.assign(new Error('operation-prohibited-by-invariant'), { code: 'operation-prohibited-by-invariant', operation: operationName });
    }
    if (!CANONICAL_OPERATIONS.includes(operationName)) {
      throw Object.assign(new Error('unknown-operation'), { code: 'unknown-operation', operation: operationName });
    }

    const nowIso = now();

    switch (operationName) {
      case 'directory.search': {
        const snapshot = structuredClone(state);
        const results = filterAndSortLawyers(allLawyers(), {
          query: params.query ?? '',
          prefectureCode: params.prefectureCode ?? params.prefecture_code ?? '',
          practiceArea: params.practiceArea ?? params.practice_area ?? '',
          language: params.language ?? '',
          legalAidHouterasu: params.legalAidHouterasu ?? params.legal_aid_houterasu ?? null,
          verificationStatus: params.verificationStatus ?? params.verification_status ?? '',
          sort: params.sort ?? 'kana_asc',
          directoryScope: params.directoryScope ?? params.directory_scope ?? state.settings.directoryScope,
          tenantId: params.tenantId ?? state.settings.tenantId,
          nowIso,
        });
        audit(actor, 'directory.search', 'ok', `Local neutral search (${results.length} synthetic results)`, {
          sort: params.sort ?? 'kana_asc',
          directoryScope: params.directoryScope ?? state.settings.directoryScope,
          localOnly: true,
        });
        const persistResult = await commitOrRollback(snapshot, { throwOnFailure: false });
        return {
          policy: ZERO_FEE_POLICY,
          localOnly: true,
          syntheticOnly: results.every(l => l.synthetic === true),
          directoryScope: params.directoryScope ?? state.settings.directoryScope,
          sort: params.sort ?? 'kana_asc',
          total: results.length,
          lawyers: results,
          persistResult,
        };
      }

      case 'lawyer.get': {
        const lawyer = findLawyer(params.lawyerId ?? params.id);
        if (!lawyer) throw Object.assign(new Error('lawyer-not-found'), { code: 'lawyer-not-found' });
        const evaluatedVerification = evaluateVerificationStatus(lawyer.verification, nowIso);
        return {
          policy: ZERO_FEE_POLICY,
          lawyer: { ...lawyer, evaluatedVerification },
        };
      }

      case 'qualification.verify_status': {
        const lawyer = findLawyer(params.lawyerId ?? params.id);
        if (!lawyer) throw Object.assign(new Error('lawyer-not-found'), { code: 'lawyer-not-found' });
        const status = evaluateVerificationStatus(lawyer.verification, nowIso);
        const sendCheck = canSendToLawyer(lawyer, {
          syntheticDemoMode: Boolean(params.syntheticDemoMode ?? state.settings.syntheticDemoMode),
          nowIso,
        });
        return {
          lawyerId: lawyer.id,
          scrapingUsed: false,
          idPhotoOnlyAccepted: false,
          verification: status,
          sendGate: sendCheck,
        };
      }

      case 'contact.format_manual': {
        const lawyer = findLawyer(params.lawyerId ?? params.id);
        if (!lawyer) throw Object.assign(new Error('lawyer-not-found'), { code: 'lawyer-not-found' });
        const text = formatManualContactText(lawyer, { nowIso });
        const snapshot = structuredClone(state);
        audit(actor, 'contact.format_manual', 'ok', 'Formatted 7-line Method A manual contact text locally', {
          lawyerId: lawyer.id,
          method: 'method_a_direct',
        });
        await commitOrRollback(snapshot);
        return {
          method: 'method_a_direct',
          serverRelayUsed: false,
          lawyerId: lawyer.id,
          lineCount: text.split('\n').length,
          text,
          websiteUrl: lawyer.website_url || '',
          mailto: lawyer.email ? `mailto:${lawyer.email}` : '',
          tel: lawyer.phone ? `tel:${lawyer.phone}` : '',
        };
      }

      case 'inquiry.import_memo': {
        const imported = parseSoudanMemoExport(params.json ?? params.memo);
        if (params.lawyerId) imported.lawyerId = params.lawyerId;
        const snapshot = structuredClone(state);
        state.draft = imported;
        audit(actor, 'inquiry.import_memo', 'ok', 'Imported soudan.memo.export.v1 locally', {
          template: imported.template,
          category: imported.category,
          evidenceCount: imported.evidenceManifest.length,
        });
        await commitOrRollback(snapshot);
        return { draft: imported };
      }

      case 'inquiry.draft': {
        const draft = params.draft;
        const problems = validateInquiryDraft(draft);
        const snapshot = structuredClone(state);
        state.draft = structuredClone(draft);
        audit(actor, 'inquiry.draft', problems.length ? 'validation_warning' : 'ok', 'Saved inquiry draft locally', {
          problemCount: problems.length,
        });
        await commitOrRollback(snapshot);
        return { savedLocally: true, problems, draft: state.draft };
      }

      case 'inquiry.send': {
        // Method A is primary (zero platform server relay).
        // Live relay is structurally disabled (`relay-disabled-method-a-only`);
        // offline local E2EE envelope creation is available strictly on-device for local preview.
        if (params.requireLiveRelay === true) {
          const snapshot = structuredClone(state);
          audit(actor, 'inquiry.send', 'blocked', 'Server relay disabled: Method A direct contact only');
          await commitOrRollback(snapshot, { throwOnFailure: false });
          throw Object.assign(new Error('relay-disabled-method-a-only'), { code: 'relay-disabled-method-a-only' });
        }

        const draft = params.draft ?? state.draft;
        const problems = validateInquiryDraft(draft);
        if (problems.length) {
          throw Object.assign(new Error('draft-invalid'), { code: 'draft-invalid', problems });
        }
        const lawyer = findLawyer(draft.lawyerId);
        if (!lawyer) throw Object.assign(new Error('lawyer-not-found'), { code: 'lawyer-not-found' });

        // O4 verification & HARD hold gate
        const demoMode = Boolean(params.syntheticDemoMode ?? state.settings.syntheticDemoMode);
        const gate = canSendToLawyer(lawyer, { syntheticDemoMode: demoMode, nowIso });
        if (!gate.allowed) {
          const snapshot = structuredClone(state);
          audit(actor, 'inquiry.send', 'blocked', `Blocked by O4 gate: ${gate.reason}`, {
            lawyerId: lawyer.id,
            effectiveStatus: gate.status.effectiveStatus,
            hardHold: gate.hardHold,
          });
          await commitOrRollback(snapshot, { throwOnFailure: false });
          throw Object.assign(new Error(gate.reason), { code: gate.reason, hardHold: gate.hardHold, status: gate.status });
        }

        if (!lawyer.e2ee_public_key_jwk) {
          throw Object.assign(new Error('lawyer-e2ee-key-missing'), { code: 'lawyer-e2ee-key-missing' });
        }

        // O8 E2EE encryption strictly on client (offline preview envelope; zero external transmission)
        const inquiryId = params.inquiryId || `inq-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const conflictHeader = {
          inquiryId,
          clientName: draft.clientName.trim(),
          counterpartyName: draft.counterpartyName.trim(),
          category: draft.category,
          receivedAt: nowIso,
        };
        const envelope = await encryptEnvelope({
          recipientLawyerId: lawyer.id,
          recipientPublicKeyJwk: lawyer.e2ee_public_key_jwk,
          conflictHeader,
          plaintext: {
            summary: draft.summary.trim(),
            clientContact: draft.clientContact.trim(),
            wish: (draft.wish || '').trim(),
            deadline: (draft.deadline || '').trim(),
            timeline: draft.timeline || [],
            documents: draft.documents || [],
            evidenceManifest: draft.evidenceManifest || [],
          },
        });

        const record = {
          inquiryId,
          lawyerId: lawyer.id,
          lawyerName: lawyer.name,
          barAssociation: lawyer.bar_association,
          verificationStatus: gate.status.effectiveStatus,
          sentAt: nowIso,
          dryRun: true,
          serverRelayUsed: false,
          relayStatus: 'offline_local_preview_only',
          conflictHeader,
          envelope,
          replies: [],
          copyRetentionNotice: getLegalNotices(state.settings.locale).lawyerCopyRetention,
        };
        const snapshot = structuredClone(state);
        state.sentInquiries = [record, ...state.sentInquiries];
        audit(actor, 'inquiry.send', 'ok', 'Created offline local E2EE preview envelope (0 bytes external)', {
          inquiryId,
          lawyerId: lawyer.id,
          serverRelayUsed: false,
          aadSha256: envelope.aadSha256,
        });
        await commitOrRollback(snapshot);
        return { record, serverRelayUsed: false };
      }

      case 'inquiry.list': {
        if (params.deleteInquiryId) {
          const before = state.sentInquiries.length;
          const nextInquiries = state.sentInquiries.filter(r => r.inquiryId !== params.deleteInquiryId);
          if (nextInquiries.length !== before) {
            const snapshot = structuredClone(state);
            state.sentInquiries = nextInquiries;
            audit(actor, 'inquiry.list', 'deleted_local', 'Deleted local record copy', {
              inquiryId: params.deleteInquiryId,
            });
            await commitOrRollback(snapshot);
          }
        }
        return {
          inquiries: [...state.sentInquiries],
          localOnly: true,
          lawyerCopyRetentionNotice: getLegalNotices(state.settings.locale).lawyerCopyRetention,
        };
      }

      case 'lawyer.profile.update': {
        const candidate = params.profile;
        const problems = validateLawyerRecord(candidate);
        if (problems.length) {
          const snapshot = structuredClone(state);
          audit(actor, 'lawyer.profile.update', 'rejected', `Rejected by O9/O4 validator (${problems.length} problems)`, {
            codes: problems.map(p => p.code),
          });
          await commitOrRollback(snapshot, { throwOnFailure: false });
          throw Object.assign(new Error('lawyer-profile-invalid'), { code: 'lawyer-profile-invalid', problems });
        }
        const snapshot = structuredClone(state);
        state.lawyerProfile = structuredClone(candidate);
        if (!Array.isArray(state.lawyerEditHistory)) state.lawyerEditHistory = [];
        const snapHash = sha256Hex(JSON.stringify(state.lawyerProfile));
        state.lawyerEditHistory.push({
          timestamp: nowIso,
          action: params.action || 'profile_update',
          lawyer_id: candidate.id,
          snapshot_sha256: snapHash,
          changed_fields: Object.keys(candidate),
        });
        audit(actor, 'lawyer.profile.update', 'ok', 'Updated local factual lawyer profile (O9 validated)', {
          lawyerId: candidate.id,
          snapshotSha256: snapHash,
        });
        await commitOrRollback(snapshot);
        return { savedLocally: true, profile: state.lawyerProfile, historyCount: state.lawyerEditHistory.length };
      }

      case 'lawyer.export_art11_record': {
        const target = params.profile || state.lawyerProfile || findLawyer(params.lawyerId) || catalog[0];
        if (!target) throw Object.assign(new Error('lawyer-not-found'), { code: 'lawyer-not-found' });
        const history = Array.isArray(params.editHistory) ? params.editHistory : (state.lawyerEditHistory || []);
        const record = exportArt11Record(target, history, { nowIso });
        const snapshot = structuredClone(state);
        audit(actor, 'lawyer.export_art11_record', 'ok', 'Exported Art. 11 3-year preservation record locally', {
          lawyerId: target.id,
          retentionYears: record.retention_years,
          feeJpy: record.free_participation_terms.fee_jpy,
          recordSha256: record.record_sha256,
        });
        await commitOrRollback(snapshot);
        return { localOnly: true, record };
      }

      case 'intake.list': {
        // AWAI-3235: expose ONLY minimal conflict-check headers & gate state, NEVER plaintext body!
        const items = state.intakeRecords.map(rec => ({
          inquiryId: rec.inquiryId,
          receivedAt: rec.receivedAt,
          conflictHeader: extractConflictHeader(rec),
          conflictCheck: rec.conflictCheck,
          revealGate: canRevealInquiryBody(rec),
          decision: rec.decision,
          replySentAt: rec.replySentAt,
        }));
        return { items, localOnly: true, serverRelayUsed: false };
      }

      case 'intake.conflict_check': {
        const rec = state.intakeRecords.find(r => r.inquiryId === params.inquiryId);
        if (!rec) throw Object.assign(new Error('intake-not-found'), { code: 'intake-not-found' });
        const header = extractConflictHeader(rec);
        const check = runLocalConflictCheck(header, state.conflictLedger, { checkedAt: nowIso });
        const confirmed = Boolean(params.confirmClear === true && check.result === 'clear');
        const snapshot = structuredClone(state);
        rec.conflictCheck = Object.freeze({
          ...check,
          confirmedByLawyer: confirmed,
          confirmedAt: confirmed ? nowIso : null,
        });
        audit(actor, 'intake.conflict_check', check.result, `Conflict check ${check.result} (confirmed=${confirmed})`, {
          inquiryId: rec.inquiryId,
          result: check.result,
          matchCount: check.matches.length,
          receiptDigest: check.receiptDigest,
        });
        await commitOrRollback(snapshot);
        return {
          inquiryId: rec.inquiryId,
          conflictHeader: header,
          conflictCheck: rec.conflictCheck,
          revealGate: canRevealInquiryBody(rec),
        };
      }

      case 'intake.decide': {
        if (params.action === 'forward_to_firm' || params.forwardToFirmId) {
          const snapshot = structuredClone(state);
          audit(actor, 'intake.decide', 'rejected', 'Firm-to-firm forwarding is prohibited (O8)');
          await commitOrRollback(snapshot, { throwOnFailure: false });
          throw Object.assign(new Error('o8.firm_to_firm_forwarding_prohibited'), { code: 'o8.firm_to_firm_forwarding_prohibited' });
        }

        const rec = state.intakeRecords.find(r => r.inquiryId === params.inquiryId);
        if (!rec) throw Object.assign(new Error('intake-not-found'), { code: 'intake-not-found' });

        // AWAI-3235 HARD gate: block body reveal/decrypt or acceptance if conflict check is not cleared & confirmed
        const action = params.action || 'reveal';
        if (action === 'decline_conflict') {
          const snapshot = structuredClone(state);
          rec.decision = { status: 'declined_conflict', decidedAt: nowIso, note: 'Declined due to conflict check without viewing inquiry body.' };
          audit(actor, 'intake.decide', 'declined_conflict', 'Declined inquiry at conflict gate without decrypting body', {
            inquiryId: rec.inquiryId,
          });
          await commitOrRollback(snapshot);
          return { inquiryId: rec.inquiryId, revealed: false, decision: rec.decision };
        }

        const gate = canRevealInquiryBody(rec);
        if (!gate.allowed) {
          const snapshot = structuredClone(state);
          audit(actor, 'intake.decide', 'blocked', `Blocked by conflict-check HARD gate: ${gate.reason}`, {
            inquiryId: rec.inquiryId,
          });
          await commitOrRollback(snapshot, { throwOnFailure: false });
          throw Object.assign(new Error(gate.reason), { code: gate.reason, hardGate: true });
        }

        if (action === 'reveal') {
          const privKey = params.recipientPrivateKeyJwk || (typeof getPrivateKeyJwk === 'function' ? await getPrivateKeyJwk() : null);
          if (!privKey) throw Object.assign(new Error('lawyer-private-key-unavailable'), { code: 'lawyer-private-key-unavailable' });
          const decrypted = await decryptEnvelope({ envelope: rec.envelope, recipientPrivateKeyJwk: privKey });
          const snapshot = structuredClone(state);
          audit(actor, 'intake.decide', 'revealed', 'Decrypted inquiry body on device after confirmed clear conflict check', {
            inquiryId: rec.inquiryId,
            receiptDigest: rec.conflictCheck.receiptDigest,
          });
          await commitOrRollback(snapshot);
          return { inquiryId: rec.inquiryId, revealed: true, plaintext: decrypted, conflictCheck: rec.conflictCheck };
        }

        if (action === 'accept' || action === 'decline') {
          const replyText = typeof params.replyText === 'string' ? params.replyText.trim() : '';
          const snapshot = structuredClone(state);
          rec.decision = {
            status: action,
            decidedAt: nowIso,
            replyNote: replyText,
            localPreviewOnly: true,
            serverRelayUsed: false,
          };
          rec.replySentAt = nowIso;
          audit(actor, 'intake.decide', action, `Recorded local intake decision (${action}; zero server relay)`, {
            inquiryId: rec.inquiryId,
            serverRelayUsed: false,
          });
          await commitOrRollback(snapshot);
          return { inquiryId: rec.inquiryId, decision: rec.decision, serverRelayUsed: false };
        }

        throw Object.assign(new Error('invalid-intake-action'), { code: 'invalid-intake-action' });
      }

      case 'audit.list': {
        const integrity = verifyAuditChain(state.auditLog);
        const limit = Number.isSafeInteger(params.limit) && params.limit > 0 ? params.limit : 200;
        return {
          integrity,
          total: state.auditLog.length,
          entries: state.auditLog.slice(-limit).reverse(),
        };
      }
    }
  }

  return Object.freeze({
    operations: CANONICAL_OPERATIONS,
    state,
    execute,
  });
}
