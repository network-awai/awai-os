import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportLawyerCard, parseSoudanMemoExport, verifyAuditChain } from '../src/model.js';
import { SYNTHETIC_CATALOG_BUNDLE } from '../src/fixtures.js';
import { CANONICAL_OPERATIONS, createOperationsEngine } from '../src/operations.js';
import { createMcpAdapter } from '../src/mcp-adapter.js';

const NOW = '2026-11-27T09:00:00Z';

test('exact soudan.memo.export.v1 imports template consultation-memo.jpn.v1, wish, verbatim deadline, documents, and full evidence_manifest', async () => {
  const soudanExport = JSON.stringify({
    schema: 'soudan.memo.export.v1',
    template: 'consultation-memo.jpn.v1',
    memo: {
      category: 'money',
      name: '山田 太郎',
      contact: 'taro@example.invalid',
      otherParty: '株式会社サンプル相手',
      summary: '貸付金50万円の返還について相談したい。',
      wish: '内容証明の送付から相談したい。',
      deadline: '2026年12月31日頃までに方針を決めたい',
      timeline: [{ date: '2026-06-01', event: '50万円振込' }],
      documents: ['振込明細', '金銭消費貸借契約書写し'],
      evidence_manifest: [
        {
          url: 'https://example.invalid/post/1',
          posted_at: '2026-11-19T12:30',
          author_name: '投稿者サンプル',
          author_id: '@sample_author_01',
          shot_name: 'shot.png',
          shot_size: 123456,
          captured_at: '2026-11-20T00:00:00Z',
          sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        },
      ],
    },
  });

  const parsed = parseSoudanMemoExport(soudanExport);
  assert.equal(parsed.importedFromSoudan, true);
  assert.equal(parsed.template, 'consultation-memo.jpn.v1');
  assert.equal(parsed.category, 'money');
  assert.equal(parsed.wish, '内容証明の送付から相談したい。');
  assert.equal(parsed.deadline, '2026年12月31日頃までに方針を決めたい');
  assert.deepEqual(parsed.documents, ['振込明細', '金銭消費貸借契約書写し']);
  assert.equal(parsed.evidenceManifest.length, 1);
  assert.deepEqual(parsed.evidenceManifest[0], {
    url: 'https://example.invalid/post/1',
    posted_at: '2026-11-19T12:30',
    author_name: '投稿者サンプル',
    author_id: '@sample_author_01',
    shot_name: 'shot.png',
    shot_size: 123456,
    captured_at: '2026-11-20T00:00:00Z',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  });

  const engine = createOperationsEngine({ now: () => NOW });
  const res = await engine.execute('inquiry.import_memo', { json: soudanExport, lawyerId: 'syn-lawyer-990001' });
  assert.equal(res.draft.lawyerId, 'syn-lawyer-990001');

  assert.throws(() => parseSoudanMemoExport('{"schema":"other.v1"}'), /soudan\.unsupported_schema/);
  assert.throws(() => parseSoudanMemoExport('{"schema":"soudan.memo.export.v1","template":"unknown.v1"}'), /soudan\.unsupported_template/);
});

test('bengoshi.lawyer.card.v1 exports factual fields, O4 verification metadata, Nichibenren link, and 7-line manualContactText (null on HARD hold)', () => {
  const card = exportLawyerCard(SYNTHETIC_CATALOG_BUNDLE.lawyers[0], NOW);
  assert.equal(card.schema, 'bengoshi.lawyer.card.v1');
  assert.equal(card.policy.model, 'none');
  assert.equal(card.policy.fee_jpy, 0);
  assert.equal(card.lawyer.name, '佐藤 遥（架空サンプル）');
  assert.equal(card.lawyer.bar_association, '大阪弁護士会');
  assert.equal(card.lawyer.nichibenren_search_url, 'https://member.nichibenren.or.jp/general_search');
  assert.equal(card.verification.effectiveStatus, 'verified_manual_a2');
  assert.equal(card.manualContactText.split('\n').length, 7);
  assert.ok(!('e2ee_public_key_jwk' in card.lawyer));

  const expiredCard = exportLawyerCard(SYNTHETIC_CATALOG_BUNDLE.lawyers[4], NOW);
  assert.equal(expiredCard.verification.hardHold, true);
  assert.equal(expiredCard.manualContactText, null);
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

  const tampered = structuredClone(engine.state.auditLog);
  tampered[0].summary = 'tampered';
  assert.equal(verifyAuditChain(tampered).ok, false);
});

test('MCP POC adapter exposes 14 local operations (zero inference.assist, zero ACP) with Art. 9 + neutral disclaimer + agent guard fallback', async () => {
  assert.equal(CANONICAL_OPERATIONS.length, 14);
  assert.ok(!CANONICAL_OPERATIONS.includes('inference.assist'));
  assert.ok(CANONICAL_OPERATIONS.includes('lawyer.export_art11_record'));
  assert.ok(CANONICAL_OPERATIONS.includes('contact.format_manual'));

  const adapter = createMcpAdapter({ now: () => NOW });

  const init = await adapter.handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(init.result.serverInfo.appId, 'network.itonami.bengoshi');
  assert.equal(init.result.status, 'poc-draft');
  assert.equal(init.result.formalAwai4143Claim, false);

  const tools = await adapter.handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(tools.result.tools.map(x => x.name), [...CANONICAL_OPERATIONS]);
  assert.ok(tools.result.tools.every(x => x.annotations.openWorldHint === false));

  const search = await adapter.handleJsonRpc({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'directory.search', arguments: { sort: 'reg_no_asc', directoryScope: 'neutral_cross_firm' } },
  });
  assert.equal(search.result.isError, false);
  assert.equal(search.result.structuredContent.total, 6);
  assert.equal(search.result.structuredContent.art9FieldsPresent, true);
  assert.match(search.result.content[0].text, /氏名:/);
  assert.match(search.result.content[0].text, /所属弁護士会:/);
  assert.match(search.result.content[0].text, /プレビュー版/);
  assert.match(search.result.content[0].text, /\[AGENT_GUARD\]/);

  const got = await adapter.handleJsonRpc({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'lawyer.get', arguments: { lawyerId: 'syn-lawyer-990002' } },
  });
  assert.equal(got.result.isError, false);
  assert.match(got.result.content[0].text, /青木 匠/);
  assert.match(got.result.content[0].text, /東京弁護士会/);
  assert.match(got.result.content[0].text, /\[AGENT_GUARD\]/);

  // ACP method must NOT be exposed (AWAI-4003 #07)
  const noAcp = await adapter.handleJsonRpc({ jsonrpc: '2.0', id: 5, method: 'acp/action', params: { action: 'lawyer.get' } });
  assert.equal(noAcp.error.code, -32601);
});
