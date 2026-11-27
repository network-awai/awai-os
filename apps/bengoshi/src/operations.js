// Canonical shared `noun.verb` operations for Bengoshi (network.itonami.bengoshi).
// Used identically by UI, MCP server/adapter, and ACP adapter.
// Enforces O2 (zero-fee), O4 (verification HARD hold), O8 (local residency & E2EE & each-operation consent),
// O9 (strict neutrality), and AWAI-3235 (lawyer conflict-check HARD gate).

import {
  ZERO_FEE_POLICY,
  filterAndSortLawyers,
  evaluateVerificationStatus,
  canSendToLawyer,
  validateLawyerRecord,
  validateInquiryDraft,
  parseSoudanMemoExport,
  extractConflictHeader,
  runLocalConflictCheck,
  canRevealInquiryBody,
  appendAuditEntry,
  verifyAuditChain,
} from './model.js';
import { encryptEnvelope, decryptEnvelope } from './crypto.js';
import {
  MURAKUMO_ORIGIN,
  DEFAULT_MURAKUMO_PATH,
  INFERENCE_SELECTOR,
  INQUIRY_SEND_SELECTOR,
  INQUIRY_REPLY_SELECTOR,
} from './runtime-descriptor.js';
import { SYNTHETIC_CATALOG_BUNDLE, DEFAULT_LOCAL_CONFLICT_LEDGER } from './fixtures.js';
import { getLegalNotices } from './legal-notices.js';

export const CANONICAL_OPERATIONS = Object.freeze([
  'directory.search',
  'lawyer.get',
  'qualification.verify_status',
  'inquiry.import_memo',
  'inquiry.draft',
  'inquiry.send',
  'inquiry.list',
  'lawyer.profile.update',
  'intake.list',
  'intake.conflict_check',
  'intake.decide',
  'inference.assist',
  'audit.list',
]);

export const PROHIBITED_OPERATIONS = Object.freeze([
  'referral.fee',
  'referral.commission',
  'fee.split',
  'ad.slot',
  'ad.sponsor',
  'lawyer.rank',
  'lawyer.recommend',
  'review.submit',
  'rating.submit',
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
      murakumoPath: DEFAULT_MURAKUMO_PATH,
      // Relay is staged/fail-closed by default until an independently verified endpoint is configured.
      relayEndpoint: null,
      locale: 'ja',
    },
    draft: null,
    sentInquiries: [],
    lawyerProfile: null,
    conflictLedger: [...DEFAULT_LOCAL_CONFLICT_LEDGER],
    intakeRecords: [],
    auditLog: [],
  };
}

