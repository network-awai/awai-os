// MCP adapter (POC / Draft) for Bengoshi (network.itonami.bengoshi).
// Wraps the exact same device-local `noun.verb` operations engine used by the Web/Tauri UI.
// - ZERO external inference (`inference.assist` removed)
// - ZERO ACP surface in product UI (`AWAI-4003` #07)
// - POC / Draft status (does not claim formal AWAI-4143 conformance yet)
// - APP-01 non-UI fallback (`content` + `structuredContent`) ALWAYS includes Art. 9 (`氏名`, `所属弁護士会`),
//   neutral disclaimer, and agent non-recommendation guard.

import { CANONICAL_OPERATIONS, createOperationsEngine } from './operations.js';
import { ZERO_FEE_POLICY, NEUTRAL_SORTS, DIRECTORY_SCOPES } from './model.js';
import { formatArt9FallbackText } from './mcp-embed.js';
import {
  NICHIBENREN_SEARCH_URL,
  PREVIEW_BANNER_JA,
  AGENT_NON_RECOMMENDATION_GUARD_JA,
} from './legal-notices.js';

export const MCP_ADAPTER_STATUS = 'poc-draft';

export const TOOL_SCHEMAS = Object.freeze([
  {
    name: 'directory.search',
    description: 'Search the local synthetic lawyer directory with neutral filters and neutral sorting only (O9, POC/Draft). Zero external calls.',
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
    description: 'Retrieve factual lawyer profile (Art. 9 mandatory fields) and evaluated O4 qualification status.',
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
    name: 'contact.format_manual',
    description: 'Format exact 7-line Method A manual Copy Contact text locally (blocked on expired / suspended_or_revoked).',
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
    name: 'inquiry.import_memo',
    description: 'Import a user-supplied soudan.memo.export.v1 (consultation-memo.jpn.v1) JSON document into a local editable draft.',
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
    description: 'Validate and store a consultation draft strictly in local device storage.',
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
    description: 'Create an offline local E2EE preview envelope on device (zero server relay; Method A is primary; respects O4 HARD holds).',
    readOnly: false,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      properties: { draft: { type: 'object' }, syntheticDemoMode: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'inquiry.list',
    description: 'List local records and optionally delete a local copy.',
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
    description: 'Validate factual lawyer fields against expanded O9 neutrality rules and save locally.',
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
    name: 'lawyer.export_art11_record',
    description: 'Export timestamped listing snapshot, edit history, and zero-fee terms (fee_jpy: 0) for Advertising Rules Art. 11 3-year preservation.',
    readOnly: true,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      properties: { lawyerId: { type: 'string' }, profile: { type: 'object' } },
      additionalProperties: false,
    },
  },
  {
    name: 'intake.list',
    description: 'List local offline preview encrypted inquiries exposing only minimal conflict-check headers (AWAI-3235).',
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
    description: 'Reveal/decrypt local inquiry body or record local accept/decline decision after confirmed clear conflict check (HARD gate).',
    readOnly: false,
    consentRequired: false,
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
    name: 'audit.list',
    description: 'List append-only hash-chained local audit entries.',
    readOnly: true,
    consentRequired: false,
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } },
      additionalProperties: false,
    },
  },
]);

export function createMcpAdapter(engineOptions = {}) {
  const engine = engineOptions.execute
    ? engineOptions
    : createOperationsEngine({
        serializeWrites: engineOptions.enqueueWrite ? undefined : true,
        ...engineOptions,
      });

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
          status: MCP_ADAPTER_STATUS,
          formalAwai4143Claim: false,
          serverInfo: {
            name: 'bengoshi',
            version: '0.1.0',
            appId: 'network.itonami.bengoshi',
            title: 'Bengoshi — 弁護士検索ガイド・中立ディレクトリ（準備中）',
          },
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          policy: ZERO_FEE_POLICY,
          neutralDisclaimer: PREVIEW_BANNER_JA,
          agentNonRecommendationGuard: AGENT_NON_RECOMMENDATION_GUARD_JA,
        },
      };
    }

    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          status: MCP_ADAPTER_STATUS,
          tools: TOOL_SCHEMAS.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: {
              readOnlyHint: t.readOnly,
              destructiveHint: false,
              openWorldHint: false,
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
              name: 'Bengoshi — 弁護士検索ガイド・中立ディレクトリ Embed (POC/Draft)',
              mimeType: 'text/html',
              description: 'POC/Draft read-only neutral directory embed (synthetic samples only, SEP-1865 APP-01..APP-04).',
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

        // APP-01 non-UI fallback: directory.search & lawyer.get ALWAYS carry Art. 9 fields + neutral disclaimer + agent guard
        if (name === 'directory.search' || name === 'lawyer.get') {
          const list = name === 'directory.search' ? data.lawyers : [data.lawyer];
          const enriched = {
            ...data,
            status: MCP_ADAPTER_STATUS,
            neutralDisclaimer: PREVIEW_BANNER_JA,
            agentNonRecommendationGuard: AGENT_NON_RECOMMENDATION_GUARD_JA,
            nichibenrenSearchUrl: NICHIBENREN_SEARCH_URL,
            art9FieldsPresent: list.every(l => Boolean(l?.name && l?.bar_association)),
          };
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: formatArt9FallbackText(list) }],
              structuredContent: enriched,
              isError: false,
            },
          };
        }

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

    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method-not-found' } };
  }

  return Object.freeze({
    status: MCP_ADAPTER_STATUS,
    operations: CANONICAL_OPERATIONS,
    tools: TOOL_SCHEMAS,
    handleJsonRpc,
    engine,
  });
}
