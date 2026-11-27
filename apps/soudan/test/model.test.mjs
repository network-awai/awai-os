import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CATEGORIES, JURISDICTIONS, LIMITS, emptyDraft, newEvidence, sha256Hex, formatEvidence,
  draftProblems, recipientProblems, assembleMemo, addressedMemo, restoreDraft,
} from '../src/model.js';
import {MESSAGES, translator} from '../src/messages.js';
import {
  runtimeDescriptor, REQUESTED_CAPABILITIES, SEND_SELECTOR, SEND_OPERATION, INFERENCE_OPERATION,
  validateHostLocalContract, validateHtmlSurface, validateCspPolicy,
} from '../src/operations.js';
import {
  clientRuntimeProblems, clientRuntimeConnectSrc, effectiveClientOperations,
} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';

const t = translator('ja');
function fixture() {
  return {
    ...emptyDraft(),
    jurisdiction: 'JPN', category: 'money', summary: '友人に50万円を貸したが返ってこない。',
    timeline: [{date: '2026-03-01', event: '50万円を振り込んだ'}, {date: '', event: '返済の催促をした'}],
    otherParty: '友人A', wish: '返してほしい', deadline: '', documents: ['振込明細', 'LINE のやり取り'],
    name: '山田太郎', contact: 'taro@example.com',
  };
}

test('a complete draft assembles into a memo that repeats the user\'s words under fixed headings', () => {
  const d = fixture();
  assert.deepEqual(draftProblems(d), []);
  const m = assembleMemo(d, t);
  assert.equal(m.template, 'consultation-memo.jpn.v1');
  assert.equal(m.title, '相談メモ（金銭の貸し借り）');
  assert.deepEqual(m.sections.map(s => s.heading), ['分野', '相談の概要', 'これまでの経緯', '相手方', '希望すること', '手元にある資料', '相談者']);
  assert.equal(m.sections[2].body, '2026-03-01　50万円を振り込んだ\n返済の催促をした');
  for (const s of [d.summary, d.wish, d.otherParty, ...d.documents, d.name, d.contact]) assert.ok(m.text.includes(s), s);
  assert.ok(m.text.endsWith(t('memo.notice')));
});

test('assembly adds no words beyond the template: removing the user text leaves only headings, title and notice', () => {
  const d = fixture(), m = assembleMemo(d, t);
  assert.ok(m.text.startsWith(m.title + '\n'));
  let rest = m.text.slice(m.title.length);
  for (const s of m.sections) { rest = rest.replace(s.body, ''); }
  const allowed = [m.notice, ...m.sections.map(s => '■ ' + s.heading)];
  for (const line of rest.split('\n').filter(Boolean)) assert.ok(allowed.includes(line), 'unexpected line: ' + line);
});

test('negative control: no jurisdiction default, and an unknown jurisdiction is refused (O7 is open)', () => {
  assert.equal(emptyDraft().jurisdiction, null);
  assert.deepEqual(Object.keys(JURISDICTIONS), ['JPN']);
  for (const j of [null, 'GBR', 'jpn', '__proto__']) {
    const d = {...fixture(), jurisdiction: j};
    assert.ok(draftProblems(d).includes('jurisdiction.required'), String(j));
    assert.throws(() => assembleMemo(d, t), /draft-incomplete/);
  }
});

test('negative control: missing, oversized and malformed input is refused with message keys', () => {
  const cases = [
    [{summary: ' '}, 'summary.required'],
    [{summary: 'あ'.repeat(LIMITS.summary + 1)}, 'summary.tooLong'],
    [{wish: ''}, 'wish.required'],
    [{category: 'criminal'}, 'category.required'],
    [{timeline: [{date: '2026-02-30', event: 'x'}]}, 'timeline.date'],
    [{timeline: [{date: '', event: ''}]}, 'timeline.event'],
    [{documents: ['']}, 'documents.item'],
    [{name: ''}, 'name.required'],
    [{contact: ''}, 'contact.required'],
    [{timeline: Array.from({length: LIMITS.timeline + 1}, () => ({date: '', event: 'x'}))}, 'timeline.tooMany'],
  ];
  for (const [patch, key] of cases) {
    const p = draftProblems({...fixture(), ...patch});
    assert.ok(p.includes(key), key + ' in ' + p);
    assert.ok(t(key, {max: 1}));
  }
  assert.deepEqual(draftProblems(null), ['draft.invalid']);
});

