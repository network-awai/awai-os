import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  STATE_SCHEMA, EXPORT_SCHEMA, emptyDraft, restoreAppState, parseLawyerCardPaste,
  assembleMemo, formatMemoMarkdown, buildMemoExportV1,
} from '../src/model.js';
import {translator} from '../src/messages.js';
import {SEMANTIC_OPERATIONS, SEMANTIC_STATES, createSemanticStore} from '../src/semantic.js';
import {createFormSession} from '../src/form-session.js';

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

test('P1 #2: agent/MCP soudan.draft.delete NEVER deletes even with confirmed:true/confirm:true; only human confirmation finalizes', async () => {
  const store = createSemanticStore({locale: 'ja'});
  await store.execute('soudan.draft.create', {title: '残すべき下書き'}, {actor: {kind: 'human'}});
  assert.equal(store.getState().drafts.length, 2);

  // Agent/MCP passes both confirm:true and confirmed:true -> MUST NOT delete!
  const blocked = await store.execute('soudan.draft.delete', {id: 'draft-2', confirmed: true, confirm: true}, {actor: {kind: 'agent'}});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.state, 'consent.required');
  assert.equal(blocked.requiresHumanApproval, true);
  assert.equal(blocked.gateName, 'human-approval-required');
  assert.equal(store.getState().drafts.length, 2, 'draft MUST remain intact after agent delete call');
  assert.equal(store.getPendingDeletions().length, 1);
  assert.equal(store.getPendingDeletions()[0].targetId, 'draft-2');

  // Human explicit confirmation for the same target draft finalizes deletion.
  const humanDone = await store.execute('soudan.draft.delete', {id: 'draft-2', confirmed: true}, {actor: {kind: 'human'}});
  assert.equal(humanDone.ok, true);
  assert.equal(store.getState().drafts.length, 1);
  assert.equal(store.getPendingDeletions().length, 0);
});

test('P1 #3: persist failures (state-conflict and storage rejection) propagate ok:false, roll back state, and never report success', async () => {
  // Case A: revision conflict reloads authoritative state and returns ok:false, conflict:true.
  const remoteState = restoreAppState({
    schema: STATE_SCHEMA,
    activeDraftId: 'draft-1',
    drafts: [{id: 'draft-1', title: '別タブの最新', createdAt: '2026-11-27T00:00:00.000Z', updatedAt: '2026-11-27T00:00:00.000Z', draft: {...emptyDraft(), summary: '最新データ'}}],
    audit: [],
  });
  let failMode = null;
  const store = createSemanticStore({
    locale: 'ja',
    onPersist: async () => {
      if (failMode === 'conflict') return {ok: false, conflict: true, code: 'state-conflict', reloadedState: remoteState};
      if (failMode === 'quota') return {ok: false, conflict: false, code: 'data-too-large'};
      return {ok: true};
    },
  });

  await store.execute('soudan.draft.create', {title: '2件目'}, {actor: {kind: 'human'}});
  assert.equal(store.getState().drafts.length, 2);

  // Storage write rejection on delete -> returns ok:false and rolls back deletion!
  failMode = 'quota';
  const delQuota = await store.execute('soudan.draft.delete', {id: 'draft-2', confirmed: true}, {actor: {kind: 'human'}});
  assert.equal(delQuota.ok, false);
  assert.equal(delQuota.persisted, false);
  assert.equal(delQuota.error, 'data-too-large');
  assert.equal(store.getState().drafts.length, 2, 'deleted draft was rolled back on storage failure');

  // Storage write rejection on create -> returns ok:false and rolls back creation!
  const createQuota = await store.execute('soudan.draft.create', {title: '保存失敗'}, {actor: {kind: 'human'}});
  assert.equal(createQuota.ok, false);
  assert.equal(createQuota.error, 'data-too-large');
  assert.equal(store.getState().drafts.length, 2, 'created draft was rolled back on storage failure');

  // Revision conflict on update -> returns ok:false, conflict:true and reloads authoritative remote state!
  failMode = 'conflict';
  const updConflict = await store.execute('soudan.draft.update', {patch: {summary: '古い編集'}}, {actor: {kind: 'human'}});
  assert.equal(updConflict.ok, false);
  assert.equal(updConflict.conflict, true);
  assert.equal(updConflict.error, 'state-conflict');
  assert.equal(store.getState().drafts.length, 1);
  assert.equal(store.getActiveDraft().draft.summary, '最新データ');

  // Verify app.js routes mutation feedback through statusMessageForMutation (never unconditional success).
  const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(appSrc.includes("statusMessageForMutation(res, 'drafts.deleted', t)"));
  assert.ok(appSrc.includes("statusMessageForMutation(res, 'drafts.created', t)"));
  assert.ok(appSrc.includes("statusMessageForMutation(res, 'saved', t)"));
});

