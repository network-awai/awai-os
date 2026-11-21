import {test} from 'node:test';import assert from 'node:assert/strict';
import {emptyDraft,draftProblems,recipientProblems,assembleMemo,addressedMemo} from '../src/model.js';
import {translator} from '../src/messages.js';
import {runtimeDescriptor,REQUESTED_CAPABILITIES,SEND_SELECTOR,SEND_OPERATION} from '../src/operations.js';
import {createShareHandler} from '../src/send.js';
import {clientRuntimeProblems,clientRuntimeConnectSrc,clientDisclosureProblems,effectiveClientOperations,createClientOperationBroker,createClientConsentHost} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';
const t=translator('ja');
function fixture(){return {...emptyDraft(),jurisdiction:'JPN',category:'money',summary:'友人に50万円を貸したが返ってこない。',
  timeline:[{date:'2026-03-01',event:'50万円を振り込んだ'}],otherParty:'友人A',wish:'返してほしい',
  documents:['振込明細'],name:'山田太郎',contact:'taro@example.com',recipient:{name:'鈴木花子',office:'鈴木法律事務所',contact:'hanako@example.jp'}};}

// Minimal stand-in for the trusted host document: only the plumbing the canonical consent host
// touches (elements, listeners, modal open state, a controllable clock). Approval gestures are
// dispatched as trusted presses, the way the test simulates one direct user press.
let nowMs=0;
class FakeMouseEvent{constructor(type,init={}){this.type=type;Object.assign(this,init);}}
function makeDocument(){
  const elements=[];
  const makeElement=tag=>{
    const el={tag,children:[],textContent:'',className:'',disabled:false,open:false,_listeners:new Map(),
      setAttribute(){},append(...kids){el.children.push(...kids);},
      addEventListener(type,fn){if(!el._listeners.has(type))el._listeners.set(type,[]);el._listeners.get(type).push(fn);},
      removeEventListener(){},focus(){},
      showModal(){el.open=true;},
      close(){if(!el.open)return;el.open=false;for(const fn of [...(el._listeners.get('close')??[])])fn({type:'close'});},
      remove(){},get isConnected(){return true;}};
    elements.push(el);return el;};
  const doc={body:makeElement('body'),createElement:makeElement,defaultView:{MouseEvent:FakeMouseEvent,performance:{now:()=>nowMs}}};
  return {doc,elements};
}
function fire(el,type,event){event.currentTarget=el;for(const fn of [...(el._listeners.get(type)??[])])fn(event);}
function installedDocument(){const {doc,elements}=makeDocument();globalThis.document=doc;return {doc,elements,dialog:()=>elements.find(e=>e.tag==='dialog'),scope:()=>elements.find(e=>e.className==='kotoba-client-consent-scope')};}

function wire({approved=true,supported=true,shareText,doc,locale='ja'}={}){
  const calls=[];
  const share=shareText??(async text=>{calls.push(text);});
  const descriptor=runtimeDescriptor();
  const host=[SEND_SELECTOR.capability,SEND_SELECTOR.service,SEND_SELECTOR.operation];
  const consentHost=createClientConsentHost({document:doc,locale});
  const broker=createClientOperationBroker({runtime:descriptor,requestedCapabilities:[...REQUESTED_CAPABILITIES],
    approvedOperations:approved?descriptor.operations:[],hostSupportedOperations:supported?[host]:[],
    browserAdapters:supported?{[SEND_SELECTOR.service]:{[SEND_SELECTOR.operation]:createShareHandler({shareText:share})}}:{},consentHost,app:{name:'法律相談'}});
  return {descriptor,broker,calls};
}
function flatDialog(dialog){return [...dialog.children].flatMap(c=>[c,...(c.children??[])]);}
function buttonByText(dialog,text){return flatDialog(dialog).find(e=>e.textContent===text&&e.tag==='button')??null;}
async function approve(dialog,allow){
  // Move the fake clock past the arm delay of this showing (armedAt is
  // show-time + 600ms, and the clock is global across tests, so advance it).
  nowMs+=1000;
  fire(allow,'pointerdown',{type:'pointerdown',isTrusted:true});
  fire(allow,'click',new FakeMouseEvent('click',{isTrusted:true}));
}
function memoPayload(){const d=fixture();assert.deepEqual(draftProblems(d),[]);assert.deepEqual(recipientProblems(d.recipient),[]);
  const to={name:d.recipient.name,office:d.recipient.office,contact:d.recipient.contact};
  return {memo:addressedMemo(assembleMemo(d,t).text,to,t),recipient:to};}

