// Drift guard for the moto g05 Store key-list & auto-update runbook (AWAI-3653, AWAI-3775, AWAI-3184).
// Keeps the active runbook instructions aligned with the committed key-list root, sequence-2 role keys,
// r114 catalog, sequence-5 pointer, and PR #532 17-APK pin requirement while preserving the 2026-11-22
// emulator rehearsal as clearly labeled history.
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

  return {activeSection, preambleSection, activeInstructions, historicalSection};
}

const runbookText = readFileSync(RUNBOOK_PATH, 'utf8');
const {activeSection, preambleSection, activeInstructions, historicalSection} = splitRunbook(runbookText);

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
  assert(activeInstructions.includes(`--catalog-revision ${catalog.revision}`));
  assert(activeInstructions.includes(rootPrefix));
  assert(activeInstructions.includes(catalogKeyPrefix));
  assert(activeInstructions.includes(pointerKeyPrefix));
  assert(activeInstructions.includes('`highest` が `2`'));
  assert(activeInstructions.includes('`highest` `114`'));
  assert(activeInstructions.includes(`sequence ${pointer.sequence}`));

  // AWAI-3653 standing-update-approval verification checklist is present
  assert(activeInstructions.includes('AWAI-3653'));
  assert(activeInstructions.includes('サイレント更新'));
  assert(activeInstructions.includes('再起動'));
  assert(activeInstructions.includes('バックグラウンド'));
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
