import './domain.js';
import {createHost} from './host.js';
import {decode,saveEvent,importEvents,SCHEMA} from './model.js';
import {clientRuntimeProblems,createClientConsentHost,createClientOperationBroker} from './runtime.js';
const descriptor={schema:'kotoba.app.client-runtime.v1',target:'browser',profile:'trusted-page-v1',entry:'index.html','local-state':{adapter:'localstorage',schema:SCHEMA,version:1},workers:[],operations:[]};
if(clientRuntimeProblems(descriptor,[],location.origin).length)throw Error('invalid-runtime');
createClientOperationBroker({runtime:descriptor,requestedCapabilities:[],approvedOperations:[],hostSupportedOperations:[],consentHost:createClientConsentHost()});
const host=createHost({appId:'network.itonami.yotei'}),$=id=>document.getElementById(id);let snapshot,state,busy=false,projectionPending=false;
function el(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function status(text){$('status').textContent=text;const dialog=document.querySelector('dialog[open]');if(dialog){let message=dialog.querySelector('[role=status]');if(!message){message=el('p');message.setAttribute('role','status');dialog.append(message);}message.textContent=text;}}
function error(e){const labels={'state-conflict':'別の画面で変更されました。再読込みしてからお試しください。','unreadable-state':'保存内容を読めません。元のデータは保持し、上書きを停止しました。','atomic-write-unavailable':'このブラウザでは安全な同時保存を利用できません。対応ブラウザで開いてください。','storage-unavailable':'保存領域を利用できません。元のデータは保持しています。','event-limit':'保存できる予定は200件までです。'};status(labels[e.code||e.message]||'処理を完了できませんでした。入力・バックアップの形式と保存領域を確認してください。');}
function button(text,action,secondary=false){const b=el('button',text);b.type='button';if(secondary)b.className='secondary';b.addEventListener('click',e=>{if(e.isTrusted)action();});return b;}
async function project(){projectionPending=false;try{await host.projectAgenda(state.events);}catch{projectionPending=true;}}
async function persist(next){if(busy)throw Error('busy');busy=true;try{const saved=await host.write({expectedRevision:snapshot.revision,data:next});snapshot=saved;state=decode(saved.data);await project();render();status(projectionPending?'予定を保存しました。ホームへの反映は未完了です。':'予定を保存しました。');}finally{busy=false;}}
function modal(title){const d=el('dialog'),h=el('h2',title);h.id='dialog-title';d.setAttribute('aria-labelledby',h.id);d.append(h);d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);return d;}
function confirm(title,description,action){const d=modal(title);d.append(el('p',description));const actions=el('div');actions.className='actions';actions.append(button('実行する',async()=>{try{await action();d.close();}catch(e){error(e);}}),button('キャンセル',()=>d.close(),true));d.append(actions);d.showModal();}
function render(){const list=$('events');list.replaceChildren();$('empty').hidden=state.events.length>0;for(const event of state.events){const li=el('li'),time=el('time',new Intl.DateTimeFormat('ja-JP',{dateStyle:'medium',timeStyle:'short'}).format(new Date(event.at)));time.dateTime=new Date(event.at).toISOString();li.append(time,el('h2',event.title),button('予定を削除',()=>confirm('この予定を削除しますか？',event.title,()=>persist({...state,events:state.events.filter(x=>x.id!==event.id)})),true));list.append(li);}}
$('add').addEventListener('click',()=>{
  const d=modal('予定を追加'),f=el('form');f.method='dialog';f.setAttribute('aria-labelledby','dialog-title');
  const title=el('input');title.id='event-title';title.name='title';title.required=true;title.maxLength=160;title.enterKeyHint='next';
  const date=el('input');date.id='event-date';date.name='at';date.type='datetime-local';date.required=true;date.value=new Date(Date.now()+3600000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  for(const [input,label]of [[title,'予定の名前（必須）'],[date,'日時（必須）']]){const l=el('label',label);l.htmlFor=input.id;f.append(l,input);}
  const actions=el('div');actions.className='actions';const submit=el('button','保存');submit.type='submit';actions.append(submit,button('キャンセル',()=>d.close(),true));f.append(actions);
  title.addEventListener('input',()=>title.setCustomValidity(''));f.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.isComposing)e.preventDefault();});
  f.addEventListener('submit',async e=>{e.preventDefault();title.setCustomValidity(title.value.trim()?'':'予定の名前を入力してください。');if(!f.reportValidity())return;submit.disabled=true;try{await persist(saveEvent(state,{id:crypto.randomUUID(),title:title.value.trim(),at:new Date(date.value).getTime()}));d.close();}catch(e){error(e);}finally{submit.disabled=false;}});
  d.append(f);d.showModal();title.focus();
});
$('export').addEventListener('click',()=>{const d=modal('バックアップを書き出す');d.append(el('p','この JSON をコピーして安全な場所に保存してください。予定の名前と日時が含まれます。'));const text=el('textarea');text.value=JSON.stringify(state,null,2);text.readOnly=true;text.setAttribute('aria-label','予定のバックアップ JSON');d.append(text,button('閉じる',()=>d.close()));d.showModal();text.focus();text.select();});
async function offerImport(events){const next=decode({schema:SCHEMA,events});confirm('予定を読み込みますか？',`${next.events.length}件を確認しました。現在の${state.events.length}件と統合します。同じ ID の予定は現在の内容を保持します。`,async()=>{const ids=new Set(state.events.map(x=>x.id));await persist(decode({schema:SCHEMA,events:[...state.events,...next.events.filter(x=>!ids.has(x.id))]}));});}
$('import').addEventListener('change',async e=>{const file=e.target.files?.[0];try{if(!file)return;if(file.size>131072)throw Error('data-too-large');await offerImport(importEvents(await file.text()));}catch(e){error(e);}finally{e.target.value='';}});
$('legacy').addEventListener('click',async()=>{try{const events=await host.legacyAgenda();if(events===null){status('移行対象の予定はありません。');return;}await offerImport(events);}catch(e){error(e);}});
window.addEventListener('storage',e=>{if(e.key==='awai.shell.host.v1:network.itonami.yotei')status('別の画面で予定が変更されました。保存前に再読込みしてください。');});
async function start(){try{await host.initialize();snapshot=await host.read();state=decode(snapshot.data);const info=host.info();$('environment').textContent=`${info.runtime==='web'?'Web':'Awai Shell / Tauri v3'} · 端末内に保存`;$('legacy').hidden=!info.capabilities.agendaProjection;$('add').disabled=!info.capabilities.atomicWrite;$('export').disabled=false;render();if(info.capabilities.agendaProjection){const legacy=await host.legacyAgenda();if(snapshot.revision===0&&legacy?.length)await offerImport(legacy);else if(snapshot.revision>0)await project();}}catch(e){$('import').disabled=true;error(e);}}
start();
