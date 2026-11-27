#!/usr/bin/env node
// Minimal zero-dependency stdio JSON-RPC 2.0 MCP server for Bengoshi (network.itonami.bengoshi).
// Backed directly by src/mcp-acp-adapter.js and src/operations.js.

import { createInterface } from 'node:readline';
import { createMcpAcpAdapter } from '../src/mcp-acp-adapter.js';
import { createInitialLocalState } from '../src/operations.js';

const state = createInitialLocalState();
if (process.env.BENGOSHI_DIRECTORY_SCOPE === 'neutral_cross_firm') {
  state.settings.directoryScope = 'neutral_cross_firm';
}

const adapter = createMcpAcpAdapter({ state });
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse-error' } }) + '\n');
    return;
  }
  const resp = await adapter.handleJsonRpc(req, { actor: 'mcp' });
  if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
});
