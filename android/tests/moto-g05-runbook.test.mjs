// Drift guard for the moto g05 Store key-list & auto-update runbook (AWAI-3653, AWAI-3775, AWAI-3184).
// Keeps the active runbook instructions aligned with the committed key-list root, sequence-2 role keys,
// r114 catalog, sequence-5 pointer, PR #532 17-APK pin requirement, bundled vs online catalog separation,
// highest > 114 rollback handling, and InstallReceiver/AutoUpdater log evidence while preserving the
// 2026-11-22 emulator rehearsal as clearly labeled history.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const RUNBOOK_PATH = path.join(root, 'docs/otehon/itonami-store-key-list-moto-g05-20261122.md');

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function utcDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function parseKeyListRaw(rawText) {
  const lines = rawText.trimEnd().split('\n');
  const seqLine = lines.find(line => line.startsWith('sequence '));
  const expLine = lines.find(line => line.startsWith('expires '));
  assert(seqLine, 'keys-envelope raw missing sequence line');
  assert(expLine, 'keys-envelope raw missing expires line');
  const roleKeys = {};
  for (const line of lines) {
    if (!line.startsWith('key ')) continue;
    const [, role, b64] = line.split(' ');
    roleKeys[role] = sha256Hex(Buffer.from(b64, 'base64'));
  }
  return {
    sequence: Number(seqLine.split(' ')[1]),
    expiresAt: Number(expLine.split(' ')[1]),
    catalogKey: roleKeys.catalog,
    pointerKey: roleKeys.pointer,
  };
}

function sliceSection(text, startPattern, endPattern, label) {
  const startMatch = text.match(startPattern);
  assert(startMatch, `runbook missing section start: ${label}`);
  const rest = text.slice(startMatch.index);
  if (!endPattern) return rest;
  const endMatch = rest.slice(startMatch[0].length).match(endPattern);
  assert(endMatch, `runbook missing section end: ${label}`);
  return rest.slice(0, startMatch[0].length + endMatch.index);
}