export function createOperationsEngine({
  catalog = SYNTHETIC_CATALOG_BUNDLE.lawyers,
  state = createInitialLocalState(),
  broker = null,
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

  async function notifyChange() {
    if (typeof onStateChange === 'function') await onStateChange(state);
  }

  async function execute(operationName, params = {}, { actor = 'ui' } = {}) {
    if (PROHIBITED_OPERATIONS.includes(operationName)) {
      audit(actor, operationName, 'rejected', 'Prohibited by O2/O8/O9 structural invariant');
      await notifyChange();
      throw Object.assign(new Error('operation-prohibited-by-invariant'), { code: 'operation-prohibited-by-invariant', operation: operationName });
    }
    if (!CANONICAL_OPERATIONS.includes(operationName)) {
      throw Object.assign(new Error('unknown-operation'), { code: 'unknown-operation', operation: operationName });
    }

    const nowIso = now();

    switch (operationName) {
      case 'directory.search': {
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
        audit(actor, 'directory.search', 'ok', `Local neutral search (${results.length} results)`, {
          sort: params.sort ?? 'kana_asc',
          directoryScope: params.directoryScope ?? state.settings.directoryScope,
          localOnly: true,
        });
        await notifyChange();
        return {
          policy: ZERO_FEE_POLICY,
          localOnly: true,
          directoryScope: params.directoryScope ?? state.settings.directoryScope,
          sort: params.sort ?? 'kana_asc',
          total: results.length,
          lawyers: results,
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

      case 'inquiry.import_memo': {
        const imported = parseSoudanMemoExport(params.json ?? params.memo);
        if (params.lawyerId) imported.lawyerId = params.lawyerId;
        state.draft = imported;
        audit(actor, 'inquiry.import_memo', 'ok', 'Imported soudan.memo.export.v1 locally', {
          category: imported.category,
          evidenceCount: imported.evidenceHashes.length,
        });
        await notifyChange();
        return { draft: imported };
      }

      case 'inquiry.draft': {
        const draft = params.draft;
        const problems = validateInquiryDraft(draft);
        state.draft = { ...draft };
        audit(actor, 'inquiry.draft', problems.length ? 'validation_warning' : 'ok', 'Saved inquiry draft locally', {
          problemCount: problems.length,
        });
        await notifyChange();
        return { savedLocally: true, problems, draft: state.draft };
      }

      case 'inquiry.send': {
        const draft = params.draft ?? state.draft;
        const problems = validateInquiryDraft(draft);
        if (problems.length) {
          throw Object.assign(new Error('draft-invalid'), { code: 'draft-invalid', problems });
        }
        const lawyer = findLawyer(draft.lawyerId);
        if (!lawyer) throw Object.assign(new Error('lawyer-not-found'), { code: 'lawyer-not-found' });

        // O4 verification & HARD hold gate (enforced BEFORE consent or crypto)
        const demoMode = Boolean(params.syntheticDemoMode ?? state.settings.syntheticDemoMode);
        const gate = canSendToLawyer(lawyer, { syntheticDemoMode: demoMode, nowIso });
        if (!gate.allowed) {
          audit(actor, 'inquiry.send', 'blocked', `Blocked by O4 gate: ${gate.reason}`, {
            lawyerId: lawyer.id,
            effectiveStatus: gate.status.effectiveStatus,
            hardHold: gate.hardHold,
          });
          await notifyChange();
          throw Object.assign(new Error(gate.reason), { code: gate.reason, hardHold: gate.hardHold, status: gate.status });
        }

        if (!lawyer.e2ee_public_key_jwk) {
          throw Object.assign(new Error('lawyer-e2ee-key-missing'), { code: 'lawyer-e2ee-key-missing' });
        }

        // O8 E2EE encryption strictly on client BEFORE consent/dispatch
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
            evidenceHashes: draft.evidenceHashes || [],
          },
        });

        // Relay staged / fail-closed check: live relay fails closed unless verified endpoint configured
        const relayConfigured = Boolean(state.settings.relayEndpoint);
        const dryRun = params.dryRun !== false || !relayConfigured;
        if (params.requireLiveRelay === true && !relayConfigured) {
          audit(actor, 'inquiry.send', 'blocked', 'Relay staged/disabled (fail-closed)', { lawyerId: lawyer.id });
          await notifyChange();
          throw Object.assign(new Error('relay-staged-disabled'), { code: 'relay-staged-disabled' });
        }

        // Canonical broker each-operation consent gate
        if (!broker) {
          throw Object.assign(new Error('canonical-broker-required'), { code: 'canonical-broker-required' });
        }

        let dispatchResult;
        try {
          dispatchResult = await broker.invoke(INQUIRY_SEND_SELECTOR, {
            inquiryId,
            recipientLawyerId: lawyer.id,
            recipientName: lawyer.name,
            verificationStatus: gate.status.effectiveStatus,
            relayStatus: relayConfigured ? 'configured' : 'staged_dry_run_only',
            dryRun,
            envelope,
          });
        } catch (err) {
          audit(actor, 'inquiry.send', 'denied', 'Consent denied or broker blocked; 0 bytes sent', {
            lawyerId: lawyer.id,
            error: err?.message || 'denied',
          });
          await notifyChange();
          throw err;
        }

        const record = {
          inquiryId,
          lawyerId: lawyer.id,
          lawyerName: lawyer.name,
          barAssociation: lawyer.bar_association,
          verificationStatus: gate.status.effectiveStatus,
          sentAt: nowIso,
          dryRun,
          relayStatus: relayConfigured ? 'dispatched' : 'staged_local_dry_run',
          conflictHeader,
          envelope,
          replies: [],
          copyRetentionNotice: getLegalNotices(state.settings.locale).lawyerCopyRetention,
        };
        state.sentInquiries = [record, ...state.sentInquiries];
        audit(actor, 'inquiry.send', 'ok', dryRun ? 'E2EE inquiry dry-run envelope recorded after consent' : 'E2EE inquiry dispatched after consent', {
          inquiryId,
          lawyerId: lawyer.id,
          dryRun,
          aadSha256: envelope.aadSha256,
        });
        await notifyChange();
        return { record, dispatchResult };
      }

      case 'inquiry.list': {
        if (params.deleteInquiryId) {
          const before = state.sentInquiries.length;
          state.sentInquiries = state.sentInquiries.filter(r => r.inquiryId !== params.deleteInquiryId);
          if (state.sentInquiries.length !== before) {
            audit(actor, 'inquiry.list', 'deleted_local', 'Deleted local inquiry copy (lawyer copy unaffected)', {
              inquiryId: params.deleteInquiryId,
            });
            await notifyChange();
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
          audit(actor, 'lawyer.profile.update', 'rejected', `Rejected by O9/O4 validator (${problems.length} problems)`, {
            codes: problems.map(p => p.code),
          });
          await notifyChange();
          throw Object.assign(new Error('lawyer-profile-invalid'), { code: 'lawyer-profile-invalid', problems });
        }
        state.lawyerProfile = structuredClone(candidate);
        audit(actor, 'lawyer.profile.update', 'ok', 'Updated local factual lawyer profile', {
          lawyerId: candidate.id,
        });
        await notifyChange();
        return { savedLocally: true, profile: state.lawyerProfile };
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
        return { items, localOnly: true };
      }

      case 'intake.conflict_check': {
        const rec = state.intakeRecords.find(r => r.inquiryId === params.inquiryId);
        if (!rec) throw Object.assign(new Error('intake-not-found'), { code: 'intake-not-found' });
        const header = extractConflictHeader(rec);
        const check = runLocalConflictCheck(header, state.conflictLedger, { checkedAt: nowIso });
        const confirmed = Boolean(params.confirmClear === true && check.result === 'clear');
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
        await notifyChange();
        return {
          inquiryId: rec.inquiryId,
          conflictHeader: header,
          conflictCheck: rec.conflictCheck,
          revealGate: canRevealInquiryBody(rec),
        };
      }

      case 'intake.decide': {
        if (params.action === 'forward_to_firm' || params.forwardToFirmId) {
          audit(actor, 'intake.decide', 'rejected', 'Firm-to-firm forwarding is prohibited (O8)');
          await notifyChange();
          throw Object.assign(new Error('o8.firm_to_firm_forwarding_prohibited'), { code: 'o8.firm_to_firm_forwarding_prohibited' });
        }

        const rec = state.intakeRecords.find(r => r.inquiryId === params.inquiryId);
        if (!rec) throw Object.assign(new Error('intake-not-found'), { code: 'intake-not-found' });

        // AWAI-3235 HARD gate: block body reveal/decrypt or acceptance if conflict check is not cleared & confirmed
        const action = params.action || 'reveal';
        if (action === 'decline_conflict') {
          rec.decision = { status: 'declined_conflict', decidedAt: nowIso, note: 'Declined due to conflict check without viewing inquiry body.' };
          audit(actor, 'intake.decide', 'declined_conflict', 'Declined inquiry at conflict gate without decrypting body', {
            inquiryId: rec.inquiryId,
          });
          await notifyChange();
          return { inquiryId: rec.inquiryId, revealed: false, decision: rec.decision };
        }

        const gate = canRevealInquiryBody(rec);
        if (!gate.allowed) {
          audit(actor, 'intake.decide', 'blocked', `Blocked by conflict-check HARD gate: ${gate.reason}`, {
            inquiryId: rec.inquiryId,
          });
          await notifyChange();
          throw Object.assign(new Error(gate.reason), { code: gate.reason, hardGate: true });
        }

        if (action === 'reveal') {
          const privKey = params.recipientPrivateKeyJwk || (typeof getPrivateKeyJwk === 'function' ? await getPrivateKeyJwk() : null);
          if (!privKey) throw Object.assign(new Error('lawyer-private-key-unavailable'), { code: 'lawyer-private-key-unavailable' });
          const decrypted = await decryptEnvelope({ envelope: rec.envelope, recipientPrivateKeyJwk: privKey });
          audit(actor, 'intake.decide', 'revealed', 'Decrypted inquiry body on device after confirmed clear conflict check', {
            inquiryId: rec.inquiryId,
            receiptDigest: rec.conflictCheck.receiptDigest,
          });
          await notifyChange();
          return { inquiryId: rec.inquiryId, revealed: true, plaintext: decrypted, conflictCheck: rec.conflictCheck };
        }

        if (action === 'accept' || action === 'decline') {
          const replyText = typeof params.replyText === 'string' ? params.replyText.trim() : '';
          let replyDispatch = null;
          if (replyText && params.sendEncryptedReply !== false) {
            if (!broker) throw Object.assign(new Error('canonical-broker-required'), { code: 'canonical-broker-required' });
            const recipientPub = params.clientPublicKeyJwk || SYNTHETIC_CATALOG_BUNDLE.lawyers[0].e2ee_public_key_jwk;
            const replyEnvelope = await encryptEnvelope({
              recipientLawyerId: rec.inquiryId,
              recipientPublicKeyJwk: recipientPub,
              conflictHeader: rec.conflictHeader,
              plaintext: { decision: action, replyText, decidedAt: nowIso },
            });
            replyDispatch = await broker.invoke(INQUIRY_REPLY_SELECTOR, {
              inquiryId: rec.inquiryId,
              decision: action,
              dryRun: !state.settings.relayEndpoint,
              envelope: replyEnvelope,
            });
            rec.replySentAt = nowIso;
          }
          rec.decision = { status: action, decidedAt: nowIso, replySent: Boolean(replyDispatch) };
          audit(actor, 'intake.decide', action, `Recorded intake decision (${action})`, {
            inquiryId: rec.inquiryId,
            replySent: Boolean(replyDispatch),
          });
          await notifyChange();
          return { inquiryId: rec.inquiryId, decision: rec.decision, replyDispatch };
        }

        throw Object.assign(new Error('invalid-intake-action'), { code: 'invalid-intake-action' });
      }

      case 'inference.assist': {
        const rawText = typeof params.rawText === 'string' ? params.rawText.trim() : '';
        if (!rawText) throw Object.assign(new Error('inference.empty_input'), { code: 'inference.empty_input' });
        if (!broker) throw Object.assign(new Error('canonical-broker-required'), { code: 'canonical-broker-required' });

        const path = state.settings.murakumoPath || DEFAULT_MURAKUMO_PATH;
        const url = `${MURAKUMO_ORIGIN}${path}`;
        const requestBody = JSON.stringify({
          model: params.model || 'murakumo-neutral-intake-v1',
          temperature: 0,
          metadata: {
            non_retention: true,
            no_training: true,
            purpose: 'neutral_intake_structuring_only',
          },
          messages: [
            {
              role: 'system',
              content:
                'You are a neutral clerical intake formatter. Organize the user-provided facts into factual headings (summary, timeline, documents, counterparty). ' +
                'STRICTLY PROHIBITED: legal advice, legal judgment/verdict (法的判断・鑑定), probability of winning, recommending or ranking any lawyer, or inventing facts.',
            },
            {
              role: 'user',
              content: rawText.slice(0, 8000),
            },
          ],
        });

        let response;
        try {
          response = await broker.invoke(INFERENCE_SELECTOR, {
            input: url,
            init: {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: requestBody,
            },
          });
        } catch (err) {
          audit(actor, 'inference.assist', 'denied', 'User declined or broker blocked murakumo.cloud inference; 0 bytes sent', {
            error: err?.message || 'denied',
          });
          await notifyChange();
          throw err;
        }

        // Canonical broker returns { status, ok, headers, content } when response-body: 'text'.
        if (response && typeof response === 'object' && response.ok === false) {
          throw Object.assign(new Error('inference.http_error'), { code: 'inference.http_error', status: response.status });
        }
        let structuredText = '';
        if (typeof response === 'string') {
          structuredText = response;
        } else if (response && typeof response.content === 'string') {
          structuredText = response.content;
        } else if (response && typeof response.text === 'function') {
          structuredText = await response.text();
        } else if (response && typeof response.body === 'string') {
          structuredText = response.body;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(structuredText);
        } catch {
          parsed = { raw: structuredText };
        }
        const assistantContent = parsed?.choices?.[0]?.message?.content ?? parsed?.content ?? structuredText;

        audit(actor, 'inference.assist', 'ok', 'Completed murakumo.cloud neutral structuring assist after consent', {
          origin: MURAKUMO_ORIGIN,
          nonRetentionDisclosed: true,
        });
        await notifyChange();
        return {
          origin: MURAKUMO_ORIGIN,
          nonRetention: true,
          noLegalAdvice: true,
          structuredDraft: assistantContent,
        };
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
