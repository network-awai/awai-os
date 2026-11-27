// Shared MCP & ACP (Agent Client Protocol) adapter for Bengoshi (network.itonami.bengoshi).
// Wraps the exact same `noun.verb` operations engine used by the Web/Tauri UI.

import { CANONICAL_OPERATIONS, createOperationsEngine } from './operations.js';
import { ZERO_FEE_POLICY, NEUTRAL_SORTS, DIRECTORY_SCOPES } from './model.js';

export const TOOL_SCHEMAS = Object.freeze([
  {
    name: 'directory.search',
    description: 'Search the local signed lawyer directory with neutral filters and neutral sorting only (O9). Zero tracking.',
    readOnly: true,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        prefectureCode: { type: 'string' },
        practiceArea: { type: 'string' },
        language: { type: 'string' },
        legalAidHouterasu: { type: 'boolean' },
        verificationStatus: { type: 'string', enum: ['verified_manual_a2', 'unverified_self_declared', 'expired', 'suspended_or_revoked'] },
        sort: { type: 'string', enum: [...NEUTRAL_SORTS], default: 'kana_asc' },
        directoryScope: { type: 'string', enum: [...DIRECTORY_SCOPES], default: 'tenant_only' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'lawyer.get',
    description: 'Retrieve factual lawyer profile and evaluated O4 qualification status.',
    readOnly: true,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      required: ['lawyerId'],
      properties: { lawyerId: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'qualification.verify_status',
    description: 'Evaluate O4 qualification verification state machine (30-day TTL, HARD hold check, Nichibenren link; no scraping).',
    readOnly: true,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      required: ['lawyerId'],
      properties: { lawyerId: { type: 'string' }, syntheticDemoMode: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'inquiry.import_memo',
    description: 'Import a user-supplied soudan.memo.export.v1 JSON document into a local editable inquiry draft.',
    readOnly: false,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      required: ['json'],
      properties: { json: { type: 'string' }, lawyerId: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'inquiry.draft',
    description: 'Validate and store an inquiry draft strictly in local device storage.',
    readOnly: false,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      required: ['draft'],
      properties: { draft: { type: 'object' } },
      additionalProperties: false,
    },
  },
  {
    name: 'inquiry.send',
    description: 'Encrypt inquiry into an E2EE envelope and dispatch via canonical each-operation consent broker (respects O4 HARD holds).',
    readOnly: false,
    consentRequired: true,
    inputSchema: {
      type: 'object',
      properties: { draft: { type: 'object' }, dryRun: { type: 'boolean' }, syntheticDemoMode: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'inquiry.list',
    description: 'List local sent inquiries and optionally delete a local copy (lawyer copy unaffected).',
    readOnly: true,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      properties: { deleteInquiryId: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'lawyer.profile.update',
    description: 'Validate factual lawyer fields against O9 neutrality rules (rejecting 専門/win rates/reviews/fees) and save locally.',
    readOnly: false,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      required: ['profile'],
      properties: { profile: { type: 'object' } },
      additionalProperties: false,
    },
  },
  {
    name: 'intake.list',
    description: 'List incoming encrypted inquiries exposing only minimal conflict-check headers (AWAI-3235).',
    readOnly: true,
    consentRequired: false,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'intake.conflict_check',
    description: 'Run local ledger conflict check on minimal header and record confirmation receipt digest.',
    readOnly: false,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      required: ['inquiryId'],
      properties: { inquiryId: { type: 'string' }, confirmClear: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'intake.decide',
    description: 'Reveal/decrypt inquiry body or record accept/decline decision after confirmed clear conflict check (HARD gate).',
    readOnly: false,
    consentRequired: true,
    inputSchema: {
      type: 'object',
      required: ['inquiryId', 'action'],
      properties: {
        inquiryId: { type: 'string' },
        action: { type: 'string', enum: ['reveal', 'accept', 'decline', 'decline_conflict'] },
        replyText: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'inference.assist',
    description: 'Optional neutral intake structuring via murakumo.cloud with each-operation consent and non-retention disclosure (no legal advice).',
    readOnly: false,
    consentRequired: true,
    inputSchema: {
      type: 'object',
      required: ['rawText'],
      properties: { rawText: { type: 'string' }, model: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'audit.list',
    description: 'List append-only hash-chained local audit entries for UI and agent operations.',
    readOnly: true,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } },
      additionalProperties: false,
    },
  },
]);

export function createMcpAcpAdapter(engineOptions = {}) {
  const engine = engineOptions.execute ? engineOptions : createOperationsEngine(engineOptions);

  async function handleJsonRpc(request, { actor = 'mcp' } = {}) {
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return { jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'invalid-request' } };
    }
    const id = request.id ?? null;

    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-03-26',
          serverInfo: { name: 'bengoshi', version: '0.1.0', appId: 'network.itonami.bengoshi' },
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          policy: ZERO_FEE_POLICY,
        },
      };
    }

    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOL_SCHEMAS.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: {
              readOnlyHint: t.readOnly,
              destructiveHint: false,
              openWorldHint: t.name === 'inference.assist',
            },
          })),
        },
      };
    }

    if (request.method === 'resources/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            {
              uri: 'ui://bengoshi/embed.mcp',
              name: 'Bengoshi Neutral Directory Embed (SEP-1865)',
              mimeType: 'text/html',
              description: 'Read-only neutral lawyer directory embed (synthetic fixtures, SEP-1865 APP-01..APP-04).',
            },
          ],
        },
      };
    }

    if (request.method === 'tools/call') {
      const name = request.params?.name;
      const args = request.params?.arguments || {};
      try {
        const data = await engine.execute(name, args, { actor });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(data) }],
            structuredContent: data,
            isError: false,
          },
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ error: err?.code || err?.message || 'operation-failed', problems: err?.problems }) }],
            isError: true,
          },
        };
      }
    }

    // ACP (Agent Client Protocol) direct action dispatch
    if (request.method === 'acp/action') {
      const action = request.params?.action;
      const input = request.params?.input || {};
      try {
        const output = await engine.execute(action, input, { actor: 'acp' });
        return { jsonrpc: '2.0', id, result: { ok: true, action, output } };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: err?.code || err?.message || 'acp-action-failed', data: { problems: err?.problems } },
        };
      }
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method-not-found' } };
  }

  return Object.freeze({
    operations: CANONICAL_OPERATIONS,
    tools: TOOL_SCHEMAS,
    handleJsonRpc,
    engine,
  });
}
