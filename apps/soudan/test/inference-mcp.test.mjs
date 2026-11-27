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
  INFERENCE_OPERATION, INFERENCE_SELECTOR, REQUESTED_CAPABILITIES, SEND_OPERATION,
  SEND_SELECTOR, runtimeDescriptor,
} from '../src/operations.js';
import {
  createClientConsentHost, createClientOperationBroker,
} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';
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

  // P1 #2: MCP/agent soudan.draft.delete with confirm:true & confirmed:true MUST require human approval and NEVER delete.
  const delCall = await bridge.handleMessage({
    origin: 'https://host.itonami.app',
    data: {
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: {
        sessionId: 'sess-12345678',
        name: 'soudan.draft.delete',
        arguments: {id: 'draft-2', confirmed: true, confirm: true},
      },
    },
  });
  assert.equal(delCall.result.isError, true);
  assert.equal(delCall.result.structuredContent.state, 'consent.required');
  assert.equal(delCall.result.structuredContent.requiresHumanApproval, true);
  assert.equal(delCall.result.structuredContent.gateName, 'human-approval-required');
  assert.ok(delCall.result.content[0].text.includes('法的助言ではなく'));
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

test('Zone B-25 Z25-08: soudan.inference.organize without fresh each-operation approval fails closed with zero network calls and zero non-Murakumo fallback', async () => {
  let nowMs = 0;
  class FakeMouseEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
  const elements = [];
  const makeElement = tag => {
    const el = {
      tag, children: [], textContent: '', className: '', disabled: false, open: false, _listeners: new Map(),
      setAttribute() {},
      append(...kids) { el.children.push(...kids); },
      addEventListener(type, fn) { if (!el._listeners.has(type)) el._listeners.set(type, []); el._listeners.get(type).push(fn); },
      removeEventListener() {},
      focus() {},
      showModal() { el.open = true; },
      close() { if (!el.open) return; el.open = false; for (const fn of [...(el._listeners.get('close') ?? [])]) fn({type: 'close'}); },
      remove() {},
      get isConnected() { return true; },
    };
    elements.push(el);
    return el;
  };
  const doc = {body: makeElement('body'), createElement: makeElement, defaultView: {MouseEvent: FakeMouseEvent, performance: {now: () => nowMs}}};
  const fire = (el, type, event) => { event.currentTarget = el; for (const fn of [...(el._listeners.get(type) ?? [])]) fn(event); };
  const activeDialog = () => [...elements].reverse().find(e => e.tag === 'dialog' && e.open) ?? null;
  const waitForDialog = async () => {
    for (let i = 0; i < 40; i += 1) {
      const d = activeDialog();
      if (d) return d;
      await new Promise(r => setTimeout(r, 5));
    }
    return null;
  };
  const flatDialog = d => [...d.children].flatMap(c => [c, ...(c.children ?? [])]);
  const buttonByText = (d, text) => flatDialog(d).find(e => e.textContent === text && e.tag === 'button') ?? null;

  const fetchCalls = [];
  const prevDoc = globalThis.document;
  const prevFetch = globalThis.fetch;
  globalThis.document = doc;
  globalThis.fetch = async (input, init) => {
    const reqUrl = typeof input === 'string' ? input : input?.url ?? String(input);
    const reqMethod = init?.method ?? input?.method ?? 'GET';
    fetchCalls.push({url: reqUrl, method: reqMethod});
    const resp = new Response('data: {"choices":[{"delta":{"content":"整理結果"}}]}\n\ndata: [DONE]', {
      status: 200,
      headers: {'content-type': 'text/event-stream'},
    });
    Object.defineProperty(resp, 'url', {value: reqUrl});
    return resp;
  };

  try {
    const descriptor = runtimeDescriptor('ja');
    const consentHost = createClientConsentHost({document: doc, locale: 'ja'});
    const enabledCfg = {enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'mishima', maxTokens: 1024};

    // Case 1: Unapproved by governor (approvedOperations omits inference) -> zero network calls, local fail-closed fallback.
    const unapprovedBroker = createClientOperationBroker({
      runtime: descriptor,
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      approvedOperations: [SEND_OPERATION],
      hostSupportedOperations: [[INFERENCE_SELECTOR.capability, INFERENCE_SELECTOR.service, INFERENCE_SELECTOR.operation]],
      consentHost,
      app: {name: 'Soudan'},
    });
    const unapprovedStore = createSemanticStore({
      locale: 'ja',
      surface: 'web',
      broker: unapprovedBroker,
      inferenceConfig: enabledCfg,
    });
    await unapprovedStore.execute('soudan.draft.update', {patch: {summary: '未承認ドラフト'}}, {actor: {kind: 'human'}});
    const resUnapproved = await unapprovedStore.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
    assert.equal(resUnapproved.ok, true);
    assert.equal(resUnapproved.fallback, 'local');
    assert.equal(resUnapproved.proposal.source, 'local');
    assert.equal(fetchCalls.length, 0, 'unapproved operation must make zero external network calls');

    // Case 2: Approved in descriptor/host, but user denies each-operation consent -> zero network calls.
    const canonicalBroker = createClientOperationBroker({
      runtime: descriptor,
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      approvedOperations: descriptor.operations,
      hostSupportedOperations: [[INFERENCE_SELECTOR.capability, INFERENCE_SELECTOR.service, INFERENCE_SELECTOR.operation]],
      consentHost,
      app: {name: 'Soudan'},
    });
    const store = createSemanticStore({
      locale: 'ja',
      surface: 'web',
      broker: canonicalBroker,
      inferenceConfig: enabledCfg,
    });
    await store.execute('soudan.draft.update', {patch: {summary: '同意拒否テスト'}}, {actor: {kind: 'human'}});

    const deniedPromise = store.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
    const dlg1 = await waitForDialog();
    assert.ok(dlg1, 'canonical each-operation consent dialog must open before any inference network call');
    fire(buttonByText(dlg1, '許可しない'), 'click', {type: 'click', isTrusted: true});
    const deniedRes = await deniedPromise;
    assert.equal(deniedRes.ok, true);
    assert.equal(deniedRes.fallback, 'local');
    assert.equal(deniedRes.reason, 'consent-denied');
    assert.equal(fetchCalls.length, 0, 'denied consent must make zero external network calls');
    assert.equal(store.getState().audit.at(-1).gateName, 'user-consent-denied');

    // Case 3: Approving once reaches ONLY Murakumo, and a 2nd invocation STILL requires fresh each-operation approval.
    const approvedPromise = store.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
    const dlg2 = await waitForDialog();
    assert.ok(dlg2);
    nowMs += 1000;
    const allowBtn = buttonByText(dlg2, '許可する');
    fire(allowBtn, 'pointerdown', {type: 'pointerdown', isTrusted: true});
    fire(allowBtn, 'click', new FakeMouseEvent('click', {isTrusted: true}));
    const approvedRes = await approvedPromise;
    assert.equal(approvedRes.ok, true);
    assert.equal(approvedRes.proposal.source, 'murakumo.cloud');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, MURAKUMO_ENDPOINT_URL, 'network call must target pinned Murakumo URL only');

    // Second invocation without fresh approval (denied) makes ZERO additional network calls.
    const secondPromise = store.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
    const dlg3 = await waitForDialog();
    assert.ok(dlg3, 'second invocation must demand fresh each-operation consent');
    fire(buttonByText(dlg3, '許可しない'), 'click', {type: 'click', isTrusted: true});
    const secondRes = await secondPromise;
    assert.equal(secondRes.fallback, 'local');
    assert.equal(secondRes.reason, 'consent-denied');
    assert.equal(fetchCalls.length, 1, 'no additional network call without fresh approval');

    // Case 4: Non-Murakumo fallback endpoint is hard-blocked with zero network calls.
    const nonMurakumo = await store.execute('soudan.inference.organize', {
      config: {enabled: true, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'mishima'},
    }, {actor: {kind: 'human'}});
    assert.equal(nonMurakumo.ok, false);
    assert.equal(nonMurakumo.state, 'governor.blocked');
    assert.equal(nonMurakumo.gateName, 'forbidden-endpoint');
    assert.equal(fetchCalls.length, 1, 'non-Murakumo endpoint must never trigger a network call');
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    globalThis.fetch = prevFetch;
  }
});