test('P1 #4: organization proposal is bound to originating draftId and cannot overwrite another draft after switching', async () => {
  const store = createSemanticStore({locale: 'ja'});
  await store.execute('soudan.draft.update', {patch: {summary: '相談Aの元の内容'}}, {actor: {kind: 'human'}});
  await store.execute('soudan.draft.create', {title: '相談B'}, {actor: {kind: 'human'}});
  await store.execute('soudan.draft.update', {patch: {summary: '相談Bの元の内容'}}, {actor: {kind: 'human'}});

  // Switch back to draft-1 and generate a proposal.
  await store.execute('soudan.draft.select', {id: 'draft-1'}, {actor: {kind: 'human'}});
  const org = await store.execute('soudan.inference.organize', {localOnly: true}, {actor: {kind: 'human'}});
  assert.equal(org.ok, true);
  assert.equal(org.proposal.targetDraftId, 'draft-1');
  assert.equal(store.getLastProposal('draft-1')?.targetDraftId, 'draft-1');
  assert.equal(store.getLastProposal('draft-2'), null);

  // Switch to draft-2 -> proposal from draft-1 is cleared/hidden and cannot be applied to draft-2!
  await store.execute('soudan.draft.select', {id: 'draft-2'}, {actor: {kind: 'human'}});
  assert.equal(store.getLastProposal(), null);
  const crossApply = await store.execute('soudan.draft.update', {
    id: 'draft-2',
    proposalDraftId: org.proposal.targetDraftId,
    patch: {summary: org.proposal.suggestedSummary},
  }, {actor: {kind: 'human'}});
  assert.equal(crossApply.ok, false);
  assert.equal(crossApply.state, 'governor.blocked');
  assert.equal(crossApply.gateName, 'proposal-draft-mismatch');
  assert.equal(store.getActiveDraft().draft.summary, '相談Bの元の内容', 'draft-2 MUST remain untouched');
});

test('P2 #5: normal Save in app.js routes through soudan.draft.update with human actor and O8-minimized audit', async () => {
  const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const saveBlock = appSrc.slice(appSrc.indexOf('async function save()'), appSrc.indexOf('function field('));
  assert.ok(saveBlock.includes("session.save({actor: {kind: 'human'}})"), 'save() must invoke session.save with human actor');
  assert.ok(!saveBlock.includes('host.write('), 'save() must not bypass semantic store by calling host.write directly');

  const store = createSemanticStore({locale: 'ja'});
  const session = createFormSession(store);
  session.draft().summary = '秘密の相談テキスト999';
  session.draft().name = '秘密氏名';
  const res = await session.save({actor: {kind: 'human'}});
  assert.equal(res.ok, true);
  const entries = (await store.execute('soudan.audit.list', {}, {actor: {kind: 'human'}})).entries;
  assert.equal(entries.at(-1).op, 'soudan.draft.update');
  assert.equal(entries.at(-1).actor.kind, 'human');
  assert.ok(!JSON.stringify(entries).includes('秘密の相談テキスト999'));
  assert.ok(!JSON.stringify(entries).includes('秘密氏名'));
});

