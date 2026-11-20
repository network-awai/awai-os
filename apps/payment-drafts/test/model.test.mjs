import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildInstruction, instructionProblems, toXml, importXml, readXml, l1Checks, parseAmount, ibanChecksumOk, isoDateOk, isoDateTimeOk,
  decodeState, emptyState, addDraft, setApproved, removeDraft, MAX_DRAFTS, PLANNED_OPERATIONS, NAMESPACE} from '../src/model.js';
import {MESSAGES, pickLocale, translator} from '../src/messages.js';

const fixture = name => readFileSync(new URL('fixtures/' + name, import.meta.url), 'utf8');
// The request of the awai-banking-ops profile fixture (test/fixtures/pain001-eur-single.edn).
const form = {debtorName: 'Example Holder', debtorIban: 'DE89370400440532013000', debtorBic: 'COBADEFFXXX',
  creditorName: 'Example Supplier SARL', creditorIban: 'FR1420041010050500013M02606', creditorBic: 'BNPAFRPPXXX',
  amount: '1250.00', currency: 'EUR', executionDate: '2026-11-19', chargeBearer: 'SLEV', endToEndId: 'E2E-0001',
  uetr: 'eb6305c4-3e7a-4b29-9a1f-8d2ce5a71b30', remittance: 'Invoice 2026-118'};
const meta = {msgId: 'AWAI-PAIN-0001', creationDateTime: '2026-11-18T09:00:00Z', paymentInfoId: 'PMT-0001'};

test('the fixture is the one recorded in SOURCE.md', () => {
  assert.equal(createHash('sha256').update(fixture('pain001-eur-single.xml')).digest('hex'),
    '2b40693ca1449db217ffe2e377693817a82f08a2675bf3c17d417822be7b5a8b');
  const edn = fixture('pain001-eur-single.edn');
  for (const v of Object.values({...form, ...meta})) assert.ok(edn.includes(v === '1250.00' ? ':amount-minor 125000' : `"${v}"`), v);
});

test('the same fields give the same bytes as kotoba.swift (the awai-banking-ops fixture)', () => {
  const {instruction, problems} = buildInstruction(form, meta);
  assert.equal(problems, undefined);
  assert.equal(toXml(instruction), fixture('pain001-eur-single.xml'));
  assert.deepEqual(l1Checks(instruction), [{rule: 'xsd-facets', pass: true}, {rule: 'round-trip', pass: true}]);
});

test('importing the profile draft yields the same instruction', () => {
  const built = buildInstruction(form, meta).instruction;
  assert.deepEqual(importXml(fixture('pain001-eur-single.xml')), {instruction: built});
  // Formatting whitespace between elements is accepted.
  const pretty = fixture('pain001-eur-single.xml').replace(/></g, '>\n  <');
  assert.deepEqual(importXml(pretty), {instruction: built});
});

test('imports are refused unless they are exactly the modeled subset with valid values', () => {
  const xml = fixture('pain001-eur-single.xml');
  const refuse = (x, code) => assert.deepEqual(importXml(x).problems?.[0], code, code);
  // AWAI-3153 finding K1: whitespace inside a value is not repaired.
  refuse(xml.replace('<MsgId>AWAI-PAIN-0001</MsgId>', '<MsgId>\n  AWAI-PAIN-0001\n</MsgId>'), 'import.normalized');
  refuse(xml.replace('<IBAN>FR14', '<IBAN>fr14'), 'import.normalized');
  // AWAI-3153 finding K2: ReqdExctnDt as bare text.
  refuse(xml.replace('<ReqdExctnDt><Dt>2026-11-19</Dt></ReqdExctnDt>', '<ReqdExctnDt>2026-11-19</ReqdExctnDt>'), 'executionDate.format');
  refuse(xml.replace('2026-11-19', '2026-02-30'), 'executionDate.format');
  refuse(xml.replace('eb6305c4', 'EB6305C4'), 'import.normalized');
  refuse(xml.replace('<UETR>eb6305c4-3e7a-4b29', '<UETR>eb6305c4-3e7a-1b29'), 'uetr.format');
  refuse(xml.replace('DE89370400440532013000', 'DE00370400440532013000'), 'debtorIban.checksum');
  refuse(xml.replace('<CtrlSum>1250.00</CtrlSum>', '<CtrlSum>1.00</CtrlSum>'), 'import.subset');
  refuse(xml.replace('<Cdtr>', '<Purp><Cd>SUPP</Cd></Purp><Cdtr>'), 'import.subset');
  refuse(xml.replace(NAMESPACE, NAMESPACE.replace('001.09', '001.03')), 'import.message');
  refuse(xml.replace('<Document', '<!DOCTYPE x><Document'), 'import.unsupported');
  refuse(xml.replace('</Document>', ''), 'import.malformed');
  refuse(xml.replace('Example Holder', 'A &bogus; B'), 'import.entity');
  refuse('x'.repeat(20001), 'import.size');
  assert.throws(() => readXml('<a><b></a></b>'), /import.malformed/);
});

