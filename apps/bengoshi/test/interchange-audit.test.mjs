import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportLawyerCard, parseSoudanMemoExport, verifyAuditChain } from '../src/model.js';
import { SYNTHETIC_CATALOG_BUNDLE } from '../src/fixtures.js';
import { CANONICAL_OPERATIONS, createOperationsEngine } from '../src/operations.js';
import { createMcpAcpAdapter } from '../src/mcp-acp-adapter.js';

const NOW = '2026-11-27T09:00:00Z';

test('soudan.memo.export.v1 imports cleanly into an editable draft with evidence hashes', async () => {
  const soudanExport = JSON.stringify({
    schema: 'soudan.memo.export.v1',
    memo: {
      category: 'money',
      name: '山田 太郎',
      contact: 'taro@example.invalid',
      otherParty: '株式会社サンプル相手',
      summary: '貸付金50万円の返還について相談したい。',
      wish: '内容証明の送付から相談したい。',
      deadline: '2026-12-31',
      timeline: [{ date: '2026-06-01', event: '50万円振込' }],
      documents: ['振込明細'],
      evidence: [
        {
          url: 'https://example.invalid/post/1',
          shotName: 'shot.png',
          sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
          capturedAt: '2026-11-20T00:00:00Z',
        },
      ],
    },
  });

  const parsed = parseSoudanMemoExport(soudanExport);
  assert.equal(parsed.importedFromSoudan, true);
  assert.equal(parsed.clientName, '山田 太郎');
  assert.equal(parsed.counterpartyName, '株式会社サンプル相手');
  assert.equal(parsed.evidenceHashes.length, 1);
  assert.equal(parsed.evidenceHashes[0].sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  const engine = createOperationsEngine({ now: () => NOW });
  const res = await engine.execute('inquiry.import_memo', { json: soudanExport, lawyerId: 'syn-lawyer-990001' });
  assert.equal(res.draft.lawyerId, 'syn-lawyer-990001');

  assert.throws(() => parseSoudanMemoExport('{"schema":"other.v1"}'), /soudan\.unsupported_schema/);
});

test('bengoshi.lawyer.card.v1 exports factual fields, O4 verification metadata, and Nichibenren link', () => {
  const card = exportLawyerCard(SYNTHETIC_CATALOG_BUNDLE.lawyers[0], NOW);
  assert.equal(card.schema, 'bengoshi.lawyer.card.v1');
  assert.equal(card.policy.model, 'none');
  assert.equal(card.lawyer.name, '佐藤 遥（合成サンプル）');
  assert.equal(card.lawyer.bar_association, '大阪弁護士会');
  assert.equal(card.lawyer.nichibenren_search_url, 'https://member.nichibenren.or.jp/general_search');
  assert.equal(card.verification.effectiveStatus, 'verified_manual_a2');
  assert.ok(!('e2ee_public_key_jwk' in card.lawyer));
});

test('local append-only audit log maintains valid SHA-256 hash chain and detects tampering', async () => {
  const engine = createOperationsEngine({ now: () => NOW });
  await engine.execute('directory.search', { sort: 'kana_asc' }, { actor: 'ui' });
  await engine.execute('inquiry.draft', {
    draft: {
      lawyerId: 'syn-lawyer-990001',
      category: 'work',
      clientName: '相談者',
      clientContact: 'c@example.invalid',
      counterpartyName: '相手方',
      summary: 'テスト',
    },
  }, { actor: 'mcp' });

  const audit = await engine.execute('audit.list');
  assert.equal(audit.integrity.ok, true);
  assert.equal(audit.total, 2);

  // Tamper check
  const tampered = structuredClone(engine.state.auditLog);
  tampered[0].summary = 'tampered';
  assert.equal(verifyAuditChain(tampered).ok, false);
});

test('MCP and ACP adapter expose all 13 canonical noun.verb operations', async () => {
  assert.equal(CANONICAL_OPERATIONS.length, 13);
  const adapter = createMcpAcpAdapter({ now: () => NOW });

  const init = await adapter.handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(init.result.serverInfo.appId, 'network.itonami.bengoshi');

  const tools = await adapter.handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(tools.result.tools.map(x => x.name), [...CANONICAL_OPERATIONS]);

  const search = await adapter.handleJsonRpc({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'directory.search', arguments: { sort: 'reg_no_asc', directoryScope: 'neutral_cross_firm' } },
  });
  assert.equal(search.result.isError, false);
  assert.equal(search.result.structuredContent.total, 6);

  const acpRes = await adapter.handleJsonRpc({
    jsonrpc: '2.0', id: 4, method: 'acp/action',
    params: { action: 'lawyer.get', input: { lawyerId: 'syn-lawyer-990002' } },
  });
  assert.equal(acpRes.result.ok, true);
  assert.equal(acpRes.result.output.lawyer.registration_number, '990002');
});