test('Round-2 P1 #1: Save -> re-edit -> Save keeps new edits, and evidence add/remove preserves unsaved fields', async () => {
  let persistedSnapshots = [];
  const store = createSemanticStore({
    locale: 'ja',
    onPersist: async next => { persistedSnapshots.push(structuredClone(next)); return {ok: true}; },
  });
  const session = createFormSession(store);

  // (a) Simulate DOM listener holding live buffer across Save -> re-edit -> Save
  const liveRef = session.draft();
  liveRef.summary = '最初の入力';
  assert.equal((await session.save()).ok, true);
  assert.equal(store.getActiveDraft().draft.summary, '最初の入力');

  // Edit via the SAME reference that was active before Save (as rendered DOM handlers do) and save again!
  liveRef.summary = '最初の入力＋追記';
  assert.equal((await session.save()).ok, true);
  assert.equal(store.getActiveDraft().draft.summary, '最初の入力＋追記');
  assert.equal(persistedSnapshots.at(-1).drafts[0].draft.summary, '最初の入力＋追記');

  // (b) Type unsaved summary AND unsaved evidence URL, then add & remove evidence rows -> unsaved edits survive!
  session.draft().summary = 'まだ保存していない重要メモ';
  assert.equal((await session.addEvidence()).ok, true);
  assert.equal(session.draft().summary, 'まだ保存していない重要メモ');
  assert.equal(session.draft().evidence.length, 1);

  session.draft().evidence[0].url = 'https://example.com/unsaved-post-1';
  assert.equal((await session.addEvidence()).ok, true);
  assert.equal(session.draft().summary, 'まだ保存していない重要メモ');
  assert.equal(session.draft().evidence[0].url, 'https://example.com/unsaved-post-1');
  assert.equal(session.draft().evidence.length, 2);

  // Remove row 1 -> unsaved summary AND unsaved row 0 URL remain intact!
  assert.equal((await session.removeEvidence(1)).ok, true);
  assert.equal(session.draft().summary, 'まだ保存していない重要メモ');
  assert.equal(session.draft().evidence.length, 1);
  assert.equal(session.draft().evidence[0].url, 'https://example.com/unsaved-post-1');
});

test('Round-2 P1 #2: Send dry-run preview reads live editing snapshot WITHOUT persisting, bumping revision, or adding audit entries', async () => {
  let persistCalls = 0;
  let revision = 0;
  const store = createSemanticStore({
    locale: 'ja',
    onPersist: async () => { persistCalls += 1; revision += 1; return {ok: true}; },
  });
  const session = createFormSession(store);

  // Populate unsaved fields + unsaved recipient in memory only (never saved yet)
  Object.assign(session.draft(), completePatch());
  assert.equal(persistCalls, 0);
  assert.equal(revision, 0);
  assert.equal(store.getState().audit.length, 0);

  const dry = await session.dryRunSend({mode: 'save-txt'});
  assert.equal(dry.ok, true);
  assert.equal(dry.sent, false);
  assert.equal(dry.state, 'consent.required');
  assert.equal(dry.preview.dryRun, true);
  assert.equal(dry.preview.recipientFilled, true);
  assert.ok(dry.preview.charCount > 0);

  // Zero persistence, zero revision bump, zero audit mutation, stored draft still empty!
  assert.equal(persistCalls, 0, 'dry-run MUST NOT call onPersist');
  assert.equal(revision, 0, 'dry-run MUST NOT bump revision');
  assert.equal(store.getState().audit.length, 0, 'dry-run MUST NOT write any audit entry');
  assert.equal(store.getActiveDraft().draft.summary, '', 'dry-run MUST NOT persist unsaved summary');
  assert.equal(store.getActiveDraft().draft.recipient.name, '', 'dry-run MUST NOT persist unsaved recipient');

  // Verify app.js dryRunBtn does not call save()
  const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const dryBlock = appSrc.slice(appSrc.indexOf("dryRunBtn.addEventListener('click'"), appSrc.indexOf("const actions = el('div', null, 'actions');\n  const saveButton"));
  assert.ok(!dryBlock.includes('save('), 'dryRunBtn click handler must not call save()');
});

