import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseUsd,formatUsd,payToProblem,resourceProblem,buildRequirement,challenge,requirementProblems,decodeState,addDraft,removeDraft,emptyState,NETWORK,MAX_DRAFTS,PLANNED_OPERATIONS} from '../src/model.js';
const payTo='0xA00366234D29d4F882088048c0B2fa0dB7302D4E';
test('USD amounts convert to USDC base units (6 decimals) and back',()=>{
  assert.equal(parseUsd('0.01').micros,'10000');assert.equal(parseUsd('1').micros,'1000000');assert.equal(parseUsd(' 12.345678 ').micros,'12345678');
  assert.equal(parseUsd('1000').micros,'1000000000');
  for(const [s,e] of [['','amount.empty'],['0','amount.zero'],['0.000000','amount.zero'],['1.2345678','amount.format'],['-1','amount.format'],['1e3','amount.format'],['1,000','amount.format'],['1000.000001','amount.max']])assert.equal(parseUsd(s).error,e,s);
  assert.equal(formatUsd('10000'),'0.01');assert.equal(formatUsd('1000000'),'1');assert.equal(formatUsd('12345678'),'12.345678');
});
test('payTo and resource are validated',()=>{
  assert.equal(payToProblem(payTo),null);assert.equal(payToProblem('0x123'),'payTo.format');assert.equal(payToProblem('0x'+'0'.repeat(40)),'payTo.zero');
  assert.equal(resourceProblem('/x402/counts'),null);assert.equal(resourceProblem('https://shop.example/item/1'),null);
  for(const r of ['','http://shop.example/','//evil.example/x','javascript:alert(1)','https://u:p@shop.example/','/a b'])assert.ok(resourceProblem(r),r);
});
test('a requirement matches the nexus-x402 wire shape and is Base Sepolia only',()=>{
  const {requirement:q}=buildRequirement({amount:'0.01',payTo,resource:'/x402/counts',description:'Count lookup'});
  assert.deepEqual(q,{scheme:'transaction',network:'base-sepolia',payTo,maxAmountRequired:'10000',asset:NETWORK.usdc,resource:'/x402/counts',mimeType:'application/json',maxTimeoutSeconds:300,description:'Count lookup'});
  assert.deepEqual(requirementProblems(q),[]);
  assert.deepEqual(challenge(q),{x402Version:1,accepts:[q]});
  assert.deepEqual(requirementProblems({...q,network:'base'}),['requirement.network'],'mainnet is refused');
  assert.deepEqual(requirementProblems({...q,maxAmountRequired:'0'}),['requirement.amount']);
  assert.deepEqual(buildRequirement({amount:'',payTo:'x',resource:''}).problems,['amount.empty','payTo.format','resource.empty']);
});
test('drafts are bounded, validated on load and removable',()=>{
  const {requirement:q}=buildRequirement({amount:'2',payTo,resource:'/a'});
  let s=emptyState();s=addDraft(s,q,{id:'a',now:'2026-11-18T00:00:00Z'});s=addDraft(s,q,{id:'b',now:'2026-11-18T00:01:00Z'});
  assert.deepEqual(s.drafts.map(d=>d.id),['b','a'],'newest first');
  assert.deepEqual(decodeState(JSON.parse(JSON.stringify(s))),s);assert.deepEqual(decodeState(null),emptyState());
  assert.deepEqual(removeDraft(s,'b').drafts.map(d=>d.id),['a']);
  assert.throws(()=>decodeState({schema:'other',drafts:[]}));
  assert.throws(()=>decodeState({...s,drafts:[{...s.drafts[0],requirement:{...q,network:'base'}}]}));
  assert.throws(()=>addDraft(s,{...q,asset:'0x0'},{id:'c',now:'x'}));
  let full=emptyState();for(let i=0;i<MAX_DRAFTS;i++)full=addDraft(full,q,{id:String(i),now:'x'});assert.throws(()=>addDraft(full,q,{id:'z',now:'x'}));
  // Over the limit or duplicate ids: unreadable (the app goes read-only), never truncated.
  assert.equal(decodeState(full).drafts.length,MAX_DRAFTS);
  assert.throws(()=>decodeState({...full,drafts:[...full.drafts,{...full.drafts[0],id:'extra'}]}),/unreadable-drafts/);
  assert.throws(()=>decodeState({...s,drafts:[s.drafts[0],s.drafts[0]]}),/unreadable-drafts/);
});
test('planned external operations are display data only',()=>{assert.equal(PLANNED_OPERATIONS.length,3);assert.ok(Object.isFrozen(PLANNED_OPERATIONS[0]));});
import {MESSAGES,pickLocale,translator} from '../src/messages.js';
test('ja and en have the same message keys and every problem code has a label',()=>{
  assert.deepEqual(Object.keys(MESSAGES.en).sort(),Object.keys(MESSAGES.ja).sort());
  const codes=['amount.empty','amount.format','amount.zero','amount.max','payTo.format','payTo.zero','resource.empty','resource.format','description.long'];
  for(const locale of ['ja','en']){const t=translator(locale);for(const c of codes)t('problem.'+c);for(const o of PLANNED_OPERATIONS)t('op.'+o.id);assert.throws(()=>t('drafts.count'));}
  assert.equal(pickLocale(['en-US']),'en');assert.equal(translator('en')('drafts.count',{count:1}),'1 saved');for(const l of ['ja','en'])translator(l)('drafts.full',{max:MAX_DRAFTS});assert.equal(pickLocale(['fr']),'ja');
});
