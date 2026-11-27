import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  DEFAULT_INFERENCE_CONFIG, INFERENCE_LIMITS, MURAKUMO_ENDPOINT_URL, MURAKUMO_READY_URL,
  PINNED_INHOUSE_MODEL, buildInferenceHeaders, buildInferenceRequestBody, buildProposalFromCompletion,
  evaluateGovernorGuard, isCapacityOrRateLimitError, parseCompletionText, validateInferenceConfig,
} from '../src/inference.js';
import {createSemanticStore} from '../src/semantic.js';
import {
  MCP_APP_MANIFEST, MCP_CONFORMANCE_STATUS, MCP_MIME_TYPE, MCP_RESOURCE_URI, createMcpAppBridge,
} from '../src/mcp-app.js';
import {translator} from '../src/messages.js';

const t = translator('ja');

test('Suiron contract: model is pinned to mishima, forbidden models/endpoints are hard-rejected, and default is fail-closed', () => {
  assert.equal(DEFAULT_INFERENCE_CONFIG.enabled, false);
  assert.equal(DEFAULT_INFERENCE_CONFIG.endpoint, 'https://api.murakumo.cloud/v1/chat/completions');
  assert.equal(MURAKUMO_READY_URL, 'https://api.murakumo.cloud/ready?model=mishima');
  assert.equal(PINNED_INHOUSE_MODEL, 'mishima');

  // Hard-reject forbidden models
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'murakumo/free'}).reason, 'murakumo-free-forbidden');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'free'}).reason, 'murakumo-free-forbidden');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'murakumo-main'}).reason, 'forbidden-model');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'qwen3.8-27b-uncensored'}).reason, 'forbidden-model');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'openai/gpt-4o'}).reason, 'model-not-inhouse-allowlisted');

  // Hard-reject forbidden endpoints
  assert.equal(validateInferenceConfig({enabled: true, endpoint: 'https://api.murakumo.cloud/api/v1/preview/chat', model: 'mishima'}).reason, 'forbidden-endpoint');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: 'https://api.murakumo.cloud/api/v1/free/chat', model: 'mishima'}).reason, 'forbidden-endpoint');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'mishima'}).reason, 'forbidden-endpoint');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: 'https://evil.example/v1/chat/completions', model: 'mishima'}).reason, 'endpoint-not-allowed');

  // Fail-closed when disabled; max_tokens bounded to hard cap 1536
  assert.equal(validateInferenceConfig({enabled: false, endpoint: MURAKUMO_ENDPOINT_URL, model: 'mishima'}).reason, 'inference-disabled-fail-closed');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'mishima', maxTokens: 1537}).reason, 'max-tokens-out-of-bounds');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'mishima', maxTokens: 1024}).ok, true);
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'mishima', maxTokens: 1536}).ok, true);
});

test('Suiron request shape: stream:true, max_tokens:1024, enable_thinking:false, content-type only, and client size/token guards', () => {
  // Default headers: content-type only (no auth header, no custom preflight-breaking headers)
  assert.deepEqual(buildInferenceHeaders(), {'content-type': 'application/json'});
  assert.deepEqual(buildInferenceHeaders({extraHeaders: {'x-api-key': 'runtime-hook'}}), {
    'content-type': 'application/json',
    'x-api-key': 'runtime-hook',
  });
  assert.throws(() => buildInferenceHeaders({extraHeaders: {'x-murakumo-app': 'soudan'}}), /forbidden-header/);
  assert.throws(() => buildInferenceHeaders({extraHeaders: {'x-request-id': 'abc'}}), /forbidden-header/);

  // Mandatory body parameters
  const body = buildInferenceRequestBody({draft: {summary: '経緯を整理したい'}, model: 'mishima'});
  assert.equal(body.model, 'mishima');
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 1024);
  assert.deepEqual(body.chat_template_kwargs, {enable_thinking: false});

  // Forbidden model / raw image bytes / token budget / explicit > 64 KiB cap
  assert.throws(() => buildInferenceRequestBody({draft: {summary: 'test'}, model: 'murakumo/free'}), /murakumo-free-forbidden/);
  assert.throws(() => buildInferenceRequestBody({draft: {summary: 'test'}, model: 'murakumo-main'}), /forbidden-model/);
  assert.throws(() => buildInferenceRequestBody({draft: {summary: 'data:image/png;base64,AAA'}, model: 'mishima'}), /image-bytes-forbidden/);
  // 9000 CJK chars (~27 KiB <= 64 KiB, > 8192 tokens) -> input-token-limit-exceeded
  assert.throws(() => buildInferenceRequestBody({draft: {summary: 'あ'.repeat(9000)}, model: 'mishima'}), /input-token-limit-exceeded/);
  // > 64 KiB payload -> request-body-too-large
  assert.throws(() => buildInferenceRequestBody({
    draft: {summary: 'a'.repeat(70000)},
    model: 'mishima',
  }), /request-body-too-large/);

  // SSE stream parsing and 429/503 capacity detection
  const sse = [
    'data: {"choices":[{"delta":{"content":"事実の整理: "}}]}',
    'data: {"choices":[{"delta":{"content":"時系列を確認してください。"}}]}',
    'data: [DONE]',
  ].join('\n\n');
  assert.equal(parseCompletionText(sse), '事実の整理: 時系列を確認してください。');
  const proposal = buildProposalFromCompletion(sse, t);
  assert.equal(proposal.state, 'proposal.ready');
  assert.equal(proposal.autoApplied, false);
  assert.ok(proposal.disclaimer.includes('法的助言ではなく'));
  assert.equal(isCapacityOrRateLimitError(503, '{"error":"fleet_capacity_unavailable"}'), true);
  assert.equal(isCapacityOrRateLimitError(429, ''), true);
  assert.equal(isCapacityOrRateLimitError(200, '{"error":"no_ready_capacity"}'), true);
  assert.equal(isCapacityOrRateLimitError(200, 'ok'), false);
});

