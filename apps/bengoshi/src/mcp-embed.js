// MCP Apps (SEP-1865 APP-01..APP-04) sandboxed embedded handler for `embed.mcp`.
// - APP-01: Strict initialization handshake (`ui/initialize` -> `ui/notifications/initialized`).
//           Rejects any tool/resource call before initialization completes.
// - APP-02: Strict origin and session token verification (never wildcard `*`, rejects mismatched origin/session).
// - APP-03: Strictly read-only allowlist (`directory.search`, `lawyer.get` only); rejects ALL write/send/intake/inference ops.
// - APP-04: Synthetic fixture data only; strips any private/secret/PII keys before returning.

import { SYNTHETIC_CATALOG_BUNDLE } from './fixtures.js';
import { filterAndSortLawyers, evaluateVerificationStatus, ZERO_FEE_POLICY } from './model.js';

export const MCP_EMBED_PROTOCOL_VERSION = '2026-01-26';
export const MCP_EMBED_READ_ONLY_TOOLS = Object.freeze(['directory.search', 'lawyer.get']);

const STRIPPED_PRIVATE_KEYS = new Set([
  'privateKeyJwk',
  'encryptionPrivateKey',
  'localDrafts',
  'sentHistory',
  'conflictLedger',
  'auditLog',
]);

function sanitizePublicLawyer(lawyer) {
  const out = {};
  for (const [k, v] of Object.entries(lawyer)) {
    if (STRIPPED_PRIVATE_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function createMcpEmbedBridge({
  allowedOrigin,
  expectedSessionToken = null,
  catalog = SYNTHETIC_CATALOG_BUNDLE.lawyers,
  now = () => new Date().toISOString(),
  postReply = null,
} = {}) {
  if (typeof allowedOrigin !== 'string' || !/^https?:\/\/[^*\s]+$/.test(allowedOrigin)) {
    throw new TypeError('mcp-embed-explicit-allowed-origin-required');
  }

  let phase = 'uninitialized'; // uninitialized -> initializing -> ready
  let activeSessionToken = expectedSessionToken;

  function jsonRpcError(id, code, message, data = undefined) {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: data === undefined ? { code, message } : { code, message, data },
    };
  }

  function jsonRpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  function handleMessage(event) {
    const origin = event?.origin;
    const msg = event?.data;

    // APP-02: Strict origin verification
    if (origin !== allowedOrigin) {
      return jsonRpcError(msg?.id, -32001, 'untrusted-origin', { expectedOrigin: allowedOrigin });
    }

    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return jsonRpcError(msg?.id, -32600, 'invalid-jsonrpc-request');
    }

    // APP-02: Session verification (when configured)
    if (activeSessionToken) {
      const provided = msg.params?.sessionToken ?? msg.meta?.sessionToken ?? event?.sessionToken;
      if (provided !== activeSessionToken) {
        return jsonRpcError(msg.id, -32002, 'invalid-session-token');
      }
    }

    // APP-01: Handshake stage 1 (`ui/initialize`)
    if (msg.method === 'ui/initialize') {
      if (phase !== 'uninitialized') {
        return jsonRpcError(msg.id, -32000, 'already-initialized');
      }
      phase = 'initializing';
      const reply = jsonRpcResult(msg.id, {
        protocolVersion: MCP_EMBED_PROTOCOL_VERSION,
        appId: 'network.itonami.bengoshi',
        view: 'embed.mcp',
        readOnly: true,
        syntheticFixturesOnly: true,
        policy: ZERO_FEE_POLICY,
        capabilities: {
          tools: [...MCP_EMBED_READ_ONLY_TOOLS],
          writeAllowed: false,
        },
      });
      if (typeof postReply === 'function') postReply(reply, allowedOrigin);
      return reply;
    }

    // APP-01: Handshake stage 2 (`ui/notifications/initialized`)
    if (msg.method === 'ui/notifications/initialized') {
      if (phase !== 'initializing') {
        return jsonRpcError(msg.id, -32000, 'initialize-required-first');
      }
      phase = 'ready';
      return null; // Notification has no JSON-RPC response
    }

    // APP-01: Reject ANY other call prior to ready state
    if (phase !== 'ready') {
      return jsonRpcError(msg.id, -32000, 'not-initialized', { phase });
    }

    if (msg.method === 'tools/list') {
      const reply = jsonRpcResult(msg.id, {
        tools: [
          {
            name: 'directory.search',
            description: 'Read-only neutral search over local synthetic lawyer fixtures',
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          {
            name: 'lawyer.get',
            description: 'Read-only factual profile lookup over local synthetic lawyer fixtures',
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
        ],
      });
      if (typeof postReply === 'function') postReply(reply, allowedOrigin);
      return reply;
    }

    if (msg.method === 'tools/call') {
      const toolName = msg.params?.name;
      const args = msg.params?.arguments || {};

      // APP-03: Strictly read-only allowlist
      if (!MCP_EMBED_READ_ONLY_TOOLS.includes(toolName)) {
        const err = jsonRpcError(msg.id, -32003, 'unauthorized-write-or-disallowed-operation', {
          tool: toolName,
          allowed: [...MCP_EMBED_READ_ONLY_TOOLS],
        });
        if (typeof postReply === 'function') postReply(err, allowedOrigin);
        return err;
      }

      const nowIso = now();
      try {
        if (toolName === 'directory.search') {
          // APP-04: Synthetic fixtures only
          const syntheticOnly = catalog.filter(l => l.synthetic === true);
          const list = filterAndSortLawyers(syntheticOnly, {
            query: args.query ?? '',
            prefectureCode: args.prefectureCode ?? '',
            practiceArea: args.practiceArea ?? '',
            language: args.language ?? '',
            legalAidHouterasu: args.legalAidHouterasu ?? null,
            verificationStatus: args.verificationStatus ?? '',
            sort: args.sort ?? 'kana_asc',
            directoryScope: args.directoryScope ?? 'neutral_cross_firm',
            nowIso,
          }).map(sanitizePublicLawyer);
          const reply = jsonRpcResult(msg.id, {
            syntheticOnly: true,
            policy: ZERO_FEE_POLICY,
            total: list.length,
            lawyers: list,
          });
          if (typeof postReply === 'function') postReply(reply, allowedOrigin);
          return reply;
        }

        if (toolName === 'lawyer.get') {
          const id = args.lawyerId ?? args.id;
          const found = catalog.find(l => l.synthetic === true && l.id === id);
          if (!found) {
            const err = jsonRpcError(msg.id, -32004, 'lawyer-not-found');
            if (typeof postReply === 'function') postReply(err, allowedOrigin);
            return err;
          }
          const reply = jsonRpcResult(msg.id, {
            syntheticOnly: true,
            policy: ZERO_FEE_POLICY,
            lawyer: sanitizePublicLawyer({
              ...found,
              evaluatedVerification: evaluateVerificationStatus(found.verification, nowIso),
            }),
          });
          if (typeof postReply === 'function') postReply(reply, allowedOrigin);
          return reply;
        }
      } catch (e) {
        const err = jsonRpcError(msg.id, -32602, e?.code || e?.message || 'invalid-params');
        if (typeof postReply === 'function') postReply(err, allowedOrigin);
        return err;
      }
    }

    return jsonRpcError(msg.id, -32601, 'method-not-found', { method: msg.method });
  }

  return Object.freeze({
    getPhase: () => phase,
    handleMessage,
  });
}