test('Round-2 P1 #4: external share success + audit persist failure returns sent:true, auditPersisted:false and retries audit without repeating share', async () => {
  let shareCalls = 0;
  const fakeBroker = {
    async invoke() {
      shareCalls += 1;
      return {shared: true, route: 'android-share-sheet'};
    },
  };
  let failAudit = null;
  const store = createSemanticStore({
    locale: 'ja',
    broker: fakeBroker,
    onPersist: async () => {
      if (failAudit === 'quota') return {ok: false, conflict: false, code: 'data-too-large'};
      if (failAudit === 'conflict') return {ok: false, conflict: true, code: 'state-conflict'};
      return {ok: true};
    },
  });

  await store.execute('soudan.draft.update', {patch: completePatch()}, {actor: {kind: 'human'}});

  // Case A: quota failure on post-share audit persistence
  failAudit = 'quota';
  const resQuota = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  assert.equal(shareCalls, 1, 'external share ran once');
  assert.equal(resQuota.ok, false, 'overall result is not plain ok when audit failed');
  assert.equal(resQuota.sent, true, 'clearly distinguishes that external share ALREADY succeeded');
  assert.equal(resQuota.auditPersisted, false);
  assert.equal(resQuota.auditError, 'data-too-large');
  assert.equal(resQuota.pendingAuditEntry.op, 'soudan.memo.send');
  assert.ok(store.getPendingAudit());

  // Retrying audit persistence succeeds WITHOUT repeating external share!
  failAudit = null;
  const retried = await store.retryPendingAudit();
  assert.equal(retried.ok, true);
  assert.equal(retried.auditPersisted, true);
  assert.equal(shareCalls, 1, 'retryPendingAudit MUST NOT repeat external share');
  assert.equal(store.getPendingAudit(), null);
  assert.equal(store.getState().audit.at(-1).op, 'soudan.memo.send');

  // Case B: conflict failure on post-share audit persistence
  failAudit = 'conflict';
  const resConflict = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  assert.equal(shareCalls, 2);
  assert.equal(resConflict.ok, false);
  assert.equal(resConflict.sent, true);
  assert.equal(resConflict.auditPersisted, false);
  assert.equal(resConflict.conflict, true);
  assert.equal(resConflict.auditError, 'state-conflict');
});