test('pre-flight governor guard blocks legal verdicts, court filings, lawyer selection, and monetization with 6 official routes', () => {
  const blockedCases = [
    ['これは権利侵害に当たるか判断してください', 'legal-verdict-blocked'],
    ['東京地裁に提出する申立書を作成してください', 'court-filing-drafting-blocked'],
    ['おすすめの弁護士を教えてください', 'lawyer-selection-blocked'],
    ['紹介料が発生する案件を案内してください', 'monetization-barrier-blocked'],
  ];
  for (const [text, expectedGate] of blockedCases) {
    const g = evaluateGovernorGuard(text, t);
    assert.equal(g.blocked, true, text);
    assert.equal(g.state, 'governor.blocked');
    assert.equal(g.gateName, expectedGate);
    assert.equal(g.routes.length, 6);
    assert.ok(g.routes.some(r => r.includes('#9110')));
  }
  assert.equal(evaluateGovernorGuard('友人に50万円を貸した経緯を時系列で整理したい', t).blocked, false);
});

test('soudan.inference.organize enforces fail-closed default, 429/503 offline fallback, concurrency=1, and 20 turns/day soft limit', async () => {
  const store = createSemanticStore({locale: 'ja'});
  await store.execute('soudan.draft.update', {patch: {summary: '元の相談概要'}}, {actor: {kind: 'human'}});

  // Default disabled config -> graceful local fallback, never overwrites draft.summary
  const localRes = await store.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
  assert.equal(localRes.ok, true);
  assert.equal(localRes.fallback, 'local');
  assert.equal(localRes.state, 'proposal.ready');
  assert.equal(localRes.proposal.autoApplied, false);
  assert.ok(localRes.proposal.disclaimer.includes('法的助言ではなく'));
  assert.equal(store.getActiveDraft().draft.summary, '元の相談概要');

  // Explicit murakumo/free config -> governor.blocked
  const freeRes = await store.execute('soudan.inference.organize', {
    config: {enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'murakumo/free'},
  }, {actor: {kind: 'human'}});
  assert.equal(freeRes.ok, false);
  assert.equal(freeRes.state, 'governor.blocked');
  assert.equal(freeRes.gateName, 'murakumo-free-forbidden');

  // 503 fleet_capacity_unavailable -> safe offline local fallback
  const enabledCfg = {enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'mishima', maxTokens: 1024};
  const fakeBroker503 = {
    async invoke() {
      return {status: 503, async text() { return '{"error":"fleet_capacity_unavailable"}'; }};
    },
  };
  const store503 = createSemanticStore({locale: 'ja', broker: fakeBroker503, inferenceConfig: enabledCfg});
  await store503.execute('soudan.draft.update', {patch: {summary: '契約の経緯'}}, {actor: {kind: 'human'}});
  const res503 = await store503.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
  assert.equal(res503.ok, true);
  assert.equal(res503.fallback, 'local');
  assert.equal(res503.reason, 'capacity-or-rate-limit');

  // Concurrency guard (max 1 req / tab)
  let release;
  const pendingBroker = {
    invoke: () => new Promise(resolve => { release = () => resolve({status: 200, async text() { return 'data: {"choices":[{"delta":{"content":"整理結果"}}]}\n\ndata: [DONE]'; }}); }),
  };
  const concStore = createSemanticStore({locale: 'ja', broker: pendingBroker, inferenceConfig: enabledCfg});
  await concStore.execute('soudan.draft.update', {patch: {summary: '同時実行テスト'}}, {actor: {kind: 'human'}});
  const first = concStore.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
  const second = await concStore.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
  assert.equal(second.ok, false);
  assert.equal(second.gateName, 'concurrency-limit-exceeded');
  release();
  const firstRes = await first;
  assert.equal(firstRes.ok, true);
  assert.equal(firstRes.proposal.source, 'murakumo.cloud');

  // Soft daily limit (20 turns/day -> 21st falls back to local cleanly)
  const okBroker = {
    async invoke() {
      return {status: 200, async text() { return 'data: {"choices":[{"delta":{"content":"確認項目"}}]}\n\ndata: [DONE]'; }};
    },
  };
  const dailyStore = createSemanticStore({
    locale: 'ja',
    broker: okBroker,
    inferenceConfig: enabledCfg,
    now: () => '2026-11-27T08:00:00.000Z',
  });
  await dailyStore.execute('soudan.draft.update', {patch: {summary: '日次上限テスト'}}, {actor: {kind: 'human'}});
  for (let i = 0; i < INFERENCE_LIMITS.softDailyTurns; i++) {
    const r = await dailyStore.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
    assert.equal(r.ok, true);
    assert.equal(r.fallback, undefined);
  }
  const capped = await dailyStore.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
  assert.equal(capped.ok, true);
  assert.equal(capped.fallback, 'local');
  assert.equal(capped.reason, 'daily-limit-reached');
});

