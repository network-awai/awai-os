// Soudan murakumo.cloud inference slot (soudan.inference.organize) — Legal Addendum Route B.
// Hard rules:
// - Synchronous POST https://api.murakumo.cloud/v1/chat/completions ONLY.
// - NEVER target murakumo/free or any free-tier/external logging model (Dev #219/#220).
// - Fail-closed (disabled) by default while in-house mishima is 503 & Legal item #224 blockers await approval.
// - Client-side pre-flight governor guard blocks legal verdicts, court filing drafting,
//   lawyer selection/endorsement, and monetization/referral requests -> state 'governor.blocked' + 6 official routes.
// - Proposals NEVER auto-overwrite user drafts; human must explicitly accept or discard.
// - Raw screenshot image bytes are strictly rejected.

import {MURAKUMO_ORIGIN, MURAKUMO_PATH} from './operations.js';

export const MURAKUMO_ENDPOINT_URL = MURAKUMO_ORIGIN + MURAKUMO_PATH;
export const INHOUSE_MODEL_ALLOWLIST = Object.freeze([
  'mishima',
  'murakumo/mishima',
  'kotoba/mishima',
]);

export const DEFAULT_INFERENCE_CONFIG = Object.freeze({
  enabled: false,
  endpoint: MURAKUMO_ENDPOINT_URL,
  model: null,
  status: 'fail-closed-pending-prelaunch-blockers',
});

export const OFFICIAL_ROUTE_KEYS = Object.freeze([
  'guide.route.1',
  'guide.route.2',
  'guide.route.3',
  'guide.route.4',
  'guide.route.5',
  'guide.route.6',
]);

// Client-side pre-flight governor guard (Attorney Act Art. 72/74, Judicial Scrivener Act Art. 73, ADR 0001 D1/D2/D9).
const GUARD_RULES = Object.freeze([
  Object.freeze({
    gateName: 'legal-verdict-blocked',
    patterns: [
      /権利侵害に当たるか(?:判断|判定)|違法(?:か|かどうか)(?:判断|判定)|勝訴(?:率|できるか|見込み)|開示が認められるか(?:判断|判定)|法的判断をして/u,
      /\b(?:legal\s+verdict|is\s+this\s+infring|win\s+rate|likelihood\s+of\s+winning|give\s+me\s+legal\s+advice)\b/i,
    ],
  }),
  Object.freeze({
    gateName: 'court-filing-drafting-blocked',
    patterns: [
      /(?:訴状|申立書|告訴状|答弁書|準備書面|登記申請書|内容証明郵便|請求書)(?:の文面)?を(?:作成|書いて|作って|起案)/u,
      /\b(?:draft\s+(?:a\s+)?(?:petition|complaint|lawsuit|filing|motion)|write\s+a\s+court\s+filing)\b/i,
    ],
  }),
  Object.freeze({
    gateName: 'lawyer-selection-blocked',
    patterns: [
      /(?:おすすめ|人気|評判|口コミ|星|一番いい).{0,10}弁護士|弁護士(?:の|を)?(?:ランキング|おすすめ|選定|推薦|紹介|あっせん|マッチング)|どの弁護士がいい/u,
      /\b(?:best\s+lawyer|top\s+lawyers|lawyer\s+match|select\s+a\s+lawyer|pick\s+a\s+lawyer|endorse\s+a\s+lawyer)\b/i,
    ],
  }),
  Object.freeze({
    gateName: 'monetization-barrier-blocked',
    patterns: [
      /(?:紹介料|あっせん料|アフィリエイト|スポンサー枠|有料プラン誘導|課金誘導)/u,
      /\b(?:referral\s+fee|paid\s+placement|sponsored\s+lawyer|affiliate\s+fee)\b/i,
    ],
  }),
]);

export function evaluateGovernorGuard(inputText, t = null) {
  const sample = typeof inputText === 'string' ? inputText : '';
  for (const rule of GUARD_RULES) {
    if (rule.patterns.some(re => re.test(sample))) {
      return {
        blocked: true,
        state: 'governor.blocked',
        gateName: rule.gateName,
        routes: t ? OFFICIAL_ROUTE_KEYS.map(k => t(k)) : [...OFFICIAL_ROUTE_KEYS],
      };
    }
  }
  return {blocked: false, state: 'idle', gateName: null, routes: []};
}