test('Round-3 P1 #1: FIFO pending audit queue preserves Share #1 audit when Share #2 succeeds or when both fail then retry', async () => {
  let shareCalls = 0;
  const fakeBroker = {
    async invoke() {
      shareCalls += 1;
      return {shared: true, route: 'android-share-sheet'};
    },
  };
  let failAudit = false;
  const store = createSemanticStore({
    locale: 'ja',
    broker: fakeBroker,
    onPersist: async () => (failAudit ? {ok: false, conflict: false, code: 'data-too-large'} : {ok: true}),
  });
  await store.execute('soudan.draft.update', {patch: completePatch()}, {actor: {kind: 'human'}});

  // Sequence 1 (Kougi exact repro): Share #1 succeeds (audit fails) -> Share #2 succeeds (audit succeeds)
  // => BOTH Share #1 and Share #2 audit records MUST be persisted, queue empty, zero repeated shares!
  failAudit = true;
  const s1 = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  assert.equal(s1.ok, false);
  assert.equal(s1.sent, true);
  assert.equal(s1.auditPersisted, false);
  assert.equal(store.getPendingAuditCount(), 1);

  failAudit = false;
  const s2 = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  assert.equal(s2.ok, true);
  assert.equal(s2.sent, true);
  assert.equal(s2.auditPersisted, true);
  assert.equal(s2.flushedPendingCount, 1);
  assert.equal(store.getPendingAuditCount(), 0);
  assert.equal(shareCalls, 2, 'zero repeated shares');
  const sendAuditsAfterSeq1 = store.getState().audit.filter(e => e.op === 'soudan.memo.send' && e.outcome === 'ok');
  assert.equal(sendAuditsAfterSeq1.length, 2, '2 completed shares MUST produce 2 distinct persisted audit records');
  assert.notEqual(sendAuditsAfterSeq1[0].id, sendAuditsAfterSeq1[1].id);

  // Sequence 2: Share #3 fails audit -> Share #4 fails audit -> retryPendingAudit() succeeds -> 2 more audit entries!
  failAudit = true;
  const s3 = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  const s4 = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  assert.equal(s3.sent, true);
  assert.equal(s4.sent, true);
  assert.equal(store.getPendingAuditCount(), 2);
  assert.equal(shareCalls, 4);

  failAudit = false;
  const flushed = await store.retryPendingAudit();
  assert.equal(flushed.ok, true);
  assert.equal(flushed.auditPersisted, true);
  assert.equal(flushed.pendingAuditCount, 0);
  assert.equal(store.getPendingAuditCount(), 0);
  assert.equal(shareCalls, 4, 'retryPendingAudit NEVER repeats external share');
  const sendAuditsAfterSeq2 = store.getState().audit.filter(e => e.op === 'soudan.memo.send' && e.outcome === 'ok');
  assert.equal(sendAuditsAfterSeq2.length, 4, 'all 4 completed shares have persisted audit records');
});

test('Round-3 P2 #2: local-only organize uses live unsaved editing snapshot without persisting or bumping revision', async () => {
  let persistCalls = 0;
  let revision = 0;
  const store = createSemanticStore({
    locale: 'ja',
    onPersist: async () => { persistCalls += 1; revision += 1; return {ok: true}; },
  });
  const session = createFormSession(store);

  // Save initial summary (revision becomes 1)
  session.draft().summary = '古い保存済みテキスト';
  assert.equal((await session.save()).ok, true);
  assert.equal(persistCalls, 1);
  assert.equal(revision, 1);

  // Edit summary WITHOUT saving -> run local-only organize -> proposal MUST reflect NEW unsaved text
  // AND persisted storage / revision MUST stay completely unchanged!
  session.draft().summary = '新しい未保存の追記内容XYZ';
  const org = await session.organize({localOnly: true});
  assert.equal(org.ok, true);
  assert.equal(org.fallback, 'local');
  assert.equal(org.state, 'proposal.ready');
  assert.ok(org.proposal.suggestedSummary.includes('新しい未保存の追記内容XYZ'), 'proposal uses live unsaved edits');
  assert.ok(!org.proposal.suggestedSummary.includes('古い保存済みテキスト'), 'proposal does not use stale persisted text');
  assert.equal(persistCalls, 1, 'local-only organize MUST NOT write to storage');
  assert.equal(revision, 1, 'local-only organize MUST NOT bump revision');
  assert.equal(store.getActiveDraft().draft.summary, '古い保存済みテキスト', 'persisted draft remains unchanged until explicit Save or Apply');
});