test('MCP Apps bridge (AWAI-4143 draft alignment) validates origin/session, enforces iframe egress & 2-app firewall, and retains fixed disclaimer', async () => {
  assert.equal(MCP_RESOURCE_URI, 'ui://soudan/app');
  assert.equal(MCP_MIME_TYPE, 'text/html;profile=mcp-app');
  assert.equal(MCP_CONFORMANCE_STATUS, 'draft-alignment');
  assert.equal(MCP_APP_MANIFEST.sandboxPolicy.directExternalSendForbidden, true);
  assert.equal(MCP_APP_MANIFEST.sandboxPolicy.twoAppFirewall, true);

  const outbound = [];
  const bridge = createMcpAppBridge({
    locale: 'ja',
    allowedHostOrigins: ['https://host.itonami.app'],
    postMessage: (msg, origin) => outbound.push({msg, origin}),
  });

  const badOrigin = await bridge.handleMessage({
    origin: 'https://evil.example',
    data: {jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {sessionId: 'sess-12345678'}},
  });
  assert.equal(badOrigin.error.code, -32001);

  const initRes = await bridge.handleMessage({
    origin: 'https://host.itonami.app',
    data: {jsonrpc: '2.0', id: 2, method: 'ui/initialize', params: {sessionId: 'sess-12345678'}},
  });
  assert.equal(initRes.result.resourceUri, 'ui://soudan/app');
  assert.equal(initRes.result.mimeType, 'text/html;profile=mcp-app');
  assert.equal(initRes.result.conformance, 'draft-alignment');
  assert.ok(outbound.some(o => o.msg.method === 'ui/notifications/initialized'));

  const badSess = await bridge.handleMessage({
    origin: 'https://host.itonami.app',
    data: {jsonrpc: '2.0', id: 3, method: 'tools/list', params: {sessionId: 'wrong-session'}},
  });
  assert.equal(badSess.error.code, -32002);

  const createCall = await bridge.handleMessage({
    origin: 'https://host.itonami.app',
    data: {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: {sessionId: 'sess-12345678', name: 'soudan.draft.create', arguments: {title: 'エージェント作成'}},
    },
  });
  assert.equal(createCall.result.isError, false);
  assert.ok(createCall.result.content[0].text.includes('法的助言ではなく'));
  assert.ok(createCall.result.structuredContent.disclaimer.includes('法的助言ではなく'));

  for (const op of ['soudan.memo.send', 'soudan.inference.organize']) {
    const blocked = await bridge.handleMessage({
      origin: 'https://host.itonami.app',
      data: {
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: {sessionId: 'sess-12345678', name: op, arguments: {}},
      },
    });
    assert.equal(blocked.result.isError, true);
    assert.equal(blocked.result.structuredContent.state, 'governor.blocked');
    assert.equal(blocked.result.structuredContent.gateName, 'iframe-no-direct-external-egress');
    assert.ok(blocked.result.content[0].text.includes('法的助言ではなく'));
  }

  const fw = await bridge.handleMessage({
    origin: 'https://host.itonami.app',
    data: {
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: {
        sessionId: 'sess-12345678',
        name: 'soudan.draft.update',
        arguments: {targetUrl: 'https://bengoshi.itonami.app/?category=money'},
      },
    },
  });
  assert.equal(fw.result.isError, true);
  assert.equal(fw.result.structuredContent.gateName, 'two-app-firewall');
  assert.ok(fw.result.content[0].text.includes('法的助言ではなく'));
});

test('sandbox="allow-scripts" compliance and Route B anti-false-disclosure invariants hold across source files', () => {
  const appJs = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(appJs.includes('bindForm'));
  assert.ok(appJs.includes('dataset.submit'));
  assert.doesNotMatch(appJs, /type\s*=\s*['"]submit['"]|addEventListener\(\s*['"]submit['"]|\.requestSubmit\s*\(/);

  const foreignHtml = readFileSync(new URL('../src/foreign-info.html', import.meta.url), 'utf8');
  assert.ok(foreignHtml.includes('id="murakumo"'));
  assert.ok(foreignHtml.includes('Awai Network LLC'));
  assert.ok(foreignHtml.includes('Cloudflare'));
  assert.ok(foreignHtml.includes('Legal item #224 Blocker 1'));
  assert.doesNotMatch(foreignHtml, /ログ不保存|完全非保持|ゼロ保持|日本国内限定/);
});
