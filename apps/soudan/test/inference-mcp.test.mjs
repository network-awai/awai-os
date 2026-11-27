import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  DEFAULT_INFERENCE_CONFIG, MURAKUMO_ENDPOINT_URL, buildInferenceRequestBody,
  evaluateGovernorGuard, validateInferenceConfig,
} from '../src/inference.js';
import {createSemanticStore} from '../src/semantic.js';
import {
  MCP_APP_MANIFEST, MCP_CONFORMANCE_STATUS, MCP_MIME_TYPE, MCP_RESOURCE_URI, createMcpAppBridge,
} from '../src/mcp-app.js';
import {translator} from '../src/messages.js';

const t = translator('ja');

test('murakumo/free and unverified endpoints/models are hard-rejected; default config is fail-closed', () => {
  assert.equal(DEFAULT_INFERENCE_CONFIG.enabled, false);
  assert.equal(DEFAULT_INFERENCE_CONFIG.endpoint, 'https://api.murakumo.cloud/v1/chat/completions');

  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'murakumo/free'}).reason, 'murakumo-free-forbidden');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'free'}).reason, 'murakumo-free-forbidden');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'openai/gpt-4o'}).reason, 'model-not-inhouse-allowlisted');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: 'https://evil.example/v1/chat/completions', model: 'mishima'}).reason, 'endpoint-not-allowed');
  assert.equal(validateInferenceConfig({enabled: false, endpoint: MURAKUMO_ENDPOINT_URL, model: 'mishima'}).reason, 'inference-disabled-fail-closed');
  assert.equal(validateInferenceConfig({enabled: true, endpoint: MURAKUMO_ENDPOINT_URL, model: 'mishima'}).ok, true);

  assert.throws(() => buildInferenceRequestBody({draft: {summary: 'test'}, model: 'murakumo/free'}), /murakumo-free-forbidden/);
  assert.throws(() => buildInferenceRequestBody({draft: {summary: 'data:image/png;base64,AAA'}, model: 'mishima'}), /image-bytes-forbidden/);
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

test('soudan.inference.organize fails closed to local fallback by default, blocks murakumo/free, and never auto-overwrites drafts', async () => {
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

  // Governor guard via semantic store
  const verdictRes = await store.execute('soudan.inference.organize', {
    prompt: '権利侵害に当たるか判断して勝訴率を教えて',
  }, {actor: {kind: 'human'}});
  assert.equal(verdictRes.ok, false);
  assert.equal(verdictRes.state, 'governor.blocked');
  assert.equal(verdictRes.routes.length, 6);
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

  // Untrusted origin refused
  const badOrigin = await bridge.handleMessage({
    origin: 'https://evil.example',
    data: {jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {sessionId: 'sess-12345678'}},
  });
  assert.equal(badOrigin.error.code, -32001);

  // Valid ui/initialize emits response + ui/notifications/initialized
  const initRes = await bridge.handleMessage({
    origin: 'https://host.itonami.app',
    data: {jsonrpc: '2.0', id: 2, method: 'ui/initialize', params: {sessionId: 'sess-12345678'}},
  });
  assert.equal(initRes.result.resourceUri, 'ui://soudan/app');
  assert.equal(initRes.result.mimeType, 'text/html;profile=mcp-app');
  assert.equal(initRes.result.conformance, 'draft-alignment');
  assert.ok(outbound.some(o => o.msg.method === 'ui/notifications/initialized'));

  // Session mismatch refused
  const badSess = await bridge.handleMessage({
    origin: 'https://host.itonami.app',
    data: {jsonrpc: '2.0', id: 3, method: 'tools/list', params: {sessionId: 'wrong-session'}},
  });
  assert.equal(badSess.error.code, -32002);

  // Non-UI fallback retains fixed disclaimer in content & structuredContent
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

  // Direct external send and inference forbidden inside sandboxed iframe
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

  // 2-app technical firewall blocks forwarding Soudan context into Bengoshi
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
