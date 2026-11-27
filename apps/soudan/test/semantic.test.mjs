import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE_SCHEMA, EXPORT_SCHEMA, emptyDraft, restoreAppState, parseLawyerCardPaste,
  assembleMemo, formatMemoMarkdown, buildMemoExportV1,
} from '../src/model.js';
import {translator} from '../src/messages.js';
import {SEMANTIC_OPERATIONS, SEMANTIC_STATES, createSemanticStore} from '../src/semantic.js';

const t = translator('ja');

function completePatch() {
  return {
    jurisdiction: 'JPN',
    category: 'contract',
    summary: '秘密の相談内容・山田太郎の契約紛争',
    timeline: [{date: '2026-10-01', event: '契約書に署名'}],
    otherParty: '株式会社テスト',
    wish: '契約解除の可否を確認したい',
    documents: ['契約書写し'],
    name: '山田太郎',
    contact: 'yamada-secret@example.jp',
    recipient: {name: '鈴木花子', office: '鈴木法律事務所', contact: 'hanako@example.jp'},
  };
}

test('restoreAppState initializes 1 default draft on first open and cleanly migrates legacy v1 single-draft data', () => {
  const fresh = restoreAppState(null, '2026-11-27T00:00:00.000Z');
  assert.equal(fresh.schema, STATE_SCHEMA);
  assert.equal(fresh.drafts.length, 1);
  assert.equal(fresh.activeDraftId, 'draft-1');
  assert.deepEqual(fresh.audit, []);

  const legacyV1 = {...emptyDraft(), jurisdiction: 'JPN', category: 'money', summary: '旧形式の下書き'};
  const migrated = restoreAppState(legacyV1, '2026-11-27T00:00:00.000Z');
  assert.equal(migrated.schema, STATE_SCHEMA);
  assert.equal(migrated.drafts.length, 1);
  assert.equal(migrated.drafts[0].draft.summary, '旧形式の下書き');
  assert.equal(migrated.drafts[0].draft.jurisdiction, 'JPN');
});

test('PR #29 semantic operations cover create/select/update/delete, evidence, assemble, send dry-run, and audit minimization', async () => {
  assert.deepEqual([...SEMANTIC_OPERATIONS], [
    'soudan.draft.create', 'soudan.draft.select', 'soudan.draft.update', 'soudan.draft.delete',
    'soudan.evidence.add', 'soudan.evidence.remove', 'soudan.memo.assemble', 'soudan.memo.send',
    'soudan.inference.organize', 'soudan.audit.list',
  ]);
  assert.deepEqual([...SEMANTIC_STATES], ['idle', 'proposal.ready', 'governor.blocked', 'consent.required', 'audit.recorded']);

  let persisted = 0;
  const store = createSemanticStore({
    locale: 'ja',
    now: () => '2026-11-27T07:00:00.000Z',
    onPersist: async () => { persisted += 1; },
  });

  // Update default draft
  const upd = await store.execute('soudan.draft.update', {patch: completePatch()}, {actor: {kind: 'human'}});
  assert.equal(upd.ok, true);
  assert.deepEqual(upd.problems, []);
  assert.equal(upd.state, 'audit.recorded');

  // Create second draft and switch back
  const created = await store.execute('soudan.draft.create', {title: '2件目'}, {actor: {kind: 'agent'}});
  assert.equal(created.ok, true);
  assert.equal(created.draftCount, 2);
  assert.equal(store.getState().activeDraftId, 'draft-2');

  const sel = await store.execute('soudan.draft.select', {id: 'draft-1'}, {actor: {kind: 'human'}});
  assert.equal(sel.ok, true);
  assert.equal(store.getState().activeDraftId, 'draft-1');

  // Evidence add/remove + reject raw image bytes
  const badEv = await store.execute('soudan.evidence.add', {row: {url: 'https://example.com/1', bytes: 'data:image/png;base64,AAA'}}, {actor: {kind: 'human'}});
  assert.equal(badEv.ok, false);
  assert.equal(badEv.state, 'governor.blocked');
  assert.equal(badEv.gateName, 'image-bytes-forbidden');

  const addEv = await store.execute('soudan.evidence.add', {
    row: {url: 'https://example.com/p/1', shotName: 'cap.png', shotSize: 100, sha256: 'a'.repeat(64)},
  }, {actor: {kind: 'human'}});
  assert.equal(addEv.ok, true);
  assert.equal(addEv.evidenceCount, 1);

  // Assemble memo
  const assembled = await store.execute('soudan.memo.assemble', {}, {actor: {kind: 'human'}});
  assert.equal(assembled.ok, true);
  assert.ok(assembled.memo.text.includes('秘密の相談内容'));
  assert.ok(assembled.disclaimer.includes('法的助言ではなく'));

  // Send dry-run (irreversible preview without broker invocation)
  const drySend = await store.execute('soudan.memo.send', {dryRun: true, mode: 'save-txt'}, {actor: {kind: 'human'}});
  assert.equal(drySend.ok, true);
  assert.equal(drySend.state, 'consent.required');
  assert.equal(drySend.preview.dryRun, true);
  assert.equal(drySend.preview.reversible, false);
  assert.equal(drySend.preview.imageBytesIncluded, false);

  // Delete draft: unconfirmed returns dry-run preview without deleting
  const delDry = await store.execute('soudan.draft.delete', {id: 'draft-2'}, {actor: {kind: 'human'}});
  assert.equal(delDry.ok, true);
  assert.equal(delDry.state, 'consent.required');
  assert.equal(delDry.preview.reversible, false);
  assert.equal(store.getState().drafts.length, 2);

  // Delete draft: explicit confirmation executes & audits
  const delDone = await store.execute('soudan.draft.delete', {id: 'draft-2', confirmed: true}, {actor: {kind: 'human'}});
  assert.equal(delDone.ok, true);
  assert.equal(store.getState().drafts.length, 1);

  // Evidence remove
  const rmEv = await store.execute('soudan.evidence.remove', {index: 0}, {actor: {kind: 'human'}});
  assert.equal(rmEv.ok, true);
  assert.equal(rmEv.evidenceCount, 0);

  // Audit list: strictly minimized (O8), NEVER duplicates consultation text or PII
  const audit = await store.execute('soudan.audit.list', {}, {actor: {kind: 'human'}});
  assert.equal(audit.ok, true);
  assert.ok(audit.entries.length >= 8);
  const serializedAudit = JSON.stringify(audit.entries);
  for (const secret of ['秘密の相談内容', '山田太郎', 'yamada-secret@example.jp', '株式会社テスト', '鈴木花子', 'hanako@example.jp', 'https://example.com/p/1']) {
    assert.ok(!serializedAudit.includes(secret), 'audit log leaked sensitive text: ' + secret);
  }
  assert.ok(audit.entries.some(e => e.actor.kind === 'human'));
  assert.ok(audit.entries.some(e => e.actor.kind === 'agent'));
  assert.ok(persisted >= 6);
});

