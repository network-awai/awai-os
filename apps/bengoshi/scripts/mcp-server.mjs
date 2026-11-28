#!/usr/bin/env node
// Minimal zero-dependency stdio JSON-RPC 2.0 MCP server (POC / Draft) for Bengoshi (network.itonami.bengoshi).
// Backed directly by src/mcp-adapter.js and src/operations.js (100% local, zero external network calls).

import { createInterface } from 'node:readline';
import { createMcpAdapter } from '../src/mcp-adapter.js';
import { createInitialLocalState } from '../src/operations.js';

const state = createInitialLocalState();
if (process.env.BENGOSHI_DIRECTORY_SCOPE === 'neutral_cross_firm') {
  state.settings.directoryScope = 'neutral_cross_firm';
}

const adapter = createMcpAdapter({ state });
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