test('the descriptor declares exactly the O1/D9 send, consent for each operation, and no fetch origin',()=>{
  const d=runtimeDescriptor();
  assert.deepEqual(clientRuntimeProblems(d,[...REQUESTED_CAPABILITIES],'http://tauri.localhost'),[]);
  assert.equal(d.operations.length,1);
  assert.deepEqual(d.operations[0],SEND_OPERATION);
  assert.equal(SEND_OPERATION.consent,'each-operation');
  assert.deepEqual(SEND_OPERATION['data-categories'],['legal.consultation-memo']);
  assert.deepEqual(clientDisclosureProblems(SEND_OPERATION.disclosure),[]);
  assert.equal(SEND_OPERATION.disclosure.country,'JP');
  assert.equal(SEND_OPERATION.disclosure.frequency,'one-time');
  assert.deepEqual(SEND_OPERATION.endpoint,{'browser-action':'share',recipient:'user-selected-app'});
  assert.ok(!('origin' in SEND_OPERATION.endpoint));
  assert.equal(clientRuntimeConnectSrc(d,[...REQUESTED_CAPABILITIES],[],'http://tauri.localhost'),"connect-src 'none'");
});

test('approval hands the consultation memo over exactly once',async()=>{
  const {doc,dialog,scope}=installedDocument();
  try{
    const {broker,calls}=wire({doc});
    assert.equal(broker.operations.length,1);
    const payload=memoPayload();
    const invoked=broker.invoke(SEND_SELECTOR,payload);
    assert.equal(dialog().open,true,'consent is showing');
    const allow=buttonByText(dialog(),'続ける');
    assert.ok(allow,'allow button exists');
    await approve(dialog(),allow);
    assert.deepEqual(await invoked,{shared:true});
    assert.equal(calls.length,1,'exactly one hand-off');
    assert.equal(calls[0],payload.memo,'the memo text as assembled');
    assert.match(scope().textContent,/Receiver: the app you pick next receives the data/);
    assert.match(scope().textContent,/legal\.consultation-memo/);
  }finally{delete globalThis.document;}
});

test('denial hands nothing over',async()=>{
  const {doc,dialog}=installedDocument();
  try{
    const {broker,calls}=wire({doc});
    const payload=memoPayload();
    const invoked=broker.invoke(SEND_SELECTOR,payload);
    assert.equal(dialog().open,true);
    const deny=buttonByText(dialog(),'閉じる');
    assert.ok(deny,'deny button exists');
    fire(deny,'click',{type:'click',isTrusted:true});
    await assert.rejects(invoked,/not approved/);
    assert.equal(calls.length,0,'no hand-off on denial');
  }finally{delete globalThis.document;}
});

test('without governor approval the send is not eligible and nothing is handed over',async()=>{
  const {doc}=installedDocument();
  try{
    const {descriptor,broker,calls}=wire({doc,approved:false});
    assert.deepEqual(effectiveClientOperations(descriptor,{requestedCapabilities:[...REQUESTED_CAPABILITIES],approvedOperations:[],hostSupportedOperations:[[SEND_SELECTOR.capability,SEND_SELECTOR.service,SEND_SELECTOR.operation]]}),[]);
    assert.equal(broker.operations.length,0);
    await assert.rejects(broker.invoke(SEND_SELECTOR,memoPayload()),/not eligible/);
    assert.equal(calls.length,0);
  }finally{delete globalThis.document;}
});

test('without host support the send is not eligible and nothing is handed over',async()=>{
  const {doc}=installedDocument();
  try{
    const {descriptor,broker,calls}=wire({doc,supported:false});
    assert.deepEqual(effectiveClientOperations(descriptor,{requestedCapabilities:[...REQUESTED_CAPABILITIES],approvedOperations:descriptor.operations,hostSupportedOperations:[]}),[]);
    assert.equal(broker.operations.length,0);
    await assert.rejects(broker.invoke(SEND_SELECTOR,memoPayload()),/not eligible/);
    assert.equal(calls.length,0);
  }finally{delete globalThis.document;}
});