test('Round-4 Regression A: reloaded store via setState() with existing aud-1/aud-2 never collides with new share audit ID', async () => {
  const fakeBroker = {async invoke() { return {shared: true, route: 'android-share-sheet'}; }};
  let failPersist = true;
  const store = createSemanticStore({
    locale: 'ja',
    broker: fakeBroker,
    onPersist: async () => (failPersist ? {ok: false, conflict: false, code: 'data-too-large'} : {ok: true}),
  });

  // Load persisted state via setState() containing existing aud-1 and aud-2.
  store.setState({
    schema: STATE_SCHEMA,
    activeDraftId: 'draft-1',
    drafts: [{
      id: 'draft-1',
      title: '既存下書き',
      createdAt: '2026-11-27T00:00:00.000Z',
      updatedAt: '2026-11-27T00:00:00.000Z',
      draft: {...emptyDraft(), ...completePatch()},
    }],
    audit: [
      {id: 'aud-1', timestamp: '2026-11-27T00:00:00.000Z', op: 'soudan.draft.update', actor: {kind: 'human'}, outcome: 'ok', targetKind: 'draft'},
      {id: 'aud-2', timestamp: '2026-11-27T00:01:00.000Z', op: 'soudan.memo.send', actor: {kind: 'human'}, outcome: 'ok', targetKind: 'memo'},
    ],
  });

  // Run a new share whose audit persist fails -> queued with collision-free ID.
  const s = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  assert.equal(s.ok, false);
  assert.equal(s.sent, true);
  assert.equal(s.auditPersisted, false);
  assert.notEqual(s.pendingAuditEntry.id, 'aud-1');
  assert.notEqual(s.pendingAuditEntry.id, 'aud-2');

  // Retry audit persistence -> MUST genuinely persist the 3rd record (not silently deduped away!).
  failPersist = false;
  const retried = await store.retryPendingAudit();
  assert.equal(retried.ok, true);
  assert.equal(retried.auditPersisted, true);
  assert.equal(retried.pendingAuditCount, 0);
  const allAudits = store.getState().audit;
  assert.equal(allAudits.length, 3, 'all 3 audit entries (aud-1, aud-2, plus new share) must be present');
  assert.equal(new Set(allAudits.map(e => e.id)).size, 3, 'all audit IDs are unique');
  assert.ok(allAudits.some(e => e.id === s.pendingAuditEntry.id), 'new share audit entry is genuinely present in state.audit');
});

test('Round-4 Regression B: Share #2 failing audit while retryPendingAudit() for Share #1 is in-flight is never wiped', async () => {
  let shareCalls = 0;
  const fakeBroker = {
    async invoke() {
      shareCalls += 1;
      return {shared: true, route: 'android-share-sheet'};
    },
  };

  let persistMode = 'ok';
  let releaseRetry1;
  const store = createSemanticStore({
    locale: 'ja',
    broker: fakeBroker,
    onPersist: async () => {
      if (persistMode === 'fail') return {ok: false, conflict: false, code: 'data-too-large'};
      if (persistMode === 'defer-once') {
        persistMode = 'fail'; // Concurrent Share #2 during in-flight retry will fail persist!
        return new Promise(resolve => { releaseRetry1 = () => resolve({ok: true}); });
      }
      return {ok: true};
    },
  });

  await store.execute('soudan.draft.update', {patch: completePatch()}, {actor: {kind: 'human'}});

  // Share #1 succeeds externally, fails audit persist -> queued as pending entry #1.
  persistMode = 'fail';
  const s1 = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  assert.equal(s1.sent, true);
  assert.equal(s1.auditPersisted, false);
  assert.equal(store.getPendingAuditCount(), 1);

  // Kick off retryPendingAudit() for Share #1 with deferred in-flight onPersist.
  persistMode = 'defer-once';
  const retry1Promise = store.retryPendingAudit();

  // While retry1 is still in-flight, Share #2 completes and fails its audit persist!
  const s2 = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  assert.equal(s2.sent, true);
  assert.equal(s2.auditPersisted, false);
  assert.equal(shareCalls, 2);
  assert.equal(store.getPendingAuditCount(), 2, 'both Share #1 and Share #2 are queued before retry1 settles');

  // Now resolve Share #1's in-flight retry as ok:true -> ONLY Share #1 is removed; Share #2 MUST remain queued!
  releaseRetry1();
  const retry1Res = await retry1Promise;
  assert.equal(retry1Res.ok, true);
  assert.equal(retry1Res.flushedCount, 1);
  assert.equal(retry1Res.pendingAuditCount, 1, 'Share #2 must still remain queued');
  assert.equal(store.getPendingAuditCount(), 1);
  assert.equal(store.getPendingAudits()[0].id, s2.pendingAuditEntry.id);
  assert.ok(store.getState().audit.some(e => e.id === s1.pendingAuditEntry.id), 'Share #1 audit is persisted');

  // Second retryPendingAudit() persists Share #2 cleanly without repeating any share!
  persistMode = 'ok';
  const retry2Res = await store.retryPendingAudit();
  assert.equal(retry2Res.ok, true);
  assert.equal(retry2Res.pendingAuditCount, 0);
  assert.equal(store.getPendingAuditCount(), 0);
  assert.equal(shareCalls, 2, 'zero repeated shares');
  const sendAudits = store.getState().audit.filter(e => e.op === 'soudan.memo.send' && e.outcome === 'ok');
  assert.equal(sendAudits.length, 2, 'both Share #1 and Share #2 are recorded in state.audit');
  assert.ok(sendAudits.some(e => e.id === s1.pendingAuditEntry.id));
  assert.ok(sendAudits.some(e => e.id === s2.pendingAuditEntry.id));
});