// Hard-reject murakumo/free, any free-tier model, non-allowlisted models, or unverified endpoints.
export function validateInferenceConfig(config) {
  if (!config || typeof config !== 'object') return {ok: false, reason: 'config-missing'};
  if (config.endpoint !== MURAKUMO_ENDPOINT_URL) return {ok: false, reason: 'endpoint-not-allowed'};
  const model = typeof config.model === 'string' ? config.model.trim() : '';
  if (!model) return {ok: false, reason: 'model-unconfigured'};
  if (/(?:^|\/)free(?:$|:|-)/i.test(model) || model.toLowerCase() === 'murakumo/free' || /free/i.test(model)) {
    return {ok: false, reason: 'murakumo-free-forbidden'};
  }
  if (!INHOUSE_MODEL_ALLOWLIST.includes(model)) {
    return {ok: false, reason: 'model-not-inhouse-allowlisted'};
  }
  if (config.enabled !== true) {
    return {ok: false, reason: 'inference-disabled-fail-closed'};
  }
  return {ok: true, reason: null};
}

export function buildInferenceRequestBody({draft, model, locale = 'ja'}) {
  const check = validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model});
  if (!check.ok) throw Object.assign(Error(check.reason), {code: check.reason});
  const textPayload = JSON.stringify({
    category: draft?.category ?? null,
    summary: String(draft?.summary ?? '').trim(),
    timeline: Array.isArray(draft?.timeline) ? draft.timeline.map(e => ({date: String(e?.date ?? ''), event: String(e?.event ?? '').trim()})) : [],
    wish: String(draft?.wish ?? '').trim(),
    deadline: String(draft?.deadline ?? '').trim(),
    documents: Array.isArray(draft?.documents) ? draft.documents.map(x => String(x ?? '').trim()).filter(Boolean) : [],
    evidenceCount: Array.isArray(draft?.evidence) ? draft.evidence.length : 0,
  });
  if (/data:image\//i.test(textPayload)) throw Object.assign(Error('image-bytes-forbidden'), {code: 'image-bytes-forbidden'});
  const systemPrompt = locale === 'en'
    ? 'Organize the user memo into factual bullet points, timeline gaps, and questions to ask a lawyer. Never give legal advice, legal verdicts, infringement judgments, court filings, or lawyer suggestions.'
    : '相談前メモを事実の整理・時系列の抜け漏れ確認・弁護士へ聞く質問項目に整理してください。法的助言、権利侵害や勝訴の判断、申立書等の起案、弁護士の選定・推薦は一切行わないでください。';
  return {
    model,
    temperature: 0,
    stream: false,
    messages: [
      {role: 'system', content: systemPrompt},
      {role: 'user', content: textPayload},
    ],
  };
}

// 100% offline/local self-organization fallback (when inference is disabled, offline, or consent declined).
export function organizeLocally(draft, t) {
  const summary = String(draft?.summary ?? '').trim();
  const timeline = Array.isArray(draft?.timeline) ? draft.timeline.filter(e => e?.event?.trim()) : [];
  const docs = Array.isArray(draft?.documents) ? draft.documents.filter(x => typeof x === 'string' && x.trim()) : [];
  const evidenceCount = Array.isArray(draft?.evidence) ? draft.evidence.length : 0;
  const lines = [];
  if (summary) lines.push(`・${t('field.summary')}: ${summary}`);
  if (timeline.length) {
    lines.push(`・${t('field.timeline')} (${timeline.length})`);
    for (const e of timeline) lines.push(`  - ${(e.date ? e.date + ' ' : '') + e.event.trim()}`);
  }
  if (draft?.wish?.trim()) lines.push(`・${t('field.wish')}: ${draft.wish.trim()}`);
  if (docs.length) lines.push(`・${t('field.documents')}: ${docs.join(' / ')}`);
  if (evidenceCount > 0) lines.push(`・${t('memo.evidence')}: ${evidenceCount}`);
  return {
    source: 'local',
    state: 'proposal.ready',
    suggestedSummary: lines.join('\n'),
    disclaimer: t('disclaimer.fixed'),
    autoApplied: false,
  };
}

export function buildProposalFromCompletion(responseJson, t) {
  const content = responseJson?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw Object.assign(Error('empty-inference-response'), {code: 'empty-inference-response'});
  }
  const guard = evaluateGovernorGuard(content, t);
  if (guard.blocked) return guard;
  return {
    source: 'murakumo.cloud',
    state: 'proposal.ready',
    suggestedSummary: content.trim().slice(0, 2000),
    disclaimer: t('disclaimer.fixed'),
    autoApplied: false,
  };
}
