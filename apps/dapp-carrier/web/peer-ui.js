import {createClientConsentHost,createClientOperationBroker} from './runtime.js';
import {createHost} from './host.js';
const config=await(await fetch('./dapp.json')).json();
const locale=navigator.language.startsWith('ja')?'ja':'en';
const copy={
 ja:{temporaryStorage:'この起動セッションのデータです。再起動すると、この端末のアプリデータは失われます。',title:'同期と受信',open:'同期と受信',snapshot:'スナップショット CID（必須）',peer:'接続する Peer',sourcePeer:'送信元 PeerID',readBack:'受信した内容を同じ相手へ返送することも許可',details:'接続と受信の詳細',listener:'この端末の受信アドレス',minutes:'受信時間（分）',budget:'容量上限（MiB）',push:'送信を確認',pull:'取得を確認',query:'保持を確認',receive:'受信を開始',stop:'受信を停止',cancel:'通信を中止',import:'スナップショットを選ぶ',root:'信頼する WNFS root CID（必須）',file:'WNFS CAR ファイル（必須）',store:'端末に保存',permission:'端末間通信と受信通知を許可',close:'閉じる',idle:'受信していません',busy:'操作を確認しています',receiving:'受信中 · {minutes} 分以内に終了',stored:'検証して保存しました',sent:'送信して保持を確認しました',pinned:'保持を確認しました',denied:'許可されませんでした',failed:'処理を完了できませんでした。接続先と詳細を確認してください。',unsupported:'このプレビューの同期・受信は APK で利用できます。',notified:'Android の許可を確認してから、通信を開始してください。',permissionRequired:'端末間通信と通知を許可してから、受信を開始してください。',importing:'ファイルを確認しています',invalidPeer:'PeerID を含む接続アドレスを入力してください。',invalidSource:'送信元の PeerID を入力してください。',localPeer:'この端末の PeerID',result:'操作の詳細',preview:'P2P 接続プレビュー'},
 en:{temporaryStorage:'This session uses temporary storage. Restarting this device will erase its app data.',title:'Sync and receive',open:'Sync and receive',snapshot:'Snapshot CID (required)',peer:'Peer address',sourcePeer:'Sender PeerID',readBack:'Also allow this peer to retrieve the received snapshot',details:'Connection and receive details',listener:'Listen address on this device',minutes:'Receive duration (minutes)',budget:'Byte budget (MiB)',push:'Review send',pull:'Review fetch',query:'Check retention',receive:'Start receiving',stop:'Stop receiving',cancel:'Cancel transfer',import:'Choose a snapshot',root:'Trusted WNFS root CID (required)',file:'WNFS CAR file (required)',store:'Save on device',permission:'Allow local network and receive notifications',close:'Close',idle:'Not receiving',busy:'Review the operation',receiving:'Receiving · ends within {minutes} minutes',stored:'Verified and saved',sent:'Sent and retention verified',pinned:'Retention verified',denied:'Operation was denied',failed:'The operation failed. Check the peer and operation details.',unsupported:'Sync and receive are available in the APK preview.',notified:'After approving Android permissions, start the operation.',permissionRequired:'Allow local network access and notifications before receiving.',importing:'Checking the file',invalidPeer:'Enter a peer address containing its PeerID.',invalidSource:'Enter the sender PeerID.',localPeer:'This device’s PeerID',result:'Operation details',preview:'P2P connectivity preview'}
};
const t=(key,args={})=>copy[locale][key].replace(/\{(\w+)\}/g,(_,name)=>String(args[name]??''));
const native=window.__TAURI__?.core;
const host=createHost({appId:config.id});await host.initialize();
const consent=createClientConsentHost();
const container=document.createElement(config.domainUi==='not-yet-ported'||config.domainUi==='snapshot-pin-query'?'section':'dialog');
container.id='awai-peer-panel';container.setAttribute('aria-labelledby','awai-peer-title');
container.innerHTML=`<h2 id="awai-peer-title">${t('title')}</h2><p id="awai-session-status" role="status" aria-live="polite"></p><p id="awai-peer-status" role="status" aria-live="polite"></p>
<form id="awai-transfer" aria-labelledby="awai-peer-title" action="#" method="post">
<label for="awai-snapshot">${t('snapshot')}</label><input id="awai-snapshot" name="snapshot" required maxlength="128" pattern="b[a-z2-7]{30,127}" autocorrect="off" autocapitalize="none" spellcheck="false">
<label for="awai-address">${t('peer')}</label><textarea id="awai-address" name="address" rows="3" maxlength="512" autocorrect="off" autocapitalize="none" spellcheck="false"></textarea>
<details><summary>${t('details')}</summary><label for="awai-source-peer">${t('sourcePeer')}</label><input id="awai-source-peer" name="sender" maxlength="128" autocorrect="off" autocapitalize="none" spellcheck="false">
<label for="awai-listen">${t('listener')}</label><input id="awai-listen" name="listen" value="/ip4/127.0.0.1/tcp/${config.listenPort}" maxlength="512" autocorrect="off" autocapitalize="none" spellcheck="false">
<label for="awai-minutes">${t('minutes')}</label><input id="awai-minutes" name="minutes" type="number" min="1" max="360" value="10" required>
<label for="awai-budget">${t('budget')}</label><input id="awai-budget" name="budget" type="number" min="1" max="256" value="16" required>
<div class="awai-read-back"><input id="awai-read-back" name="readback" type="checkbox"><label for="awai-read-back">${t('readBack')}</label></div><p>${t('localPeer')}</p><code id="awai-local-peer"></code><button id="awai-notifications" type="button">${t('permission')}</button></details>
<div class="awai-peer-actions">${['push','pull','query','receive'].map(name=>`<button type="submit" name="action" value="${name}">${t(name)}</button>`).join('')}<button type="button" id="awai-cancel">${t('cancel')}</button><button type="button" id="awai-stop">${t('stop')}</button></div></form>
<details><summary>${t('import')}</summary><form id="awai-import" action="#" method="post" aria-label="${t('import')}"><label for="awai-root">${t('root')}</label><input id="awai-root" name="root" required maxlength="128" pattern="b[a-z2-7]{30,127}" autocorrect="off" autocapitalize="none" spellcheck="false"><label for="awai-file">${t('file')}</label><input id="awai-file" name="car" type="file" accept=".car,application/vnd.ipld.car" required><button type="submit">${t('store')}</button></form></details>
<details><summary>${t('result')}</summary><pre id="awai-peer-result"></pre></details>`;
if(container.tagName==='DIALOG'){
 const close=document.createElement('button');close.type='button';close.textContent=t('close');close.onclick=()=>container.close();container.append(close);
 const open=document.createElement('button');open.id='awai-open-peer';open.type='button';open.textContent=t('open');open.onclick=()=>container.showModal();document.body.append(open,container);
}else{document.querySelector('main').append(container);}
const $=id=>document.getElementById(id);
const status=message=>{$('awai-peer-status').textContent=message;};
const receiveStatus=message=>{$('awai-session-status').textContent=message;};
const detail=value=>{$('awai-peer-result').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);};
let active,sessionId,nativeReady=false;
function fail(error){const message=String(error?.message??error);detail(message);status(message.includes('not approved')?t('denied'):(message.includes('notification-permission')||message.includes('local-network-permission'))?t('permissionRequired'):t('failed'));}
async function remember(snapshot){const state=await host.read();await host.write({expectedRevision:state.revision,data:{snapshot}});}
const state=await host.read();if(typeof state.data?.snapshot==='string')$('awai-snapshot').value=state.data.snapshot;
const invoke=(command,args={})=>{if(!native||(!nativeReady&&command!=='peer_host_info'))throw Error(t('unsupported'));return native.invoke(command,args);};
async function adapter({operation,signal}){
 const requestId=await invoke('peer_reserve');const cancel=()=>{void invoke('peer_cancel',{requestId}).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{if(signal.aborted)throw Error('cancelled');return await invoke('peer_snapshot_execute',{requestId,endpoint:operation.endpoint});}
 finally{signal.removeEventListener('abort',cancel);await invoke('peer_cancel',{requestId}).catch(()=>{});}
}
function invalid(input,message){input.setCustomValidity(message);input.reportValidity();input.focus();}
for(const id of ['awai-address','awai-source-peer'])$(id).addEventListener('input',()=>$(id).setCustomValidity(''));
$('awai-transfer').addEventListener('submit',async event=>{
 event.preventDefault();if(!nativeReady){status(t('unsupported'));return;}
 const action=event.submitter?.value;const names={push:'sync-push',pull:'sync-pull',query:'pin-query',receive:'receive-snapshot'};if(!names[action])return;
 const address=$('awai-address').value.trim();const peer=action==='receive'?$('awai-source-peer').value.trim():address.split('/').at(-1);
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(peer??'')){invalid($(action==='receive'?'awai-source-peer':'awai-address'),t(action==='receive'?'invalidSource':'invalidPeer'));return;}
 active?.abort();active=new AbortController();const controller=active;
 const scope={'snapshot-cid':$('awai-snapshot').value.trim(),'max-transfer-bytes':Number($('awai-budget').value)*1048576};
 if(action==='receive'){scope['listen-address']=$('awai-listen').value.trim();scope['receive-ms']=Number($('awai-minutes').value)*60000;scope['allow-read-back']=$('awai-read-back').checked;}
 const op={capability:'peer/snapshot',service:'yataverse-peer',operation:names[action],consent:'each-operation','data-categories':['selected-snapshot-content','content-identifiers','peer-metadata'],endpoint:{transport:'libp2p','peer-id':peer,addresses:action==='receive'?[]:[address],protocol:'/awai/yataverse/1.0.0',action:names[action],'max-request-bytes':1024,'max-response-bytes':4096,'timeout-ms':60000,scope}};
 const runtime={schema:'kotoba.app.client-runtime.v1',target:'browser',profile:'trusted-page-v1',entry:'index.html','local-state':{adapter:'memory',schema:'awai.peer.snapshot-operation.v1',version:1},operations:[op]};
 const buttons=[...$('awai-transfer').querySelectorAll('button[type=submit]')];buttons.forEach(button=>{button.disabled=true;});
 try{
  const broker=createClientOperationBroker({runtime,requestedCapabilities:['peer/snapshot'],approvedOperations:[op],hostSupportedOperations:[['peer/snapshot','yataverse-peer',names[action]]],consentHost:consent,peerAdapters:{'yataverse-peer':{[names[action]]:adapter}}});
  status(t('busy'));const result=await broker.invoke(op,{}, {signal:controller.signal});detail(result);
  if(action==='receive'){status('');sessionId=result.sessionId;receiveStatus(t('receiving',{minutes:Number($('awai-minutes').value)}));}
  else{if(action==='pull')await remember(scope['snapshot-cid']);status(t(action==='push'?'sent':action==='pull'?'stored':'pinned'));}
 }catch(error){fail(error);}finally{buttons.forEach(button=>{button.disabled=false;});if(active===controller)active=undefined;}
});
$('awai-cancel').onclick=()=>active?.abort();
$('awai-stop').onclick=async()=>{try{if(sessionId)await invoke('peer_stop',{sessionId});sessionId=undefined;receiveStatus(t('idle'));}catch(error){fail(error);}};
$('awai-notifications').onclick=async()=>{try{await invoke('peer_notification_permission');status(t('notified'));}catch(error){fail(error);}};
$('awai-import').addEventListener('submit',async event=>{
 event.preventDefault();let importId;const button=event.submitter;button.disabled=true;
 try{
  const file=$('awai-file').files[0];if(!file||file.size<1||file.size>268435456)throw Error('CAR size must be 1..256 MiB');status(t('importing'));
  importId=await invoke('peer_import_begin',{trustedRoot:$('awai-root').value.trim(),bytes:file.size});
  for(let offset=0;offset<file.size;offset+=65536){const bytes=new Uint8Array(await file.slice(offset,offset+65536).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));await invoke('peer_import_chunk',{importId,offset,data:btoa(text)});}
  const result=await invoke('peer_import_finish',{importId});importId=undefined;$('awai-snapshot').value=result.snapshot;await remember(result.snapshot);detail(result);status(t('stored'));
 }catch(error){fail(error);}finally{if(importId)await invoke('peer_import_cancel',{importId}).catch(()=>{});button.disabled=false;}
});
if(native){try{const info=await invoke('peer_host_info');if(info.schema!=='awai.shell.peer.v1')throw Error('peer-host-version-mismatch');nativeReady=true;if(info.storageKind==='temporary'){const notice=document.createElement('p');notice.className='awai-storage-notice';notice.setAttribute('role','note');notice.textContent=t('temporaryStorage');document.body.prepend(notice);if(container.tagName==='DIALOG')$('awai-peer-title').after(notice.cloneNode(true));}$('awai-local-peer').textContent=info.peerId;receiveStatus(t('idle'));}catch(error){fail(error);}setInterval(async()=>{try{const sessions=await invoke('peer_sessions');const current=sessions.find(s=>s.state==='receiving');if(current){sessionId=current.id;receiveStatus(t('receiving',{minutes:Math.max(1,Math.ceil((current.until-Date.now()/1000)/60))}));}else if(sessionId){sessionId=undefined;receiveStatus(t('idle'));}}catch{/* Retain the last explicit result; no remote fallback. */}},1000);}
else{status(t('unsupported'));for(const button of container.querySelectorAll('button'))if(button.type==='submit')button.disabled=true;}