test('the sent body heads with the destination the user typed, trimmed and without lookup', () => {
  const to = {name: '鈴木花子', office: '鈴木法律事務所', contact: 'hanako@example.jp'};
  assert.equal(addressedMemo('本文', to, t), '宛先: 鈴木花子 / 鈴木法律事務所 / hanako@example.jp\n本文');
  assert.equal(addressedMemo('本文', {...to, office: '  '}, t), '宛先: 鈴木花子 / hanako@example.jp\n本文');
  assert.equal(addressedMemo('本文', {name: '  鈴木花子　', office: '', contact: 'hanako@example.jp'}, t), '宛先: 鈴木花子 / hanako@example.jp\n本文');
  assert.equal(addressedMemo('body', to, translator('en')), 'To: 鈴木花子 / 鈴木法律事務所 / hanako@example.jp\nbody');
  assert.equal(addressedMemo('本文', to, t).split('\n')[0].slice(0, 3), '宛先:');
});

test('the recipient is only what the user typed; shape is checked, nothing is looked up', () => {
  assert.deepEqual(recipientProblems({name: '鈴木花子', office: '', contact: 'hanako@example.jp'}), []);
  assert.deepEqual(recipientProblems({name: '', office: 'x'.repeat(LIMITS.office + 1), contact: ''}), ['recipient.nameProblem', 'recipient.officeProblem', 'recipient.contactProblem']);
  assert.deepEqual(emptyDraft().recipient, {name: '', office: '', contact: ''});
});

test('D9 & Attorney Act: the app ships no list of lawyers and no prohibited ranking/referral/ad wording', () => {
  const src = ['model.js', 'app.js', 'operations.js', 'send.js', 'semantic.js'].map(f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /lawyers\s*[:=]\s*\[|directory|ranking|recommend\(/i);
  for (const key of Object.keys(MESSAGES.ja)) {
    assert.doesNotMatch(MESSAGES.ja[key], /おすすめ|ランキング|紹介します|候補|弁護士マッチング|紹介|専門|スペシャリスト|エキスパート|勝訴率|解決件数|口コミ|必ず解決|すぐ解決/, key);
  }
});

test('restoring a stored draft keeps known fields of the right type only', () => {
  const d = restoreDraft({
    jurisdiction: 'GBR', category: 'money', summary: 1, wish: 'w',
    timeline: [{date: '', event: 'e'}, {date: 1}], documents: ['a', 2], recipient: {name: 'n', contact: 3}, extra: 'x',
  });
  assert.equal(d.jurisdiction, null);
  assert.equal(d.category, 'money');
  assert.equal(d.summary, '');
  assert.equal(d.wish, 'w');
  assert.deepEqual(d.timeline, [{date: '', event: 'e'}]);
  assert.deepEqual(d.documents, ['a']);
  assert.deepEqual(d.recipient, {name: 'n', office: '', contact: ''});
  assert.ok(!('extra' in d));
  assert.deepEqual(restoreDraft(null), emptyDraft());
});

test('every category and every problem key has ja and en text', () => {
  for (const l of ['ja', 'en']) {
    const tl = translator(l);
    for (const c of CATEGORIES) assert.ok(tl('category.' + c));
    for (const k of ['summary.tooLong', 'timeline.event']) assert.ok(tl(k, {max: 1}));
  }
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ja).sort());
});

// AWAI-3505 scope 3 (O11): the lawyer-facing list.
const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
function evidenceRow(patch = {}) {
  return {
    url: 'https://example.com/posts/123', postedAt: '2026-11-20T21:00',
    authorName: '表示名', authorId: 'user123', shotName: 'shot.png', shotSize: 12345, sha256: SHA256_ABC,
    capturedAt: '2026-11-21T10:00:00.000Z', ...patch,
  };
}
function evidenceFixture() { const d = fixture(); d.evidence = [evidenceRow()]; return d; }

