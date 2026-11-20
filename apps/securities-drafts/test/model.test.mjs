import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildInstruction, instructionXml, importInstruction, importStatement, statementXml, instructionProblems, statementProblems,
  parsePositions, reconcileHoldings, l1Checks, isinOk, canonicalDecimal, decodeState, emptyState, addInstruction, addStatement,
  setApproved, removeDraft, MAX_DRAFTS, PLANNED_OPERATIONS, NS} from '../src/model.js';
import {MESSAGES, pickLocale, translator} from '../src/messages.js';

const fixture = name => readFileSync(new URL('fixtures/' + name, import.meta.url), 'utf8');
const sha = s => createHash('sha256').update(s).digest('hex');
// The request of the awai-securities-ops fixture test/fixtures/sese023-receive-apmt.edn.
const form = {txId: 'AWAI-SEC-0001', direction: 'receive', paymentType: 'against-payment', settlementDate: '2026-11-20',
  isin: 'US0378331005', description: 'Example equity', quantity: '100', safekeepingAccount: 'SAFE-0001', transactionType: 'TRAD',
  placeOfSettlement: 'DTCYUS33XXX', agent: 'CHASUS33XXX', currency: 'USD', amount: '18950.00'};

test('the fixtures are the ones recorded in SOURCE.md', () => {
  assert.equal(sha(fixture('sese023-receive-apmt.xml')), '469900ce41d529aad90aadf0c7261d99813d0576ddcb7401508094043398e904');
  assert.equal(sha(fixture('semt002-statement.xml')), '0c0bbf35ed04099b293ad45b7a48d10d02165e2c2aed3ad24ebd4bd3472f17d1');
  const edn = fixture('sese023-receive-apmt.edn');
  for (const v of ['AWAI-SEC-0001', '2026-11-20', 'US0378331005', 'Example equity', '"100"', 'SAFE-0001', 'TRAD', 'DTCYUS33XXX', 'CHASUS33XXX', '"USD"', '18950.00', ':receive', ':against-payment'])
    assert.ok(edn.includes(v), v);
});

test('the same fields give the same bytes as kotoba.swift (the awai-securities-ops fixture)', () => {
  const {instruction, problems} = buildInstruction(form);
  assert.equal(problems, undefined);
  assert.equal(instructionXml(instruction), fixture('sese023-receive-apmt.xml'));
  assert.deepEqual(l1Checks(instruction), [{rule: 'xsd-facets', pass: true}, {rule: 'round-trip', pass: true}]);
  assert.deepEqual(importInstruction(fixture('sese023-receive-apmt.xml')), {instruction});
});

test('free deliveries use the receiving side and carry no amount', () => {
  const {instruction} = buildInstruction({...form, direction: 'deliver', paymentType: 'free', amount: '', currency: ''});
  const xml = instructionXml(instruction);
  assert.ok(xml.includes('<SctiesMvmntTp>DELI</SctiesMvmntTp><Pmt>FREE</Pmt>'));
  assert.ok(xml.includes('<RcvgSttlmPties>') && !xml.includes('<SttlmAmt>'));
  assert.ok(instructionXml(buildInstruction({...form, direction: 'deliver'}).instruction).includes('<CdtDbtInd>CRDT</CdtDbtInd>'));
});

test('the custody statement imports and rebuilds to the same bytes', () => {
  const {statement} = importStatement(fixture('semt002-statement.xml'));
  assert.deepEqual(statement, {statementDate: '2026-11-20', frequency: 'DAIL', updateType: 'COMP', basis: 'SETT', activity: true,
    safekeepingAccount: 'SAFE-0001', balances: [{isin: 'US0378331005', quantity: '100', short: false},
      {isin: 'JP3633400001', quantity: '2.5', short: true}, {isin: 'GB0002634946', quantity: '50', short: false}]});
  assert.equal(statementXml(statement), fixture('semt002-statement.xml'));
});