function splitRunbook(text) {
  const rehearsalMarker = /^## emulator での予行/m;
  const rehearsalMatch = text.match(rehearsalMarker);
  assert(rehearsalMatch, 'runbook must keep the 2026-11-22 emulator rehearsal section');
  const activeSection = text.slice(0, rehearsalMatch.index);
  const historicalSection = text.slice(rehearsalMatch.index);

  const stepsMarker = /^## 0\. 用意（Mac）/m;
  const stepsMatch = activeSection.match(stepsMarker);
  assert(stepsMatch, 'runbook must contain active section "## 0. 用意（Mac）"');
  const preambleSection = activeSection.slice(0, stepsMatch.index);
  const activeInstructions = activeSection.slice(stepsMatch.index);

  const section0 = sliceSection(activeInstructions, /^## 0\. 用意（Mac）/m, /^## 1\. /m, 'section 0');
  const section3 = sliceSection(activeInstructions, /^## 3\. 作業後の記録と確認/m, /^## 4\. /m, 'section 3');
  const section4 = sliceSection(activeInstructions, /^## 4\. AWAI-3653 /m, /^## 失敗したとき・戻し方/m, 'section 4');

  return {activeSection, preambleSection, activeInstructions, section0, section3, section4, historicalSection};
}

function tableRows(sectionText) {
  return sectionText
    .split('\n')
    .filter(line => line.startsWith('|') && !line.startsWith('|---') && !line.startsWith('| 項目 |'));
}

const runbookText = readFileSync(RUNBOOK_PATH, 'utf8');
const {
  activeSection,
  preambleSection,
  activeInstructions,
  section0,
  section3,
  section4,
  historicalSection,
} = splitRunbook(runbookText);

const rootDer = readFileSync(path.join(root, 'store/keys/store-root.der'));
const rootPrefix = sha256Hex(rootDer).slice(0, 8);

const keysEnvelope = JSON.parse(readFileSync(path.join(root, 'store/latest/keys-envelope.json'), 'utf8'));
const keyList = parseKeyListRaw(keysEnvelope.raw);
const catalogKeyPrefix = keyList.catalogKey.slice(0, 8);
const pointerKeyPrefix = keyList.pointerKey.slice(0, 8);

const pointerEnvelope = JSON.parse(readFileSync(path.join(root, 'store/latest/pointer-envelope.json'), 'utf8'));
const pointer = JSON.parse(pointerEnvelope.raw);

const catalog = JSON.parse(
  readFileSync(path.join(root, 'store/distribution/dev-20261123-r114/catalog-rev114-raw.json'), 'utf8'),
);

test('active moto g05 runbook matches live root, key list sequence 2, r114 catalog, pointer sequence 5, and PR #532', () => {
  assert.equal(keyList.sequence, 2);
  assert.equal(catalog.revision, 114);
  assert.equal(pointer.sequence, 5);

  const catalogExpiry = utcDate(catalog.expiresAt);
  const pointerExpiry = utcDate(pointer.expiresAt);
  const keyListExpiry = utcDate(keyList.expiresAt);

  // Live trust & catalog/pointer facts cited in the active runbook
  assert(activeSection.includes(rootPrefix), `active runbook must cite live root prefix ${rootPrefix}`);
  assert(activeSection.includes(`sequence ${keyList.sequence}`), `active runbook must cite key-list sequence ${keyList.sequence}`);
  assert(activeSection.includes(catalogKeyPrefix), `active runbook must cite live catalog key prefix ${catalogKeyPrefix}`);
  assert(activeSection.includes(pointerKeyPrefix), `active runbook must cite live pointer key prefix ${pointerKeyPrefix}`);
  assert(activeSection.includes(`r${catalog.revision}`), `active runbook must cite catalog r${catalog.revision}`);
  assert(activeSection.includes(`--catalog-revision ${catalog.revision}`), `active runbook must use --catalog-revision ${catalog.revision}`);
  assert(activeSection.includes(`sequence ${pointer.sequence}`), `active runbook must cite pointer sequence ${pointer.sequence}`);
  assert(activeSection.includes(catalogExpiry), `active runbook must cite catalog expiry ${catalogExpiry}`);
  assert(activeSection.includes(pointerExpiry), `active runbook must cite pointer expiry ${pointerExpiry}`);
  assert(activeSection.includes(keyListExpiry), `active runbook must cite key-list expiry ${keyListExpiry}`);
  assert(activeSection.includes('927cd3c2'), 'active runbook must note main >= 927cd3c2');
  assert(activeSection.includes('PR #532'), 'active runbook must note PR #532');
  assert(activeSection.includes(`${catalog.apps.length} APK`), `active runbook must note ${catalog.apps.length} APK pins`);

  // Active build & verification steps specifically cite current live targets
  assert(section0.includes(`--catalog-revision ${catalog.revision}`));
  assert(section0.includes(rootPrefix));
  assert(section0.includes(catalogKeyPrefix));
  assert(section0.includes(pointerKeyPrefix));
  assert(section3.includes('`highest` が `2`'));
  assert(section3.includes('`highest` `114`'));
  assert(section3.includes(`sequence ${pointer.sequence}`));
});

test('§0 and §3 separate bundled 2-app catalog (Yotei/Torihiki) from post-admission online r114 (17 apps)', () => {
  // §0 explains that the standard build bundles Yotei + Torihiki (2 apps) while --online-pins pins online r114 (17 APK)
  assert(section0.includes('Yotei') && section0.includes('Torihiki') && section0.includes('2 件'));
  assert(section0.includes(`${catalog.apps.length} APK`));

  const rows = tableRows(section3);
  const initialScreenRow = rows.find(row => row.includes('Store の画面'));
  assert(initialScreenRow, '§3 table must have an initial Store screen verification row');
  assert(initialScreenRow.includes('Yotei') && initialScreenRow.includes('Torihiki') && initialScreenRow.includes('2 件'),
    'initial Store screen row must expect the bundled Yotei/Torihiki (2 apps) catalog');
  assert(!initialScreenRow.includes(`${catalog.apps.length} APK`) && !initialScreenRow.includes(`${catalog.apps.length} 件`),
    'initial Store screen row must not expect the 17-app online r114 catalog before online admission');

  const onlineAdmitRow = rows.find(row => row.includes('オンラインカタログを確認') && row.includes('highest <= 114'));
  assert(onlineAdmitRow, '§3 table must have a post-admission manual online check row for highest <= 114');
  assert(onlineAdmitRow.includes(`r${catalog.revision}`) && onlineAdmitRow.includes(`${catalog.apps.length} APK`),
    'post-admission online check row must expect the 17-app r114 catalog');
  assert(onlineAdmitRow.includes('`raw64`') && onlineAdmitRow.includes('`highest` `114`'));
});

test('§3 branches manual and daily online verification on terminal floor highest <= 114 vs highest > 114', () => {
  const rows = tableRows(section3);

  const clientJs = readFileSync(path.join(root, 'android/client/client.js'), 'utf8');
  const onlineJs = readFileSync(path.join(root, 'android/client/online.js'), 'utf8');
  const autoUpdaterJava = readFileSync(path.join(root, 'android/shared/src/network/awai/platform/AutoUpdater.java'), 'utf8');
  const latestPointerJava = readFileSync(path.join(root, 'android/shared/src/network/awai/platform/LatestPointer.java'), 'utf8');

  const manualPrefix = '取得を完了できません。';
  const manualReason = '有効期限またはカタログの巻き戻しを検出しました。';
  assert(clientJs.includes(manualPrefix), 'client.js must contain the manual failure notification prefix');
  assert(onlineJs.includes(manualReason), 'online.js must contain the WebView rollback/expiry refusal message');
  assert(autoUpdaterJava.includes('"catalog-rollback"'), 'AutoUpdater.java must emit catalog-rollback');
  assert(latestPointerJava.includes('"pointer-rollback"'), 'LatestPointer.java must emit pointer-rollback');

  // Manual highest > 114: stops in WebView before native admitOnlineCatalog, never prints native catalog-rollback,
  // verifies highest unchanged, and requires rebuilding/reinstalling the APK with updated --online-pins for manual re-test.
  const manualHighFloor = rows.find(row => row.includes('オンラインカタログを確認') && row.includes('highest > 114'));
  assert(manualHighFloor, '§3 must cover manual online check when terminal floor highest > 114');
  assert(manualHighFloor.includes(manualPrefix + manualReason),
    'highest > 114 manual row must cite the exact WebView refusal notification from client.js + online.js');
  assert(!manualHighFloor.includes('catalog-rollback'),
    'highest > 114 manual row must not expect native catalog-rollback on the manual UI path');
  assert(manualHighFloor.includes('highest') && manualHighFloor.includes('変わらない'),
    'highest > 114 manual row must verify highest stays unchanged');
  assert(manualHighFloor.includes('--online-pins') && manualHighFloor.includes('再ビルド') && manualHighFloor.includes('adb install -r'),
    'highest > 114 manual row must instruct rebuilding and reinstalling with updated --online-pins for manual re-test');

  // Daily highest <= 114: separates catalog log detail ("sequence 5" only) from admitted catalog revision/expiry check.
  const dailyLowFloor = rows.find(row => row.includes('自動更新') && row.includes('highest <= 114'));
  assert(dailyLowFloor, '§3 must cover daily auto-update when terminal floor highest <= 114');
  assert(dailyLowFloor.includes('`catalog`') && dailyLowFloor.includes(`\`sequence ${pointer.sequence}\` のみ`),
    'daily highest <= 114 row must note that catalog log detail records only sequence 5');
  assert(!dailyLowFloor.includes(`catalog\`（pointer \`sequence ${pointer.sequence}\`、\`r${catalog.revision}\``),
    'daily highest <= 114 row must not claim r114 or expiry appear in the catalog log detail');
  assert(dailyLowFloor.includes('after-online.xml') && dailyLowFloor.includes('raw64') &&
    dailyLowFloor.includes(String(catalog.revision)) && dailyLowFloor.includes(utcDate(catalog.expiresAt)),
    'daily highest <= 114 row must verify revision 114 and expiry separately from admitted after-online.xml raw64');

  // Daily highest > 114: covers both pointer-sequence <= 5 (catalog-rollback) and pointer-sequence > 5 (pointer-rollback).
  const dailyHighFloor = rows.find(row => row.includes('自動更新') && row.includes('highest > 114'));
  assert(dailyHighFloor, '§3 must cover daily auto-update when terminal floor highest > 114');
  assert(dailyHighFloor.includes(`pointer-sequence <= ${pointer.sequence}`) && dailyHighFloor.includes('catalog-rollback'),
    'daily highest > 114 row must expect catalog-rollback when device pointer-sequence <= 5');
  assert(dailyHighFloor.includes(`pointer-sequence > ${pointer.sequence}`) && dailyHighFloor.includes('pointer-rollback'),
    'daily highest > 114 row must expect pointer-rollback when device pointer-sequence > 5');
  assert(dailyHighFloor.includes('revision >= highest') && dailyHighFloor.includes('直接取得'),
    'daily highest > 114 row must explain daily re-testing fetches the new signed pointer directly');
});

test('§4 aligns AWAI-3653 standing-update-approval checks with InstallReceiver/AutoUpdater logs and separate versionCode comparison', () => {
  assert(section4.includes('AWAI-3653'));
  assert(section4.includes('サイレント更新'));
  assert(section4.includes('`installing`') && section4.includes('`versionName`'),
    '§4 must check installing log detail against versionName');
  assert(section4.includes('`installed`') && section4.includes('対象 app ID'),
    '§4 must check installed log for the target package ID');
  assert(section4.includes('dumpsys package') && section4.includes('versionCode') && section4.includes('署名済みカタログ'),
    '§4 must compare device package versionCode separately against the signed catalog expected versionCode');
  assert(!section4.includes('ログと対象 app の `versionCode` が一致'),
    '§4 must not claim auto-update logs record versionCode');
  assert(section4.includes('再起動') && section4.includes('3668'));
  assert(section4.includes('バックグラウンド') && section4.includes('0 件'));
});

test('active runbook instructions do not cite retired keys or r110 build/pointer values', () => {
  assert(!activeSection.includes('--catalog-revision 110'), 'active runbook must not cite --catalog-revision 110');

  const retiredInInstructions = [
    ['c3ad794d', /c3ad794d/],
    ['82522d92', /82522d92/],
    ['8250a122', /8250a122/],
    ['--catalog-revision 110', /--catalog-revision\s+110\b/],
    ['r110', /\br110\b/],
    ['sequence 1', /\bsequence\s+1\b/],
    ['sequence 4', /\bsequence\s+4\b/],
  ];
  for (const [label, pattern] of retiredInInstructions) {
    assert(
      !pattern.test(activeInstructions),
      `active instructions (## 0..end before rehearsal) must not cite retired ${label}`,
    );
  }

  // If the preamble mentions retired sequence-1 key IDs for re-root context, each line must label them retired.
  for (const line of preambleSection.split('\n')) {
    if (/c3ad794d|82522d92|8250a122/.test(line)) {
      assert(line.includes('廃止'), `retired key ID in preamble must be explicitly labeled retired: ${line}`);
    }
  }
});

test('2026-11-22 emulator rehearsal section stays intact and clearly labeled as history', () => {
  const heading = historicalSection.split('\n', 1)[0];
  assert(heading.includes('履歴'), 'historical rehearsal heading must label it as history');
  assert(heading.includes('2026-11-22'), 'historical rehearsal heading must keep 2026-11-22');
  assert(heading.includes('sequence 1') && heading.includes('r110'), 'historical rehearsal heading must name sequence 1 / r110');
  assert(historicalSection.includes('docs/evidence/store-key-list-dev-keys-awai3775-20261122/'));
  assert(historicalSection.includes('9cbd37c2'));
});