test('field checks follow the XSD facets', () => {
  const p = over => buildInstruction({...form, ...over}, meta).problems ?? [];
  assert.deepEqual(p({debtorBic: 'COBADEF'}), ['debtorBic.format']);
  assert.deepEqual(p({creditorIban: 'FR1420041010050500013M02607'}), ['creditorIban.checksum']);
  assert.deepEqual(p({endToEndId: 'E'.repeat(36)}), ['endToEndId.long']);
  assert.deepEqual(p({creditorName: ''}), ['creditorName.empty']);
  assert.deepEqual(p({uetr: 'not-a-uuid'}), ['uetr.format']);
  assert.deepEqual(p({chargeBearer: 'OUR'}), ['chargeBearer.code']);
  assert.deepEqual(p({remittance: 'x'.repeat(141)}), ['remittance.long']);
  assert.deepEqual(buildInstruction(form, {...meta, creationDateTime: '2026-11-18 09:00'}).problems, ['meta.invalid']);
  // Lower case and spaces in identifiers are normalised from the form.
  assert.equal(buildInstruction({...form, debtorIban: 'de89 3704 0044 0532 0130 00'}, meta).instruction.debtorIban, 'DE89370400440532013000');
  for (const [s, c, r] of [['1250', 'EUR', '1250.00'], ['0.5', 'EUR', '0.50'], ['1500', 'JPY', '1500'], ['007', 'EUR', '7.00']]) assert.equal(parseAmount(s, c).amount, r);
  for (const [s, c, e] of [['', 'EUR', 'amount.empty'], ['1.234', 'EUR', 'amount.decimals'], ['1.5', 'JPY', 'amount.whole'], ['0', 'EUR', 'amount.zero'], ['1e3', 'EUR', 'amount.format'], ['-1', 'EUR', 'amount.format']]) assert.equal(parseAmount(s, c).error, e, s);
  assert.ok(ibanChecksumOk('GB82WEST12345698765432')); assert.ok(!ibanChecksumOk('GB83WEST12345698765432'));
  assert.ok(isoDateOk('2028-02-29')); assert.ok(!isoDateOk('2026-02-29'));
  assert.ok(isoDateTimeOk('2026-11-18T09:00:00.123+09:00')); assert.ok(!isoDateTimeOk('2026-11-18T24:00:00Z')); assert.ok(!isoDateTimeOk('2026-11-18T09:00:00+15:00'));
  assert.equal(toXml(buildInstruction({...form, creditorName: 'Smith & Jones <Ltd>'}, meta).instruction).includes('<Nm>Smith &amp; Jones &lt;Ltd&gt;</Nm>'), true);
});