test('Round-5 Regression A: 101 pending entries retry persists 100, reports audit-retention-cap-exceeded, keeps exact 1 unpersisted entry, and second retry flushes it', async () => {
  let shareCalls = 0;
  const fakeBroker = {
    async invoke() {
      await Promise.resolve();
      shareCalls += 1;
      return {shared: true, route: 'android-share-sheet'};
    },
  };

  let failPersist = false;
  let lastPersistedAudit = [];
  const store = createSemanticStore({
    locale: 'ja',
    broker: fakeBroker,
    onPersist: async next => {
      if (failPersist) return {ok: false, conflict: false, code: 'data-too-large'};
      lastPersistedAudit = next.audit.map(e => ({...e}));
      return {ok: true};
    },
  });

  await store.execute('soudan.draft.update', {patch: completePatch()}, {actor: {kind: 'human'}});

  // Queue 99 sequential failed-audit shares, then 2 concurrent shares while backlog is 99 -> 101 pending entries.
  failPersist = true;
  for (let i = 0; i < 99; i += 1) {
    const r = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
    assert.equal(r.sent, true);
    assert.equal(r.auditPersisted, false);
  }
  assert.equal(store.getPendingAuditCount(), 99);

  const [c1, c2] = await Promise.all([
    store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}}),
    store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}}),
  ]);
  assert.equal(c1.sent, true);
  assert.equal(c2.sent, true);
  assert.equal(c1.auditPersisted, false);
  assert.equal(c2.auditPersisted, false);
  assert.equal(shareCalls, 101);
  assert.equal(store.getPendingAuditCount(), 101);

  const queuedBeforeRetry = store.getPendingAudits().map(e => e.id);
  assert.equal(new Set(queuedBeforeRetry).size, 101);

  // First retryPendingAudit(): only 100 fit under MAX_AUDIT_ENTRIES; exact 1 unpersisted entry stays queued!
  failPersist = false;
  const retry1 = await store.retryPendingAudit();
  assert.equal(retry1.ok, false);
  assert.equal(retry1.auditPersisted, false);
  assert.equal(retry1.flushedCount, 100);
  assert.equal(retry1.pendingAuditCount, 1);
  assert.equal(retry1.auditError, 'audit-retention-cap-exceeded');
  assert.equal(lastPersistedAudit.length, 100, 'written state.audit contains 100 records');
  assert.equal(store.getState().audit.length, 100);
  assert.equal(store.getPendingAuditCount(), 1);

  const remaining = store.getPendingAudits();
  assert.equal(remaining.length, 1);
  const remainingId = remaining[0].id;
  assert.equal(remainingId, queuedBeforeRetry[0], 'oldest entry truncated by cap remains queued');
  assert.ok(!lastPersistedAudit.some(e => e.id === remainingId), 'remaining entry was not in persisted snapshot');
  const persistedSet = new Set(lastPersistedAudit.map(e => e.id));
  for (const id of queuedBeforeRetry.slice(1)) {
    assert.ok(persistedSet.has(id), `persisted snapshot contains flushed entry ${id}`);
  }

  // Second retryPendingAudit(): persists the remaining 1 entry cleanly without repeating external share.
  const retry2 = await store.retryPendingAudit();
  assert.equal(retry2.ok, true);
  assert.equal(retry2.auditPersisted, true);
  assert.equal(retry2.flushedCount, 1);
  assert.equal(retry2.pendingAuditCount, 0);
  assert.equal(store.getPendingAuditCount(), 0);
  assert.equal(lastPersistedAudit.length, 100);
  assert.ok(lastPersistedAudit.some(e => e.id === remainingId), 'remaining entry is now persisted');
  assert.ok(store.getState().audit.some(e => e.id === remainingId));
  assert.equal(shareCalls, 101, 'retryPendingAudit NEVER repeats external share');
});