test('Zone B-25 Z25-33: raw image bytes never cross soudan.memo.send or soudan.inference.organize, and both disclosures carry special-care metadata', async () => {
  // Both operations' disclosures must declare special-care: true, non-empty special-care-kinds, and withdrawal.
  for (const op of [SEND_OPERATION, INFERENCE_OPERATION]) {
    assert.equal(op.disclosure['special-care'], true);
    assert.ok(Array.isArray(op.disclosure['special-care-kinds']) && op.disclosure['special-care-kinds'].length > 0);
    assert.ok(typeof op.disclosure.withdrawal === 'string' && op.disclosure.withdrawal.trim().length > 0);
  }

  let brokerCalls = 0;
  const spyBroker = {
    async invoke() {
      brokerCalls += 1;
      return {shared: true};
    },
  };
  const enabledCfg = {enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'mishima', maxTokens: 1024};
  const store = createSemanticStore({
    locale: 'ja',
    surface: 'web',
    broker: spyBroker,
    inferenceConfig: enabledCfg,
  });

  // Draft containing raw data:image/ payload in summary
  await store.execute('soudan.draft.update', {
    patch: {
      jurisdiction: 'JPN',
      category: 'money',
      summary: '添付画像 data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      wish: '確認したい',
      name: '山田太郎',
      contact: 'taro@example.jp',
      recipient: {name: '鈴木花子', office: '鈴木法律事務所', contact: 'hanako@example.jp'},
    },
  }, {actor: {kind: 'human'}});

  // 1. soudan.memo.send MUST block raw image bytes before broker invocation
  const sendRes = await store.execute('soudan.memo.send', {mode: 'save-txt'}, {actor: {kind: 'human'}});
  assert.equal(sendRes.ok, false);
  assert.equal(sendRes.sent, false);
  assert.equal(sendRes.state, 'governor.blocked');
  assert.equal(sendRes.gateName, 'image-bytes-forbidden');

  // 2. soudan.inference.organize MUST block raw image bytes before broker invocation
  const infRes = await store.execute('soudan.inference.organize', {}, {actor: {kind: 'human'}});
  assert.equal(infRes.ok, false);
  assert.equal(infRes.state, 'governor.blocked');
  assert.equal(infRes.gateName, 'image-bytes-forbidden');

  assert.equal(brokerCalls, 0, 'raw image bytes must never reach the broker for send or inference');
});
