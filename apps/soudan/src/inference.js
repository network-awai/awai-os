// Soudan murakumo.cloud inference slot (soudan.inference.organize) — Legal Addendum Route B + Suiron Contract.
// Hard rules:
// - Synchronous POST https://api.murakumo.cloud/v1/chat/completions ONLY; readiness GET https://api.murakumo.cloud/ready?model=mishima.
// - Model pinned to "mishima" ONLY (no external fallback).
// - Hard-rejects forbidden models (murakumo/free, murakumo-main, qwen3.8-27b-uncensored, any free-tier/unpinned model)
//   and forbidden endpoints (/api/v1/preview/*, /api/v1/free/*, openrouter.ai).
// - Headers: content-type: application/json ONLY by default (no custom headers like x-murakumo-app / x-request-id
//   that fail CORS preflight; optional runtime-only authorization / x-api-key hook with zero embedded secrets).
// - Mandatory body params: model="mishima", stream=true, max_tokens=1024 (hard cap 1536),
//   chat_template_kwargs: { enable_thinking: false }.
// - Client-side guards: body <= 64 KiB, input+history <= 8192 estimated tokens, max concurrency 1 req/tab,
//   soft daily client limit 20 turns/day, safe offline local fallback on 429/503 (fleet_capacity_unavailable / no_ready_capacity).
// - Fail-closed (disabled) by default while in-house mishima & Legal item #224 blockers await approval.
// - Proposals NEVER auto-overwrite user drafts; human must explicitly accept or discard.

import {MURAKUMO_ORIGIN, MURAKUMO_PATH, MURAKUMO_PINNED_MODEL, MURAKUMO_READY_PATH} from './operations.js';

export const MURAKUMO_ENDPOINT_URL = MURAKUMO_ORIGIN + MURAKUMO_PATH;
export const MURAKUMO_READY_URL = `${MURAKUMO_ORIGIN}${MURAKUMO_READY_PATH}?model=${MURAKUMO_PINNED_MODEL}`;
export const PINNED_INHOUSE_MODEL = MURAKUMO_PINNED_MODEL;
export const INHOUSE_MODEL_ALLOWLIST = Object.freeze([PINNED_INHOUSE_MODEL]);

export const INFERENCE_LIMITS = Object.freeze({
  defaultMaxTokens: 1024,
  hardMaxTokens: 1536,
  maxRequestBytes: 65536, // 64 KiB
  maxInputTokens: 8192,
  maxConcurrencyPerTab: 1,
  softDailyTurns: 20,
});

const FORBIDDEN_MODELS = Object.freeze([
  'murakumo/free',
  'murakumo-main',
  'qwen3.8-27b-uncensored',
]);

const ALLOWED_REQUEST_HEADERS = new Set(['content-type', 'authorization', 'x-api-key']);