test('drafts are bounded, validated on load, approvable and removable', () => {
  const i = buildInstruction(form, meta).instruction;
  let s = emptyState();
  s = addDraft(s, i, {id: 'a', now: '2026-11-18T00:00:00Z', source: 'form'});
  s = addDraft(s, i, {id: 'b', now: '2026-11-18T00:01:00Z', source: 'import'});
  assert.deepEqual(s.drafts.map(d => d.id), ['b', 'a'], 'newest first');
  assert.deepEqual(decodeState(JSON.parse(JSON.stringify(s))), s);
  assert.deepEqual(decodeState(null), emptyState());
  const approved = setApproved(s, 'a', true, '2026-11-18T00:02:00Z');
  assert.equal(approved.drafts[1].status, 'approved'); assert.equal(approved.drafts[1].approvedAt, '2026-11-18T00:02:00Z');
  assert.deepEqual(decodeState(approved), approved);
  const back = setApproved(approved, 'a', false);
  assert.equal(back.drafts[1].status, 'draft'); assert.equal('approvedAt' in back.drafts[1], false);
  assert.throws(() => setApproved(s, 'zz', true, 'x'), /no-such-draft/);
  assert.deepEqual(removeDraft(s, 'b').drafts.map(d => d.id), ['a']);
  assert.throws(() => addDraft(s, {...i, debtorBic: 'x'}, {id: 'c', now: 'x', source: 'form'}), /invalid-instruction/);
  // Unreadable stored state makes the app read-only; it is never repaired or truncated.
  for (const bad of [{schema: 'other', drafts: []}, {...s, drafts: [{...s.drafts[0], instruction: {...i, uetr: 'X'}}]},
    {...s, drafts: [{...s.drafts[0], status: 'sent'}]}, {...s, drafts: [{...s.drafts[0], status: 'approved'}]},
    {...s, drafts: [s.drafts[0], s.drafts[0]]}, {...s, drafts: [{...s.drafts[0], instruction: {...i, extra: '1'}}]}])
    assert.throws(() => decodeState(bad), /unreadable-drafts/);
  let full = emptyState();
  for (let n = 0; n < MAX_DRAFTS; n++) full = addDraft(full, i, {id: String(n), now: 'x', source: 'form'});
  assert.throws(() => addDraft(full, i, {id: 'z', now: 'x', source: 'form'}), /too-many-drafts/);
  assert.equal(decodeState(full).drafts.length, MAX_DRAFTS);
  assert.throws(() => decodeState({...full, drafts: [...full.drafts, {...full.drafts[0], id: 'extra'}]}), /unreadable-drafts/);
  assert.deepEqual(instructionProblems({...i, debtorIban: 'de89370400440532013000'}), ['instruction.normalized']);
});

test('planned external operations are display data only', () => {
  assert.equal(PLANNED_OPERATIONS.length, 3);
  assert.ok(Object.isFrozen(PLANNED_OPERATIONS[0]));
});

test('ja and en have the same message keys and every problem code has a label', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ja).sort());
  const codes = ['debtorName.empty', 'debtorName.long', 'creditorName.empty', 'creditorName.long', 'debtorIban.format', 'debtorIban.checksum',
    'creditorIban.format', 'creditorIban.checksum', 'debtorBic.format', 'creditorBic.format', 'currency.format', 'amount.empty', 'amount.format',
    'amount.decimals', 'amount.whole', 'amount.zero', 'executionDate.format', 'chargeBearer.code', 'endToEndId.empty', 'endToEndId.long',
    'instructionId.long', 'uetr.format', 'remittance.long', 'meta.invalid', 'import.malformed', 'import.unsupported', 'import.entity',
    'import.size', 'import.message', 'import.normalized', 'import.subset', 'instruction.shape', 'instruction.normalized'];
  for (const locale of ['ja', 'en']) {
    const t = translator(locale);
    for (const c of codes) t('problem.' + c);
    for (const o of PLANNED_OPERATIONS) { t('op.' + o.id); t('waits.' + o.id); }
    for (const r of ['xsd-facets', 'round-trip']) t('check.' + r);
    t('drafts.count', {count: 1}); t('drafts.full', {max: MAX_DRAFTS});
    assert.throws(() => t('drafts.count'));
  }
  assert.equal(translator('en')('drafts.count', {count: 1}), '1 saved');
  assert.equal(pickLocale(['en-US']), 'en'); assert.equal(pickLocale(['fr']), 'ja');
});