test('Round-5 Regression B: 100 pending entries blocks 101st share fail-closed without invoking share adapter and preserves all 100 for recovery', async () => {
  let shareCalls = 0;
  const fakeBroker = {
    async invoke() {
      shareCalls += 1;
      return {shared: true, route: 'android-share-sheet'};
    },
  };

  let failPersist = false;
  const store = createSemanticStore({
    locale: 'ja',
    broker: fakeBroker,
    onPersist: async () => (failPersist ? {ok: false, conflict: false, code: 'data-too-large'} : {ok: true}),
  });

  await store.execute('soudan.draft.update', {patch: completePatch()}, {actor: {kind: 'human'}});

  // Fill pending audit backlog to exactly MAX_AUDIT_ENTRIES (100).
  failPersist = true;
  for (let i = 0; i < 100; i += 1) {
    const r = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
    assert.equal(r.sent, true);
    assert.equal(r.auditPersisted, false);
  }
  assert.equal(store.getPendingAuditCount(), 100);
  const queuedIds = store.getPendingAudits().map(e => e.id);
  assert.equal(queuedIds.length, 100);

  // Reset share counter and attempt a 101st share -> MUST fail closed with zero external share calls.
  shareCalls = 0;
  const blocked = await store.execute('soudan.memo.send', {mode: 'android-share'}, {actor: {kind: 'human'}});
  assert.equal(shareCalls, 0, 'external share adapter MUST NOT be invoked at 100-entry backlog');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.sent, false);
  assert.equal(blocked.auditPersisted, false);
  assert.equal(blocked.error, 'audit-recovery-required');
  assert.equal(blocked.pendingAuditCount, 100);
  assert.deepEqual(store.getPendingAudits().map(e => e.id), queuedIds, 'all 100 pending entries remain intact');

  // Recover via retryPendingAudit() -> all 100 entries persist cleanly.
  failPersist = false;
  const recovered = await store.retryPendingAudit();
  assert.equal(recovered.ok, true);
  assert.equal(recovered.auditPersisted, true);
  assert.equal(recovered.flushedCount, 100);
  assert.equal(recovered.pendingAuditCount, 0);
  assert.equal(store.getPendingAuditCount(), 0);
  assert.equal(shareCalls, 0, 'recovery NEVER repeats external share');
  assert.equal(store.getState().audit.length, 100);
  const persistedIds = new Set(store.getState().audit.map(e => e.id));
  for (const id of queuedIds) {
    assert.ok(persistedIds.has(id), `recovered audit log contains ${id}`);
  }
});