test('optional manual-only bengoshi.lawyer.card.v1 JSON and 7-line text paste helper fills editable fields only', () => {
  const fromJson = parseLawyerCardPaste(JSON.stringify({
    schema: 'bengoshi.lawyer.card.v1',
    name: '佐藤一郎',
    office: '佐藤法律事務所',
    contact: 'ichiro@example.jp',
  }));
  assert.deepEqual(fromJson, {name: '佐藤一郎', office: '佐藤法律事務所', contact: 'ichiro@example.jp'});

  const sevenLines = [
    '氏名: 高橋花子',
    '所属弁護士会: 東京弁護士会',
    '登録番号: 12345',
    '事務所名: 高橋総合法律事務所',
    '連絡先: 03-0000-0000',
    '資格確認状態: 確認済み',
    '日弁連検索: https://www.bengoshikai.jp/',
  ].join('\n');
  assert.deepEqual(parseLawyerCardPaste(sevenLines), {
    name: '高橋花子',
    office: '高橋総合法律事務所',
    contact: '03-0000-0000',
  });

  // Wrong schema or unrelated text is refused cleanly.
  assert.equal(parseLawyerCardPaste(JSON.stringify({schema: 'other.v1', name: 'x'})), null);
  assert.equal(parseLawyerCardPaste('hello world'), null);
});

test('Web parity Markdown and soudan.memo.export.v1 JSON preserve fixed disclaimer and zero image bytes', () => {
  const d = {...emptyDraft(), ...completePatch()};
  const memo = assembleMemo(d, t);
  const md = formatMemoMarkdown(memo, d.recipient, t);
  assert.ok(md.includes('# 相談メモ（契約）'));
  assert.ok(md.includes('鈴木花子'));
  assert.ok(md.includes(t('memo.notice')));

  const exp = buildMemoExportV1(memo, d.recipient, d, t, '2026-11-27T07:00:00.000Z');
  assert.equal(exp.schema, EXPORT_SCHEMA);
  assert.equal(exp.evidenceHashesOnly, true);
  assert.equal(exp.disclaimer, t('disclaimer.fixed'));
  assert.ok(!JSON.stringify(exp).includes('data:image'));
});
