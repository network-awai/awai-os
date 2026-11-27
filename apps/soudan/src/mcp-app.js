// AWAI-4143 MCP Apps (SEP-1865) draft-alignment module for Soudan.
// NOTE: Draft alignment only — formal AWAI-4143 conformance waits on spec PR + catalog.list POC gate.
// Product UI MCP Apps interop only; never performs direct external X1/inference from iframe,
// and enforces the 2-app technical firewall (never passes Soudan context into Bengoshi args/URLs, never
// endorses/ranks lawyers). Non-UI MCP fallback (content + structuredContent) ALWAYS carries the fixed disclaimer.

import {SEMANTIC_OPERATIONS, createSemanticStore} from './semantic.js';
import {translator} from './messages.js';

export const MCP_RESOURCE_URI = 'ui://soudan/app';
export const MCP_MIME_TYPE = 'text/html;profile=mcp-app';
export const MCP_CONFORMANCE_STATUS = 'draft-alignment';

export const MCP_TOOLS = Object.freeze([
  Object.freeze({name: 'soudan.draft.create', description: 'Create a new on-device consultation memo draft.'}),
  Object.freeze({name: 'soudan.draft.select', description: 'Select an existing on-device consultation memo draft.'}),
  Object.freeze({name: 'soudan.draft.update', description: 'Update fields of the active on-device consultation memo draft.'}),
  Object.freeze({name: 'soudan.draft.delete', description: 'Request human-approved deletion of an on-device draft (always returns consent.required; agent calls cannot finalize deletion).'}),
  Object.freeze({name: 'soudan.evidence.add', description: 'Add a post evidence metadata row (URL/date/author/SHA-256 only; no raw image bytes).'}),
  Object.freeze({name: 'soudan.evidence.remove', description: 'Remove an evidence metadata row by index.'}),
  Object.freeze({name: 'soudan.memo.assemble', description: 'Assemble the fixed-template consultation memo with mandatory legal disclaimer.'}),
  Object.freeze({name: 'soudan.audit.list', description: 'List minimized local audit entries (no consultation text or PII).'}),
]);

export const MCP_APP_MANIFEST = Object.freeze({
  schema: 'itonami.mcp-app.draft.v1',
  conformance: MCP_CONFORMANCE_STATUS,
  resourceUri: MCP_RESOURCE_URI,
  mimeType: MCP_MIME_TYPE,
  title: 'Soudan — Self-organization consultation memo tool',
  titleJa: 'Soudan — 自己整理メモツール',
  tools: MCP_TOOLS,
  sandboxPolicy: Object.freeze({
    directExternalSendForbidden: true,
    directExternalInferenceForbidden: true,
    twoAppFirewall: true,
  }),
});

// 2-app technical firewall: block any attempt to forward Soudan memo/other-party/category into Bengoshi
// or request lawyer selection/endorsement through MCP tool arguments.
const FIREWALL_KEY_RE = /bengoshi|lawyer.?search|lawyer.?list|rank.?lawyer|recommend.?lawyer|auto.?pass/i;
function violatesTwoAppFirewall(name, args) {
  if (typeof name === 'string' && FIREWALL_KEY_RE.test(name)) return true;
  if (!args || typeof args !== 'object') return false;
  try {
    const raw = JSON.stringify(args);
    if (/bengoshi\.itonami\.app|network\.itonami\.bengoshi/i.test(raw)) return true;
    for (const k of Object.keys(args)) if (FIREWALL_KEY_RE.test(k)) return true;
  } catch {
    return true;
  }
  return false;
}

export function formatMcpToolResult(result, locale = 'ja') {
  const t = translator(locale);
  const disclaimer = t('disclaimer.fixed');
  const structuredContent = {
    ...result,
    disclaimer,
    resourceUri: MCP_RESOURCE_URI,
    conformance: MCP_CONFORMANCE_STATUS,
  };
  const summaryLines = [
    result?.ok ? `OK (${result.state ?? 'idle'})` : `BLOCKED/ERROR (${result?.gateName ?? result?.error ?? 'refused'})`,
    ...(result?.memo?.text ? [result.memo.text] : []),
    `[${disclaimer}]`,
  ];
  return {
    content: [{type: 'text', text: summaryLines.join('\n\n')}],
    structuredContent,
    isError: !result?.ok,
  };
}

export function createMcpAppBridge({
  store = null,
  locale = 'ja',
  allowedHostOrigins = [],
  postMessage = null,
} = {}) {
  const allowed = new Set(Array.isArray(allowedHostOrigins) ? allowedHostOrigins.filter(o => typeof o === 'string' && /^https?:\/\//.test(o)) : []);
  const semantic = store ?? createSemanticStore({locale, sandboxedIframe: true});
  let sessionId = null;
  let hostOrigin = null;
  let initialized = false;

  function emit(msg, origin) {
    if (typeof postMessage === 'function' && origin) postMessage(msg, origin);
  }

  function rpcError(id, code, message, data = undefined) {
    return {jsonrpc: '2.0', id: id ?? null, error: {code, message, ...(data ? {data} : {})}};
  }

  async function handleMessage(event) {
    const origin = event?.origin;
    if (!origin || !allowed.has(origin)) {
      return rpcError(event?.data?.id, -32001, 'untrusted-origin');
    }
    const msg = event?.data;
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg?.id, -32600, 'invalid-request');
    }

    if (msg.method === 'ui/initialize') {
      const sid = msg.params?.sessionId;
      if (typeof sid !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(sid)) {
        return rpcError(msg.id, -32602, 'invalid-session-id');
      }
      sessionId = sid;
      hostOrigin = origin;
      initialized = true;
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2025-11-25',
          conformance: MCP_CONFORMANCE_STATUS,
          resourceUri: MCP_RESOURCE_URI,
          mimeType: MCP_MIME_TYPE,
          sessionId,
          capabilities: {tools: MCP_TOOLS.map(tool => tool.name)},
          disclaimer: translator(locale)('disclaimer.fixed'),
        },
      };
      emit(response, origin);
      emit({
        jsonrpc: '2.0',
        method: 'ui/notifications/initialized',
        params: {sessionId, resourceUri: MCP_RESOURCE_URI, state: semantic.getUiState()},
      }, origin);
      return response;
    }

    if (!initialized || origin !== hostOrigin || msg.params?.sessionId !== sessionId) {
      return rpcError(msg.id, -32002, 'session-not-initialized-or-mismatch');
    }

    if (msg.method === 'tools/list') {
      const response = {jsonrpc: '2.0', id: msg.id, result: {tools: MCP_TOOLS, conformance: MCP_CONFORMANCE_STATUS}};
      emit(response, origin);
      return response;
    }

    if (msg.method === 'tools/call') {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      if (violatesTwoAppFirewall(name, args)) {
        const blocked = formatMcpToolResult({ok: false, state: 'governor.blocked', gateName: 'two-app-firewall'}, locale);
        const response = {jsonrpc: '2.0', id: msg.id, result: blocked};
        emit(response, origin);
        return response;
      }
      if (!SEMANTIC_OPERATIONS.includes(name)) {
        return rpcError(msg.id, -32601, 'tool-not-found');
      }
      const res = await semantic.execute(name, args, {actor: {kind: 'agent'}});
      const formatted = formatMcpToolResult(res, locale);
      const response = {jsonrpc: '2.0', id: msg.id, result: formatted};
      emit(response, origin);
      return response;
    }

    return rpcError(msg.id, -32601, 'method-not-found');
  }

  return Object.freeze({
    handleMessage,
    getSession: () => ({initialized, sessionId, hostOrigin}),
    manifest: MCP_APP_MANIFEST,
  });
}
