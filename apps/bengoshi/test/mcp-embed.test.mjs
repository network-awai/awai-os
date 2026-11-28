import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpEmbedBridge, MCP_EMBED_READ_ONLY_TOOLS } from '../src/mcp-embed.js';
import { SYNTHETIC_CATALOG_BUNDLE } from '../src/fixtures.js';

const ORIGIN = 'https://host.itonami.app';
const TOKEN = 'sep1865-test-session-token';
const NOW = '2026-11-27T09:00:00Z';

test('APP-01: rejects tools/list and tools/call prior to ui/initialize + ui/notifications/initialized and marks POC/Draft', () => {
  const bridge = createMcpEmbedBridge({ allowedOrigin: ORIGIN, expectedSessionToken: TOKEN, now: () => NOW });

  const preCall = bridge.handleMessage({
    origin: ORIGIN,
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { sessionToken: TOKEN, name: 'directory.search', arguments: {} } },
  });
  assert.equal(preCall.error.code, -32000);
  assert.equal(preCall.error.message, 'not-initialized');

  const initResp = bridge.handleMessage({
    origin: ORIGIN,
    data: { jsonrpc: '2.0', id: 2, method: 'ui/initialize', params: { sessionToken: TOKEN } },
  });
  assert.equal(initResp.result.readOnly, true);
  assert.equal(initResp.result.status, 'poc-draft');
  assert.equal(initResp.result.formalAwai4143Claim, false);
  assert.equal(bridge.getPhase(), 'initializing');

  const midCall = bridge.handleMessage({
    origin: ORIGIN,
    data: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: { sessionToken: TOKEN } },
  });
  assert.equal(midCall.error.message, 'not-initialized');
});

test('APP-02: rejects wildcard origin configuration, untrusted origin, invalid JSON-RPC, and bad session token', () => {
  assert.throws(() => createMcpEmbedBridge({ allowedOrigin: '*' }), /explicit-allowed-origin-required/);

  const bridge = createMcpEmbedBridge({ allowedOrigin: ORIGIN, expectedSessionToken: TOKEN, now: () => NOW });
  const badOrigin = bridge.handleMessage({
    origin: 'https://evil.example',
    data: { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { sessionToken: TOKEN } },
  });
  assert.equal(badOrigin.error.code, -32001);
  assert.equal(badOrigin.error.message, 'untrusted-origin');

  const badToken = bridge.handleMessage({
    origin: ORIGIN,
    data: { jsonrpc: '2.0', id: 2, method: 'ui/initialize', params: { sessionToken: 'wrong' } },
  });
  assert.equal(badToken.error.code, -32002);
  assert.equal(badToken.error.message, 'invalid-session-token');

  const badMsg = bridge.handleMessage({ origin: ORIGIN, data: { invalid: true } });
  assert.equal(badMsg.error.code, -32600);
});

test('APP-01 fallback + APP-03 & APP-04: non-UI content & structuredContent include Art. 9 + neutral disclaimer + agent guard, synthetic only, read-only', () => {
  const replies = [];
  const bridge = createMcpEmbedBridge({
    allowedOrigin: ORIGIN,
    expectedSessionToken: TOKEN,
    catalog: [
      ...SYNTHETIC_CATALOG_BUNDLE.lawyers,
      { ...SYNTHETIC_CATALOG_BUNDLE.lawyers[0], id: 'real-non-synthetic', synthetic: false, privateKeyJwk: { d: 'SECRET' } },
    ],
    now: () => NOW,
    postReply: (r, target) => replies.push({ r, target }),
  });

  bridge.handleMessage({ origin: ORIGIN, data: { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { sessionToken: TOKEN } } });
  bridge.handleMessage({ origin: ORIGIN, data: { jsonrpc: '2.0', method: 'ui/notifications/initialized', params: { sessionToken: TOKEN } } });
  assert.equal(bridge.getPhase(), 'ready');

  const search = bridge.handleMessage({
    origin: ORIGIN,
    data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { sessionToken: TOKEN, name: 'directory.search', arguments: { sort: 'kana_asc' } } },
  });
  assert.equal(search.result.syntheticOnly, true);
  assert.equal(search.result.total, 6);
  assert.equal(search.result.structuredContent.art9FieldsPresent, true);
  assert.ok(Array.isArray(search.result.content) && search.result.content[0].type === 'text');
  assert.match(search.result.content[0].text, /氏名:/);
  assert.match(search.result.content[0].text, /所属弁護士会:/);
  assert.match(search.result.content[0].text, /プレビュー版/);
  assert.match(search.result.content[0].text, /\[AGENT_GUARD\]/);
  assert.ok(!search.result.lawyers.some(l => l.id === 'real-non-synthetic'));
  assert.ok(!JSON.stringify(search).includes('SECRET'));

  const got = bridge.handleMessage({
    origin: ORIGIN,
    data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { sessionToken: TOKEN, name: 'lawyer.get', arguments: { lawyerId: 'syn-lawyer-990001' } } },
  });
  assert.equal(got.result.lawyer.registration_number, '990001');
  assert.equal(got.result.structuredContent.art9FieldsPresent, true);
  assert.match(got.result.content[0].text, /佐藤 遥/);
  assert.match(got.result.content[0].text, /大阪弁護士会/);
  assert.match(got.result.content[0].text, /\[AGENT_GUARD\]/);

  const nonSyn = bridge.handleMessage({
    origin: ORIGIN,
    data: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { sessionToken: TOKEN, name: 'lawyer.get', arguments: { lawyerId: 'real-non-synthetic' } } },
  });
  assert.equal(nonSyn.error.code, -32004);

  assert.deepEqual(MCP_EMBED_READ_ONLY_TOOLS, ['directory.search', 'lawyer.get']);
  for (const forbidden of ['inquiry.send', 'inquiry.draft', 'lawyer.profile.update', 'intake.list', 'intake.decide', 'inference.assist', 'audit.list']) {
    const res = bridge.handleMessage({
      origin: ORIGIN,
      data: { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { sessionToken: TOKEN, name: forbidden, arguments: {} } },
    });
    assert.equal(res.error.code, -32003, `Must reject ${forbidden}`);
    assert.equal(res.error.message, 'unauthorized-write-or-disallowed-operation');
  }

  assert.ok(replies.length > 0);
  assert.ok(replies.every(x => x.target === ORIGIN));
});
