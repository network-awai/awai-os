import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {CATEGORIES,JURISDICTIONS,LIMITS,emptyDraft,draftProblems,recipientProblems,assembleMemo,restoreDraft} from '../src/model.js';
import {MESSAGES,translator} from '../src/messages.js';
import {runtimeDescriptor,REQUESTED_CAPABILITIES,SEND_SELECTOR} from '../src/operations.js';
import {clientRuntimeProblems,clientRuntimeConnectSrc,effectiveClientOperations} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';
const t=translator('ja');
function fixture(){return {...emptyDraft(),jurisdiction:'JPN',category:'money',summary:'友人に50万円を貸したが返ってこない。',
  timeline:[{date:'2026-03-01',event:'50万円を振り込んだ'},{date:'',event:'返済の催促をした'}],otherParty:'友人A',wish:'返してほしい',
  deadline:'',documents:['振込明細','LINE のやり取り'],name:'山田太郎',contact:'taro@example.com'};}

test('a complete draft assembles into a memo that repeats the user\'s words under fixed headings',()=>{
  const d=fixture();assert.deepEqual(draftProblems(d),[]);
  const m=assembleMemo(d,t);
  assert.equal(m.template,'consultation-memo.jpn.v1');assert.equal(m.title,'相談メモ（金銭の貸し借り）');
  assert.deepEqual(m.sections.map(s=>s.heading),['分野','相談の概要','これまでの経緯','相手方','希望すること','手元にある資料','相談者']);
  assert.equal(m.sections[2].body,'2026-03-01　50万円を振り込んだ\n返済の催促をした');
  for(const s of [d.summary,d.wish,d.otherParty,...d.documents,d.name,d.contact])assert.ok(m.text.includes(s),s);
  assert.ok(m.text.endsWith(t('memo.notice')));
});
test('assembly adds no words beyond the template: removing the user text leaves only headings, title and notice',()=>{
  const d=fixture(),m=assembleMemo(d,t);
  assert.ok(m.text.startsWith(m.title+'\n'));let rest=m.text.slice(m.title.length);for(const s of m.sections){rest=rest.replace(s.body,'');}
  const allowed=[m.notice,...m.sections.map(s=>'■ '+s.heading)];
  for(const line of rest.split('\n').filter(Boolean))assert.ok(allowed.includes(line),'unexpected line: '+line);
});
test('negative control: no jurisdiction default, and an unknown jurisdiction is refused (O7 is open)',()=>{
  assert.equal(emptyDraft().jurisdiction,null);
  assert.deepEqual(Object.keys(JURISDICTIONS),['JPN']);
  for(const j of [null,'GBR','jpn','__proto__']){const d={...fixture(),jurisdiction:j};assert.ok(draftProblems(d).includes('jurisdiction.required'),String(j));
    assert.throws(()=>assembleMemo(d,t),/draft-incomplete/);}
});
test('negative control: missing, oversized and malformed input is refused with message keys',()=>{
  const cases=[[{summary:' '},'summary.required'],[{summary:'あ'.repeat(LIMITS.summary+1)},'summary.tooLong'],[{wish:''},'wish.required'],
    [{category:'criminal'},'category.required'],[{timeline:[{date:'2026-02-30',event:'x'}]},'timeline.date'],[{timeline:[{date:'',event:''}]},'timeline.event'],
    [{documents:['']},'documents.item'],[{name:''},'name.required'],[{contact:''},'contact.required'],
    [{timeline:Array.from({length:LIMITS.timeline+1},()=>({date:'',event:'x'}))},'timeline.tooMany']];
  for(const [patch,key] of cases){const p=draftProblems({...fixture(),...patch});assert.ok(p.includes(key),key+' in '+p);assert.ok(t(key,{max:1}));}
  assert.deepEqual(draftProblems(null),['draft.invalid']);
});
test('the recipient is only what the user typed; shape is checked, nothing is looked up',()=>{
  assert.deepEqual(recipientProblems({name:'鈴木花子',office:'',contact:'hanako@example.jp'}),[]);
  assert.deepEqual(recipientProblems({name:'',office:'x'.repeat(LIMITS.office+1),contact:''}),['recipient.nameProblem','recipient.officeProblem','recipient.contactProblem']);
  assert.deepEqual(emptyDraft().recipient,{name:'',office:'',contact:''});
});
test('D9: the app ships no list of lawyers and no ranking or recommendation wording',()=>{
  const src=['model.js','app.js','operations.js'].map(f=>readFileSync(new URL('../src/'+f,import.meta.url),'utf8')).join('\n');
  assert.doesNotMatch(src,/lawyers\s*[:=]\s*\[|directory|ranking|recommend\(/i);
  for(const key of Object.keys(MESSAGES.ja))assert.doesNotMatch(MESSAGES.ja[key],/おすすめ|ランキング|紹介します|候補/,key);
});
test('restoring a stored draft keeps known fields of the right type only',()=>{
  const d=restoreDraft({jurisdiction:'GBR',category:'money',summary:1,wish:'w',timeline:[{date:'',event:'e'},{date:1}],documents:['a',2],recipient:{name:'n',contact:3},extra:'x'});
  assert.equal(d.jurisdiction,null);assert.equal(d.category,'money');assert.equal(d.summary,'');assert.equal(d.wish,'w');
  assert.deepEqual(d.timeline,[{date:'',event:'e'}]);assert.deepEqual(d.documents,['a']);assert.deepEqual(d.recipient,{name:'n',office:'',contact:''});
  assert.ok(!('extra' in d));assert.deepEqual(restoreDraft(null),emptyDraft());
});
test('every category and every problem key has ja and en text',()=>{
  for(const l of ['ja','en']){const tl=translator(l);for(const c of CATEGORIES)assert.ok(tl('category.'+c));
    for(const k of ['summary.tooLong','timeline.event'])assert.ok(tl(k,{max:1}));}
  assert.deepEqual(Object.keys(MESSAGES.en).sort(),Object.keys(MESSAGES.ja).sort());
});
test('the descriptor is valid and declares no external operation; connect-src is none',()=>{
  const d=runtimeDescriptor();
  assert.deepEqual(clientRuntimeProblems(d,[...REQUESTED_CAPABILITIES],'http://tauri.localhost'),[]);
  assert.deepEqual(d.operations,[]);
  assert.equal(clientRuntimeConnectSrc(d,[...REQUESTED_CAPABILITIES],[],'http://tauri.localhost'),"connect-src 'none'");
});
test('negative control: even if the send selector were approved and host-supported, it is not eligible because it is undeclared',()=>{
  const d=runtimeDescriptor(),op={...SEND_SELECTOR,consent:'each-operation','data-categories':['legal.consultation'],endpoint:{origin:'https://example.com','browser-action':'send'}};
  assert.deepEqual(effectiveClientOperations(d,{requestedCapabilities:[SEND_SELECTOR.capability],approvedOperations:[op],
    hostSupportedOperations:[[SEND_SELECTOR.capability,SEND_SELECTOR.service,SEND_SELECTOR.operation]]}),[]);
});
test('page and Tauri CSPs allow only the IPC for connections',()=>{
  const html=readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
  const conf=JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
  for(const csp of [html.match(/Content-Security-Policy" content="([^"]+)"/)[1],conf.app.security.csp]){
    assert.match(csp,/connect-src ipc: http:\/\/ipc\.localhost;/);assert.doesNotMatch(csp,/unsafe-eval|unsafe-inline|https:/);}
  const caps=JSON.parse(readFileSync(new URL('../src-tauri/capabilities/main.json',import.meta.url),'utf8'));
  assert.deepEqual(caps.permissions,['allow-awai-host-info']);
});
