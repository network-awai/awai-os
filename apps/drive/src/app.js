import {bind_native} from './awai-ui/index.js';
bind_native(document.documentElement,{tonal:'.tonal,.secondary',text:'#files button'});
import*as encryptedSync from'./sync.js';
import './core.js';
import {translator,messages} from './i18n.js';
const {lang,t,bytes}=translator(navigator.language);document.documentElement.lang=lang;document.querySelectorAll('[data-i18n]').forEach(n=>n.textContent=t(n.dataset.i18n));document.querySelectorAll('[data-i18n-aria]').forEach(n=>n.setAttribute('aria-label',t(n.dataset.i18nAria)));
import {createHost} from './host.js';
import {clientRuntimeProblems,createClientConsentHost,createClientOperationBroker} from './runtime.js';
const descriptor={schema:'kotoba.app.client-runtime.v1',target:'browser',profile:'trusted-page-v1',entry:'index.html','local-state':{adapter:'memory',schema:'awai.drive.view.v1',version:1},workers:[],operations:[]};
if(clientRuntimeProblems(descriptor,[],location.origin).length)throw Error('invalid-runtime');
createClientOperationBroker({runtime:descriptor,requestedCapabilities:[],approvedOperations:[],hostSupportedOperations:[],consentHost:createClientConsentHost()});
const core=window.AwaiDriveCore,$=id=>document.getElementById(id),host=createHost({appId:'network.awai.drive'});let parent='',busy=false,mode='mkdir';

function message(s){$('status').textContent=s;}
async function call(op,extra={}){if(!core.validPath(parent))throw Error('invalid-path');return window.__TAURI__.core.invoke('drive_call',{request:{op,parent,...extra}});}
function fail(e){const s=String(e?.message||e);const label=t(Object.keys(messages[lang]).find(key=>key.startsWith('error.')&&s.includes(key.slice(6)))||'error.unknown');message(label);if($('edit').open)$('form-error').textContent=label;}
async function list(){const r=await call('list');$('files').replaceChildren();$('path').textContent=parent||t('storage.root');$('back').hidden=!parent;for(const item of r.entries){const li=document.createElement('li'),b=document.createElement('button'),label=document.createElement('span'),sub=document.createElement('small');label.textContent=(item.directory?'▸ ':'')+item.name;sub.textContent=item.directory?t('folder.caption'):t('file.caption',{size:bytes(item.bytes)});b.append(label,sub);b.onclick=()=>task(async()=>{if(item.directory){parent=item.path;await list();}else await call('open',{path:item.path});});li.append(b);$('files').append(li);}message(r.entries.length?'':t('status.empty'));const syncState=await encryptedSync.state();$('storage').textContent=t(syncState.synced?'sync.ready':syncState.evicted?'sync.evicted':encryptedSync.configured?'sync.dirty':'storage.state');}
async function task(fn){if(busy)return;busy=true;document.querySelectorAll('main button,#edit button').forEach(x=>x.disabled=true);try{await fn();}catch(e){fail(e);}finally{busy=false;document.querySelectorAll('main button,#edit button').forEach(x=>x.disabled=false);}}
$('back').onclick=()=>task(async()=>{parent=parent.split('/').slice(0,-1).join('/');await list();});$('refresh').onclick=()=>task(list);
$('import').onclick=()=>task(async()=>{message(t('status.importing'));await call('pick');await list();message(t('status.saved'));});
function edit(op){mode=op;$('title').textContent=t(op==='mkdir'?'folder.create':'file.note');$('content-label').hidden=op==='mkdir';$('name').value='';$('content').value='';$('form-error').textContent='';$('edit').showModal();$('name').focus();}
$('folder').onclick=()=>edit('mkdir');$('note').onclick=()=>edit('createText');$('cancel').onclick=()=>$('edit').close();
$('entry').onsubmit=e=>{e.preventDefault();if(!core.validName($('name').value)){$('form-error').textContent=t('error.invalid-name');return;}task(async()=>{await call(mode,{name:$('name').value,text:$('content').value});$('edit').close();await list();message(t('status.saved'));});};
await task(async()=>{await host.initialize();await list();});

$('sync').onclick=()=>task(async()=>{message(t('sync.busy'));await encryptedSync.sync();await list();$('storage').textContent=t('sync.ready');message(t('sync.success'));});
$('restore').onclick=()=>task(async()=>{message(t('sync.restoring'));await encryptedSync.restore();parent='';await list();$('storage').textContent=t('sync.ready');message(t('sync.restored'));});
$('evict').onclick=()=>{$('evict-confirm').showModal();};
$('evict-cancel').onclick=()=>$('evict-confirm').close();
$('evict-allow').onclick=()=>{$('evict-confirm').close();task(async()=>{await encryptedSync.evict();parent='';await list();$('storage').textContent=t('sync.evicted');});};
if(!encryptedSync.configured){$('sync').hidden=true;$('restore').hidden=true;$('evict').hidden=true;}