test('holdings lines equal the profile reconciliation (test/fixtures/reconcile-holdings.*)', () => {
  // The profile's expected :lines, read from its EDN result.
  const edn = fixture('reconcile-holdings.result.edn');
  const expected = [...edn.matchAll(/\{:isin "([A-Z0-9]{12})", :statement (nil|"[^"]*"), :holder (nil|"[^"]*"), :result :([a-z-]+)\}/g)]
    .map(([, isin, s, h, result]) => ({isin, statement: s === 'nil' ? null : s.slice(1, -1), holder: h === 'nil' ? null : h.slice(1, -1), result}));
  assert.equal(expected.length, 4);
  // The profile request's positions, in this app's text form.
  const {positions} = parsePositions('US0378331005 100.00\nJP3633400001 -3\nDE0007164600 10');
  assert.ok(fixture('reconcile-holdings.edn').includes('{:isin "JP3633400001" :quantity "3" :short? true}'));
  assert.deepEqual(reconcileHoldings(importStatement(fixture('semt002-statement.xml')).statement, positions), expected);
});

test('imports are refused unless they are exactly the modeled subset with valid values', () => {
  const xml = fixture('sese023-receive-apmt.xml');
  const refuse = (x, code) => assert.equal(importInstruction(x).problems?.[0], code, code);
  refuse(xml.replace('<ISIN>US0378331005</ISIN>', '<ISIN>US0378331006</ISIN>'), 'isin.checksum');
  refuse(xml.replace('<Unit>100</Unit>', '<Unit>\n100\n</Unit>'), 'import.normalized');
  refuse(xml.replace('<AnyBIC>CHASUS33XXX</AnyBIC>', '<AnyBIC>chasus33xxx</AnyBIC>'), 'import.normalized');
  refuse(xml.replace('<Cd>TRAD</Cd>', '<Cd>XXXX</Cd>'), 'transactionType.code');
  refuse(xml.replace('2026-11-20', '2026-02-30'), 'settlementDate.format');
  refuse(xml.replace('<CdtDbtInd>DBIT</CdtDbtInd>', '<CdtDbtInd>CRDT</CdtDbtInd>'), 'import.subset');
  refuse(xml.replace('<SttlmParams>', '<FinInstrmAttrbts/><SttlmParams>'), 'import.subset');
  refuse(xml.replace(NS.sese023, NS.sese023.replace('001.09', '001.11')), 'import.message');
  refuse(xml.replace('<Document', '<!DOCTYPE x><Document'), 'import.unsupported');
  const st = fixture('semt002-statement.xml');
  assert.equal(importStatement(st.replace('<ISIN>GB0002634946</ISIN>', '<ISIN>GB0002634947</ISIN>')).problems[0], 'statement.balance');
  assert.equal(importStatement(st.replace('<Qty><Qty><Qty><Unit>50</Unit></Qty></Qty></Qty>', '<Qty><Qty><Unit>50</Unit></Qty></Qty>')).problems[0], 'statement.balance');
  assert.equal(importStatement(st.replace('<PgNb>1</PgNb>', '<PgNb>2</PgNb>')).problems[0], 'import.subset');
  assert.equal(importStatement(xml).problems[0], 'import.message');
});

test('field checks', () => {
  const p = over => buildInstruction({...form, ...over}).problems ?? [];
  assert.deepEqual(p({isin: 'US037833100'}), ['isin.format']);
  assert.deepEqual(p({quantity: '0'}), ['quantity.format']);
  assert.deepEqual(p({quantity: '1.123456789012345678'}), ['quantity.format']);
  assert.deepEqual(p({amount: '1.123456'}), ['amount.format']);
  assert.deepEqual(p({currency: 'usd!'}), ['currency.format']);
  assert.deepEqual(p({agent: 'CHASE'}), ['agent.format']);
  assert.deepEqual(p({txId: 'T'.repeat(36)}), ['txId.long']);
  assert.deepEqual(p({direction: 'buy'}), ['direction.code']);
  for (const s of ['US0378331005', 'DE0007164600', 'JP3633400001', 'XS2021832634']) assert.ok(isinOk(s), s);
  assert.ok(!isinOk('US0378313005'));
  for (const [a, b] of [['100.00', '100'], ['0100', '100'], ['2.50', '2.5'], ['x', 'x']]) assert.equal(canonicalDecimal(a), b);
  assert.equal(parsePositions('US0378331005 1\nUS0378331005 2').problems[0].code, 'positions.duplicate');
  assert.equal(parsePositions('US0378331005 abc').problems[0].line, 1);
  assert.equal(buildInstruction({...form, isin: ' us0378331005 '}).instruction.isin, 'US0378331005');
});