export const DEFAULT_INFERENCE_CONFIG = Object.freeze({
  enabled: false,
  endpoint: MURAKUMO_ENDPOINT_URL,
  readyEndpoint: MURAKUMO_READY_URL,
  model: PINNED_INHOUSE_MODEL,
  maxTokens: INFERENCE_LIMITS.defaultMaxTokens,
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

// Conservative token estimator (CJK ~1 char/token, ASCII ~3.5 chars/token -> upper bound safe).
export function estimateTokens(text) {
  if (typeof text !== 'string' || !text) return 0;
  let cjk = 0, ascii = 0;
  for (const ch of text) {
    if (ch.codePointAt(0) > 0x7f) cjk += 1;
    else ascii += 1;
  }
  return cjk + Math.ceil(ascii / 3.5);
}

// Hard-reject forbidden endpoints (/api/v1/preview/*, /api/v1/free/*, openrouter.ai, any non-pinned URL)
// and forbidden models (murakumo/free, murakumo-main, qwen3.8-27b-uncensored, any free/non-mishima model).
export function validateInferenceConfig(config) {
  if (!config || typeof config !== 'object') return {ok: false, reason: 'config-missing'};
  const endpoint = typeof config.endpoint === 'string' ? config.endpoint.trim() : '';
  if (/openrouter\.ai|\/api\/v1\/preview\/|\/api\/v1\/free\//i.test(endpoint)) {
    return {ok: false, reason: 'forbidden-endpoint'};
  }
  if (endpoint !== MURAKUMO_ENDPOINT_URL) {
    return {ok: false, reason: 'endpoint-not-allowed'};
  }
  const model = typeof config.model === 'string' ? config.model.trim() : '';
  if (!model) return {ok: false, reason: 'model-unconfigured'};
  const lower = model.toLowerCase();
  if (lower === 'murakumo/free' || /(?:^|\/)free(?:$|:|-)/i.test(model) || /free/i.test(model)) {
    return {ok: false, reason: 'murakumo-free-forbidden'};
  }
  if (FORBIDDEN_MODELS.includes(lower)) {
    return {ok: false, reason: 'forbidden-model'};
  }
  if (!INHOUSE_MODEL_ALLOWLIST.includes(model)) {
    return {ok: false, reason: 'model-not-inhouse-allowlisted'};
  }
  if (config.maxTokens !== undefined) {
    if (!Number.isSafeInteger(config.maxTokens) || config.maxTokens < 1 || config.maxTokens > INFERENCE_LIMITS.hardMaxTokens) {
      return {ok: false, reason: 'max-tokens-out-of-bounds'};
    }
  }
  if (config.enabled !== true) {
    return {ok: false, reason: 'inference-disabled-fail-closed'};
  }
  return {ok: true, reason: null};
}

// CORS-safe headers: content-type: application/json ONLY by default.
// Optional runtime auth hook may supply authorization OR x-api-key (never embedded in bundle).
// Rejects custom headers (x-murakumo-app, x-request-id, etc.) that fail CORS preflight.
export function buildInferenceHeaders({extraHeaders = null} = {}) {
  const headers = {'content-type': 'application/json'};
  if (extraHeaders && typeof extraHeaders === 'object') {
    for (const [k, v] of Object.entries(extraHeaders)) {
      const lower = k.toLowerCase();
      if (!ALLOWED_REQUEST_HEADERS.has(lower)) {
        throw Object.assign(Error(`forbidden-header:${lower}`), {code: 'forbidden-header'});
      }
      if (lower === 'content-type') continue;
      if (typeof v === 'string' && v.trim()) headers[lower] = v.trim();
    }
  }
  return headers;
}

export function buildInferenceRequestBody({
  draft,
  model = PINNED_INHOUSE_MODEL,
  maxTokens = INFERENCE_LIMITS.defaultMaxTokens,
  history = [],
  locale = 'ja',
}) {
  const check = validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model, maxTokens});
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
  const safeHistory = Array.isArray(history)
    ? history.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({role: m.role, content: m.content}))
    : [];
  const messages = [
    {role: 'system', content: systemPrompt},
    ...safeHistory,
    {role: 'user', content: textPayload},
  ];
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (totalTokens > INFERENCE_LIMITS.maxInputTokens) {
    throw Object.assign(Error('input-token-limit-exceeded'), {code: 'input-token-limit-exceeded'});
  }
  const body = {
    model: PINNED_INHOUSE_MODEL,
    stream: true,
    max_tokens: maxTokens,
    temperature: 0,
    chat_template_kwargs: {enable_thinking: false},
    messages,
  };
  const byteLen = new TextEncoder().encode(JSON.stringify(body)).length;
  if (byteLen > INFERENCE_LIMITS.maxRequestBytes) {
    throw Object.assign(Error('request-body-too-large'), {code: 'request-body-too-large'});
  }
  return body;
}

export function isCapacityOrRateLimitError(status, bodyText = '') {
  if (status === 429 || status === 503) return true;
  if (typeof bodyText === 'string' && /fleet_capacity_unavailable|no_ready_capacity/i.test(bodyText)) return true;
  return false;
}

// Parse either an OpenAI-compatible SSE stream (stream: true) or a single JSON completion object.
export function parseCompletionText(raw) {
  if (raw && typeof raw === 'object') {
    const content = raw?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      return typeof obj?.choices?.[0]?.message?.content === 'string' ? obj.choices[0].message.content : '';
    } catch {
      return '';
    }
  }
  // SSE data: lines
  const parts = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const chunk = JSON.parse(payload);
      const delta = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content;
      if (typeof delta === 'string') parts.push(delta);
    } catch {}
  }
  return parts.join('');
}

// 100% offline/local self-organization fallback (when inference is disabled, offline, 429/503, daily limit, or consent declined).
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

export function buildProposalFromCompletion(rawResponse, t) {
  const content = parseCompletionText(rawResponse);
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