test('sha256Hex matches known vectors and refuses non-bytes', () => {
  const enc = new TextEncoder();
  assert.equal(sha256Hex(new Uint8Array([])), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex(enc.encode('abc')), SHA256_ABC);
  assert.equal(sha256Hex(enc.encode('hello world')), 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  assert.throws(() => sha256Hex('abc'), /bytes-required/);
});

test('evidence rows accept blank optionals and date-only posts; bad shapes are refused with keys', () => {
  assert.deepEqual(draftProblems(evidenceFixture()), []);
  assert.deepEqual(draftProblems({...evidenceFixture(), evidence: [evidenceRow({postedAt: ''})]}), []);
  assert.deepEqual(draftProblems({...evidenceFixture(), evidence: [evidenceRow({postedAt: '2026-11-20'})]}), []);
  assert.deepEqual(draftProblems({...evidenceFixture(), evidence: [evidenceRow({shotName: '', shotSize: 0, sha256: '', capturedAt: ''})]}), []);
  const cases = [
    [{url: ''}, 'evidence.urlProblem'],
    [{url: 'ftp://example.com/x'}, 'evidence.urlProblem'],
    [{url: 'notaurl'}, 'evidence.urlProblem'],
    [{url: 'https://exa mple.com/'}, 'evidence.urlProblem'],
    [{postedAt: '2026-02-30'}, 'evidence.postedAtProblem'],
    [{postedAt: 'tomorrow'}, 'evidence.postedAtProblem'],
    [{postedAt: '2026-11-20T25:00'}, 'evidence.postedAtProblem'],
    [{authorName: 'あ'.repeat(LIMITS.evidenceField + 1)}, 'evidence.authorProblem'],
    [{authorId: 'x'.repeat(LIMITS.evidenceField + 1)}, 'evidence.authorProblem'],
    [{sha256: 'xyz'}, 'evidence.shotProblem'],
    [{shotSize: -1}, 'evidence.shotProblem'],
    [{capturedAt: 'not-a-date'}, 'evidence.capturedAtProblem'],
  ];
  for (const [patch, key] of cases) {
    const p = draftProblems({...evidenceFixture(), evidence: [evidenceRow(patch)]});
    assert.ok(p.includes(key), key + ' in ' + p);
    assert.ok(t(key));
  }
  assert.ok(draftProblems({...fixture(), evidence: Array.from({length: LIMITS.evidence + 1}, () => evidenceRow())}).includes('evidence.tooMany'));
  assert.ok(draftProblems({...fixture(), evidence: [null]}).includes('evidence.urlProblem'));
  assert.deepEqual(emptyDraft().evidence, []);
});

test('the memo gains a lawyer-facing list that repeats the user rows and judges nothing', () => {
  const d = evidenceFixture(), m = assembleMemo(d, t);
  const i = m.sections.findIndex(s => s.heading === '弁護士に見せるための一覧');
  assert.ok(i >= 0, 'evidence section is titled the lawyer-facing list');
  assert.equal(m.sections[i].body, formatEvidence(d.evidence, t));
  const enBody = assembleMemo(d, translator('en')).sections.find(s => s.heading === 'List for your lawyer')?.body ?? '';
  for (const s of ['https://example.com/posts/123', '表示名', 'user123', 'shot.png', SHA256_ABC]) assert.ok(enBody.includes(s), 'en list carries the same user rows: ' + s);
  const body = m.sections[i].body;
  for (const s of ['https://example.com/posts/123', '2026-11-20T21:00', '表示名', 'user123', 'shot.png', '12345', SHA256_ABC, '2026-11-21T10:00:00.000Z']) assert.ok(body.includes(s), s);
  for (const w of ['明らか', '正当な理由', '認められ', '間に合', '申立て', '請求書', '見込み']) assert.ok(!m.text.includes(w), 'no judgment wording: ' + w);
  assert.ok(m.text.includes(t('memo.notice')));
});

test('the sent memo carries the list as text only, never image bytes', () => {
  const m = assembleMemo(evidenceFixture(), t);
  assert.ok(m.text.includes('弁護士に見せるための一覧'));
  assert.ok(!m.text.includes('data:image'));
});

test('restoring keeps evidence rows of the right shape only', () => {
  const row = evidenceRow();
  const d = restoreDraft({evidence: [row, {url: 1, shotSize: -5}, 'x', null, 42]});
  assert.equal(d.evidence.length, 2);
  assert.deepEqual(d.evidence[0], row);
  assert.deepEqual(d.evidence[1], {...newEvidence()});
  assert.deepEqual(restoreDraft({}).evidence, []);
  assert.ok(draftProblems({...evidenceFixture(), evidence: d.evidence.slice(0, 1)}).length === 0);
});

test('O11: no investigation portals, no deadline math, only user-facing routes with sources and dates', () => {
  const src = ['model.js', 'app.js', 'operations.js', 'send.js', 'inference.js', 'semantic.js', 'mcp-app.js']
    .map(f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')).join('\n')
    + JSON.stringify(MESSAGES.ja) + JSON.stringify(MESSAGES.en);
  assert.doesNotMatch(src, /portal/i);
  assert.doesNotMatch(src, /Government Request/);
  for (const w of ['あと何日', 'この日までに', '間に合います']) assert.ok(!src.includes(w), 'no deadline verdict: ' + w);
  for (const r of ['#9110', '法務局', '違法・有害情報相談センター', '送信防止措置', '発信者情報開示命令', '各社の削除・開示請求フォーム']) assert.ok(src.includes(r), 'route present: ' + r);
  assert.ok(MESSAGES.ja['guide.deadline'].includes('目安') && MESSAGES.ja['guide.deadline'].includes('各社'));
  assert.ok(MESSAGES.ja['guide.source'].includes('413AC0000000137') && MESSAGES.ja['guide.source'].includes('2026-11-22'));
  assert.ok(MESSAGES.ja['guide.noJudgment'].includes('判断しません'));
  assert.ok(MESSAGES.en['guide.deadline'].includes('rough guide') && MESSAGES.en['guide.deadline'].includes('varies by company'));
  assert.ok(MESSAGES.en['guide.source'].includes('413AC0000000137') && MESSAGES.en['guide.source'].includes('2026-11-22'));
});

test('the restricted-wasm-v1 descriptor declares O1/D9 send and murakumo.cloud routes with zero app-origin calls', () => {
  const d = runtimeDescriptor();
  const origins = ['https://soudan.itonami.app', 'http://tauri.localhost', 'https://tauri.localhost'];
  assert.equal(d.profile, 'restricted-wasm-v1');
  assert.deepEqual(clientRuntimeProblems(d, [...REQUESTED_CAPABILITIES], origins), []);
  assert.deepEqual(d.operations, [SEND_OPERATION, INFERENCE_OPERATION]);
  assert.equal(clientRuntimeConnectSrc(d, [...REQUESTED_CAPABILITIES], [], origins), 'connect-src https://api.murakumo.cloud');
});

test('the send is eligible only when governor-approved and host-supported; a fabricated origin never matches', () => {
  const d = runtimeDescriptor(), host = [[SEND_SELECTOR.capability, SEND_SELECTOR.service, SEND_SELECTOR.operation]];
  assert.equal(effectiveClientOperations(d, {requestedCapabilities: [...REQUESTED_CAPABILITIES], approvedOperations: d.operations, hostSupportedOperations: host}).length, 1);
  for (const opts of [{approvedOperations: [], hostSupportedOperations: host}, {approvedOperations: d.operations, hostSupportedOperations: []}]) {
    assert.deepEqual(effectiveClientOperations(d, {requestedCapabilities: [...REQUESTED_CAPABILITIES], ...opts}), []);
  }
  const forged = {...SEND_SELECTOR, consent: 'each-operation', 'data-categories': ['legal.consultation-memo'], endpoint: {origin: 'https://example.com', 'browser-action': 'share'}};
  assert.deepEqual(effectiveClientOperations(d, {requestedCapabilities: [...REQUESTED_CAPABILITIES], approvedOperations: [forged], hostSupportedOperations: host}), []);
});

test('Web static HTML CSPs (connect-src none) and Tauri CSP (IPC only) are verified independently; no INTERNET permission', () => {
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const embedHtml = readFileSync(new URL('../src/embed.html', import.meta.url), 'utf8');
  const foreignHtml = readFileSync(new URL('../src/foreign-info.html', import.meta.url), 'utf8');
  const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const manifest = readFileSync(new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

  // Web static HTML files MUST use connect-src 'none' (Dev #220) + no-referrer.
  for (const page of [html, embedHtml, foreignHtml]) {
    const csp = page.match(/Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(csp, /connect-src 'none';/);
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|ipc:|https:/);
    assert.match(page, /name="referrer" content="no-referrer"/);
  }
  // Tauri CSP stays separate and allows Tauri IPC only, pointing frontendDist at ../dist-tauri.
  assert.match(conf.app.security.csp, /connect-src ipc: http:\/\/ipc\.localhost;/);
  assert.doesNotMatch(conf.app.security.csp, /unsafe-eval|unsafe-inline|https:/);
  assert.equal(conf.build.frontendDist, '../dist-tauri');
  assert.equal(conf.build.beforeBuildCommand, 'npm run build:tauri');

  // Android manifest stays offline-default (no INTERNET permission, allowBackup="false").
  assert.ok(manifest.includes('android:allowBackup="false"'));
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);

  const caps = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/main.json', import.meta.url), 'utf8'));
  assert.deepEqual(caps.permissions, ['allow-awai-host-info', 'allow-soudan-share']);
});

test('Zone B-25 Z25-06: validateHostLocalContract accepts exact descriptor and rejects widened calls, storage drift, or undeclared MIME types', () => {
  const valid = runtimeDescriptor('ja');
  assert.deepEqual(validateHostLocalContract(valid), {ok: true, problems: []});
  const checkedIn = JSON.parse(readFileSync(new URL('../app-descriptor.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateHostLocalContract(checkedIn), {ok: true, problems: []});

  // Negative control 1: widened host-local.calls (network.fetch / clipboard.read)
  for (const extraCall of ['network.fetch', 'clipboard.read']) {
    const widened = structuredClone(valid);
    widened['host-local'].calls.push(extraCall);
    const res = validateHostLocalContract(widened);
    assert.equal(res.ok, false, `must reject widened call ${extraCall}`);
    assert.ok(res.problems.some(p => p === `host-local.calls.widened:${extraCall}`), JSON.stringify(res.problems));
  }

  // Negative control 2: missing required host-local call
  const missingCall = structuredClone(valid);
  missingCall['host-local'].calls = ['storage.get', 'storage.put', 'storage.delete'];
  const missingRes = validateHostLocalContract(missingCall);
  assert.equal(missingRes.ok, false);
  assert.ok(missingRes.problems.includes('host-local.calls.missing:device.save'));

  // Negative control 3: undeclared MIME type (text/markdown) & extra octet-stream extension
  const badMime = structuredClone(valid);
  badMime['host-local'].save['mime-types'].push('text/markdown');
  const mimeRes = validateHostLocalContract(badMime);
  assert.equal(mimeRes.ok, false, 'must reject undeclared MIME type text/markdown');
  assert.ok(mimeRes.problems.includes('host-local.save.mime-type-undeclared:text/markdown'));

  const badExt = structuredClone(valid);
  badExt['host-local'].save['octet-stream-extensions'].push('html');
  const extRes = validateHostLocalContract(badExt);
  assert.equal(extRes.ok, false);
  assert.ok(extRes.problems.includes('host-local.save.octet-stream-extension-undeclared:html'));

  // Negative control 4: host-local.storage invariant violations
  for (const [field, badVal] of [
    ['class', 'synced'],
    ['backup', 'included'],
    ['at-rest', 'plaintext'],
    ['erasable', false],
    ['quota-bytes', 2097152],
    ['max-entries', 128],
  ]) {
    const badStorage = structuredClone(valid);
    badStorage['host-local'].storage[field] = badVal;
    const sRes = validateHostLocalContract(badStorage);
    assert.equal(sRes.ok, false, `must reject storage.${field}=${badVal}`);
    assert.ok(sRes.problems.includes(`host-local.storage.${field}`));
  }
});

test('Zone B-25 Z25-06: validateHtmlSurface rejects remote script URLs (https://, //, http://) and widened CSP across surfaces', () => {
  // Positive control: all checked-in source HTML surfaces and Tauri CSP pass cleanly.
  const indexHtml = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const embedHtml = readFileSync(new URL('../src/embed.html', import.meta.url), 'utf8');
  const foreignHtml = readFileSync(new URL('../src/foreign-info.html', import.meta.url), 'utf8');
  assert.deepEqual(validateHtmlSurface(indexHtml, {name: 'src/index.html', expectedConnectSrc: 'none', allowScriptless: false}), {ok: true, problems: []});
  assert.deepEqual(validateHtmlSurface(embedHtml, {name: 'src/embed.html', expectedConnectSrc: 'none', allowScriptless: false}), {ok: true, problems: []});
  assert.deepEqual(validateHtmlSurface(foreignHtml, {name: 'src/foreign-info.html', expectedConnectSrc: 'none', allowScriptless: true}), {ok: true, problems: []});

  const tauriConf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateCspPolicy(tauriConf.app.security.csp, {expectedConnectSrc: 'tauri-ipc', allowScriptless: false}), {ok: true, problems: []});

  // Negative control 1: remote https:// script tag
  const remoteHttpsHtml = indexHtml.replace(
    '<script type="module" src="app.js"></script>',
    '<script src="https://example.com/x.js"></script>',
  );
  const httpsRes = validateHtmlSurface(remoteHttpsHtml, {name: 'neg-https', expectedConnectSrc: 'none', allowScriptless: false});
  assert.equal(httpsRes.ok, false, 'must reject remote https:// script tag');
  assert.ok(httpsRes.problems.some(p => p.includes('remote-script-src:https://example.com/x.js')), JSON.stringify(httpsRes.problems));

  // Negative control 2: protocol-relative //example.com/x.js script tag
  const protoRelHtml = indexHtml.replace(
    '<script type="module" src="app.js"></script>',
    '<script src="//example.com/x.js"></script>',
  );
  const protoRelRes = validateHtmlSurface(protoRelHtml, {name: 'neg-proto-rel', expectedConnectSrc: 'none', allowScriptless: false});
  assert.equal(protoRelRes.ok, false, 'must reject protocol-relative // script tag');
  assert.ok(protoRelRes.problems.some(p => p.includes('remote-script-src://example.com/x.js')), JSON.stringify(protoRelRes.problems));

  // Negative control 3: widened CSP script-src with remote origin
  const widenedCspHtml = indexHtml.replace("script-src 'self';", "script-src 'self' https://example.com;");
  const widenedCspRes = validateHtmlSurface(widenedCspHtml, {name: 'neg-csp', expectedConnectSrc: 'none', allowScriptless: false});
  assert.equal(widenedCspRes.ok, false);
  assert.ok(widenedCspRes.problems.some(p => p.includes('csp.script-src-widened')), JSON.stringify(widenedCspRes.problems));

  // Negative control 4: script tag injected into scriptless foreign-info.html
  const injectedForeign = foreignHtml.replace('</head>', '  <script src="app.js"></script>\n</head>');
  const injectedForeignRes = validateHtmlSurface(injectedForeign, {name: 'neg-foreign', expectedConnectSrc: 'none', allowScriptless: true});
  assert.equal(injectedForeignRes.ok, false);
  assert.ok(injectedForeignRes.problems.some(p => p.includes('csp.script-tag-in-scriptless-surface')));

  // Negative control 5: guest-srcdoc with external or remote script src
  const badGuest = '<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body><script src="https://example.com/x.js"></script></body></html>';
  const badGuestRes = validateHtmlSurface(badGuest, {name: 'neg-guest', expectedConnectSrc: 'guest-srcdoc'});
  assert.equal(badGuestRes.ok, false);
  assert.ok(badGuestRes.problems.some(p => p.includes('guest.external-script-src')));
  assert.ok(badGuestRes.problems.some(p => p.includes('remote-script-src:https://example.com/x.js')));
});