test('drafts are bounded, validated on load, approvable and removable', () => {
  const i = buildInstruction(form).instruction, s = importStatement(fixture('semt002-statement.xml')).statement;
  let st = addInstruction(emptyState(), i, {id: 'a', now: '2026-11-18T00:00:00Z', source: 'form'});
  st = addStatement(st, s, {id: 'b', now: '2026-11-18T00:01:00Z'});
  assert.deepEqual(st.drafts.map(d => [d.id, d.kind]), [['b', 'statement'], ['a', 'instruction']]);
  assert.deepEqual(decodeState(JSON.parse(JSON.stringify(st))), st);
  const ap = setApproved(st, 'b', true, '2026-11-18T00:02:00Z');
  assert.equal(ap.drafts[0].status, 'approved'); assert.deepEqual(decodeState(ap), ap);
  assert.equal('approvedAt' in setApproved(ap, 'b', false).drafts[0], false);
  assert.deepEqual(removeDraft(st, 'a').drafts.map(d => d.id), ['b']);
  for (const bad of [{schema: 'x', drafts: []}, {...st, drafts: [{...st.drafts[1], instruction: {...i, isin: 'US0378331006'}}]},
    {...st, drafts: [{...st.drafts[0], kind: 'order'}]}, {...st, drafts: [{...st.drafts[0], status: 'sent'}]},
    {...st, drafts: [st.drafts[0], st.drafts[0]]}, {...st, drafts: [{...st.drafts[1], instruction: {...i, isin: 'us0378331005'}}]}])
    assert.throws(() => decodeState(bad), /unreadable-drafts/);
  let full = emptyState();
  for (let n = 0; n < MAX_DRAFTS; n++) full = addInstruction(full, i, {id: String(n), now: 'x', source: 'form'});
  assert.throws(() => addStatement(full, s, {id: 'z', now: 'x'}), /too-many-drafts/);
  assert.throws(() => decodeState({...full, drafts: [...full.drafts, {...full.drafts[0], id: 'extra'}]}), /unreadable-drafts/);
  assert.deepEqual(instructionProblems(i), []); assert.deepEqual(statementProblems(s), []);
});

test('planned external operations are display data only', () => {
  assert.equal(PLANNED_OPERATIONS.length, 3); assert.ok(Object.isFrozen(PLANNED_OPERATIONS[0]));
});

test('ja and en have the same message keys and every code has a label', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ja).sort());
  const codes = ['txId.empty', 'txId.long', 'direction.code', 'paymentType.code', 'settlementDate.format', 'isin.format', 'isin.checksum',
    'description.long', 'quantity.format', 'safekeepingAccount.empty', 'safekeepingAccount.long', 'transactionType.code', 'placeOfSettlement.format',
    'agent.format', 'currency.format', 'amount.format', 'import.malformed', 'import.unsupported', 'import.entity', 'import.size', 'import.message',
    'import.normalized', 'import.subset', 'statement.shape', 'statement.date', 'statement.code', 'statement.account', 'statement.size',
    'statement.balance', 'positions.line', 'positions.duplicate'];
  for (const locale of ['ja', 'en']) {
    const t = translator(locale);
    for (const c of codes) t('problem.' + c, {line: 1});
    for (const o of PLANNED_OPERATIONS) { t('op.' + o.id); t('waits.' + o.id); }
    for (const r of ['xsd-facets', 'round-trip']) t('check.' + r);
    for (const r of ['match', 'quantity-differs', 'missing-in-statement', 'missing-in-positions']) t('result.' + r);
    t('drafts.count', {count: 1}); t('drafts.full', {max: MAX_DRAFTS});
  }
  assert.equal(translator('en')('drafts.count', {count: 1}), '1 saved');
  assert.equal(pickLocale(['en-US']), 'en'); assert.equal(pickLocale(['fr']), 'ja');
});