test('when the device language is Japanese the consent dialog is Japanese; recipient, operation and data categories stay as-is',async()=>{
  const {doc,dialog,scope}=installedDocument();
  try{
    const {broker,calls}=wire({doc,locale:'ja'});
    const payload=memoPayload();
    const invoked=broker.invoke(SEND_SELECTOR,payload);
    assert.equal(dialog().open,true,'consent is showing');
    assert.equal(flatDialog(dialog()).find(e=>e.tag==='h2')?.textContent,'法律相談 が、次の情報を送ります');
    const summary=flatDialog(dialog()).find(e=>e.tag==='ul');
    assert.match(summary?.textContent??'',/送り先: 利用者がこの端末で選ぶアプリ（日本）/);
    assert.match(summary?.textContent??'',/送る情報: 相談メモ（氏名、連絡先、相談内容）/);
    assert.match(summary?.textContent??'',/目的: 利用者が選んだ弁護士に相談メモを送る/);
    assert.match(summary?.textContent??'',/送る回数: 1 回だけ/);
    const allow=buttonByText(dialog(),'続ける');
    const deny=buttonByText(dialog(),'閉じる');
    assert.ok(allow,'Japanese allow button exists');assert.ok(deny,'Japanese deny button exists');
    assert.match(scope().textContent,/Receiver: the app you pick next receives the data/);
    assert.match(scope().textContent,/legal\.consultation-memo/);
    await approve(dialog(),allow);
    assert.deepEqual(await invoked,{shared:true});
    assert.equal(calls.length,1,'exactly one hand-off');
    assert.equal(calls[0],payload.memo,'the addressed memo text as assembled');
  }finally{delete globalThis.document;}
});

test('an English device language shows the English dialog over the same declared facts',async()=>{
  const {doc,dialog,scope}=installedDocument();
  try{
    const {broker}=wire({doc,locale:'en'});
    const invoked=broker.invoke(SEND_SELECTOR,memoPayload());
    assert.equal(dialog().open,true,'consent is showing');
    assert.equal(flatDialog(dialog()).find(e=>e.tag==='h2')?.textContent,'法律相談 will send the following information');
    assert.ok(buttonByText(dialog(),'Continue'),'English allow button exists');
    assert.ok(buttonByText(dialog(),'Close'),'English deny button exists');
    assert.match(scope().textContent,/Receiver: the app you pick next receives the data/);
    assert.match(scope().textContent,/legal\.consultation-memo/);
    fire(buttonByText(dialog(),'Close'),'click',{type:'click',isTrusted:true});
    await assert.rejects(invoked,/not approved/);
  }finally{delete globalThis.document;}
});

test('the sent body heads with the destination the user typed and nothing else',async()=>{
  const {doc,dialog}=installedDocument();
  try{
    const {broker,calls}=wire({doc});
    const payload=memoPayload();
    const invoked=broker.invoke(SEND_SELECTOR,payload);
    assert.equal(dialog().open,true);
    const allow=buttonByText(dialog(),'続ける');
    assert.ok(allow,'allow button exists');
    await approve(dialog(),allow);
    assert.deepEqual(await invoked,{shared:true});
    assert.equal(calls.length,1);
    const [head,...rest]=calls[0].split('\n');
    assert.equal(head,'宛先: 鈴木花子 / 鈴木法律事務所 / hanako@example.jp');
    assert.ok(rest.join('\n').includes('友人に50万円を貸したが返ってこない。'),'user words are untouched');
    assert.ok(!calls[0].includes('候補'),'no candidates added');
    assert.ok(!calls[0].includes('おすすめ'),'no recommendations added');
  }finally{delete globalThis.document;}
});

test('an invalid payload never reaches the share sheet',async()=>{
  const calls=[];
  const handler=createShareHandler({shareText:async text=>{calls.push(text);}});
  for(const payload of [undefined,{},null,{memo:''},{memo:'   '},{memo:'あ'.repeat(65537)}]) await assert.rejects(handler({payload}),/invalid-memo-payload/);
  assert.equal(calls.length,0);
  assert.deepEqual(await handler({payload:{memo:'相談メモ'}}),{shared:true});
  assert.deepEqual(calls,['相談メモ']);
  assert.throws(()=>createShareHandler({}),/shareText-required/);
});
