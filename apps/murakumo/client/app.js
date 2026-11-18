// Murakumo model manager (AWAI-3203 stage 4a). Figma: docs/otehon/murakumo-model-manager-20261118.md §7.
// The catalog, fit and recommendation come from the shared CLJC domain (window.AwaiInferenceManager);
// the native plugin owns files, digests, the engine and usage readings. No network here.
import {bind_native} from './awai-ui/index.js';
import {requestAdmission} from './contract.js';
import {createClientConsentHost,createClientOperationBroker} from './runtime.js';
import {runtimeFor,DOWNLOAD_CAPABILITY,DOWNLOAD_SERVICE,operationFor} from './download-contract.js';
import {appRuntime,appCapabilities,devicesProblems,USAGE_CAPABILITY,USAGE_OPERATION,USAGE_PATH,usageService} from './devices-contract.js';
import {verifyReport,readReport} from './usage-report.js';
import pinnedDevices from './devices.js';
bind_native(document.documentElement,{tonal:'.tonal,.secondary',text:'#files button'});
const CONTEXT=2048;
const M={
 ja:{allDevices:'全端末',allDevicesLead:'各端末が署名して送った報告',readReports:'報告を読む',
  dev:{android:'Android',mac:'Mac',recommended:'推奨 {model}',fresh:'報告 {age}',stale:'{age} の報告のあと、新しい報告がありません',none:'まだ報告を読んでいません',invalid:'報告の内容が正しくないため表示しません',
   unverified:'署名を確認できないため表示しません（{reason}）',unreachable:'報告が届きませんでした',denied:'読みませんでした。何も送っていません。',reading:'{device} の報告を読んでいます…',read:'報告を読みました',noDevices:'登録した端末はありません',
   unrecognized:'カタログにないモデル',engineNone:'読み込み中のモデルなし',engineLoading:'モデルを読み込み中',cpu:'CPU',appCpu:'このアプリの CPU'},
  context:'この端末で推論',models:'モデル',thisDevice:'この端末',loaded:'読み込み中',release:'メモリから解放',prompt:'何を生成しますか？',placeholder:'短い自己紹介を日本語で書いて。',generate:'生成する',stop:'停止する',result:'結果',capability:'対応：テキスト · 画像・動画エンジンは未接続',estimateNote:'推定 = ファイル + context 2048 のメモリ + 0.3 GiB。予算は RAM の 40 %。',
  recommended:'推奨',recommendLine:'この端末の推奨：{model}（推定 {estimate} / 予算 {budget}）',noRecommendation:'この端末に入るモデルはありません。',unknownRam:'この端末の RAM が分からないため、推奨できません。',
  fit:{comfortable:'快適',tight:'余裕少','no-fit':'入らない',unknown:'不明'},
  act:{load:'読み込む',loaded:'読み込み済み',loading:'読み込み中…',import:'ファイルから取り込む',cannot:'読み込めません',download:'ダウンロード',downloading:'取得中 {percent} %',stop:'止める'},
  dl:{progress:'取得 · {model}',done:'取得し、SHA-256 が一致したため取り込みました。',denied:'取得をやめました。何も送っていません。',mismatch:'SHA-256 が一致しないため破棄しました。何も読み込んでいません。',budget:'宣言したサイズを超えたため破棄しました。',redirect:'宣言していない配信元へ転送されたため止めました。',cancelled:'取得を止め、途中のファイルを消しました。',failed:'取得できませんでした。途中のファイルは消しました。'},
  detail:'{quant} · {size} · 推定 {estimate}',imported:'取り込み済み',noModel:'読み込み中のモデルなし',loadedDetail:'ctx {context} · {state} · {since} から',
  state:{idle:'待機中',busy:'生成中',loading:'読み込み中'},ram:'RAM',appCpu:'このアプリの CPU',cpuUnknown:'端末全体の CPU は読めません',gpu:'GPU',gpuNone:'不明 · エンジンは CPU',disk:'ディスク',free:'{free} 空き / {total}',unknown:'不明',
  ready:'準備完了',loadingModel:'モデルを読み込んでいます…',importing:'ファイルを選んでください',releasing:'解放しています…',generating:'生成しています…',generated:'生成しました',checkInput:'入力内容を確認してください。',
  err:{busy:'別の処理が終わってから、もう一度お試しください。','model-import-rejected':'ファイルがこのモデルの SHA-256 と一致しないため、取り込みませんでした。','model-digest-mismatch':'ファイルが SHA-256 と一致しないため、読み込みませんでした。','release-required':'読み込み中のモデルは、解放してから取り込み直してください。',cancelled:'取り込みをやめました。','native-operation-rejected':'処理を完了できませんでした。',other:'処理を完了できませんでした。もう一度お試しください。'}},
 en:{allDevices:'All devices',allDevicesLead:'Reports each device signed',readReports:'Read reports',
  dev:{android:'Android',mac:'Mac',recommended:'Recommended {model}',fresh:'Reported {age}',stale:'No newer report since {age}',none:'No report read yet',invalid:'The report is not valid, so nothing is shown',
   unverified:'The signature could not be checked, so nothing is shown ({reason})',unreachable:'The report did not arrive',denied:'Not read. Nothing was sent.',reading:'Reading {device}…',read:'Reports read',noDevices:'No devices are pinned',
   unrecognized:'Model not in the catalog',engineNone:'No model loaded',engineLoading:'Loading a model',cpu:'CPU',appCpu:'This app’s CPU'},
  context:'Inference on this device',models:'Models',thisDevice:'This device',loaded:'Loaded',release:'Release memory',prompt:'What should it write?',placeholder:'Write a short self-introduction.',generate:'Generate',stop:'Stop',result:'Result',capability:'Text only. Image and video engines are not connected.',estimateNote:'Estimate = file + memory for context 2048 + 0.3 GiB. Budget is 40 % of RAM.',
  recommended:'Recommended',recommendLine:'Recommended here: {model} (est. {estimate} of {budget} budget)',noRecommendation:'No model fits this device.',unknownRam:'This device’s RAM is unknown, so there is no recommendation.',
  fit:{comfortable:'Comfortable',tight:'Tight','no-fit':'Doesn’t fit',unknown:'Unknown'},
  act:{load:'Load',loaded:'Loaded',loading:'Loading…',import:'Import from file',cannot:'Can’t load',download:'Download',downloading:'Downloading {percent} %',stop:'Stop'},
  dl:{progress:'Download · {model}',done:'Downloaded; the SHA-256 matched and the model was imported.',denied:'Download cancelled. Nothing was sent.',mismatch:'The SHA-256 did not match, so the file was discarded and nothing was loaded.',budget:'The file exceeded its declared size and was discarded.',redirect:'The download was redirected to an undeclared host and stopped.',cancelled:'Download stopped; the partial file was deleted.',failed:'The download failed; the partial file was deleted.'},
  detail:'{quant} · {size} · est. {estimate}',imported:'imported',noModel:'No model loaded',loadedDetail:'ctx {context} · {state} · since {since}',
  state:{idle:'idle',busy:'generating',loading:'loading'},ram:'RAM',appCpu:'This app’s CPU',cpuUnknown:'Device-wide CPU is not readable',gpu:'GPU',gpuNone:'Unknown · CPU engine',disk:'Disk',free:'{free} free of {total}',unknown:'Unknown',
  ready:'Ready',loadingModel:'Loading the model…',importing:'Choose the file',releasing:'Releasing…',generating:'Generating…',generated:'Done',checkInput:'Check the prompt.',
  err:{busy:'Try again when the current task ends.','model-import-rejected':'The file does not match this model’s SHA-256, so it was not imported.','model-digest-mismatch':'The file does not match its SHA-256, so it was not loaded.','release-required':'Release the loaded model before importing it again.',cancelled:'Import cancelled.','native-operation-rejected':'The operation could not finish.',other:'The operation could not finish. Try again.'}}};
const L=navigator.language?.startsWith('ja')?M.ja:M.en;document.documentElement.lang=L===M.ja?'ja':'en';
const t=(text,vars={})=>text.replace(/\{(\w+)\}/g,(_,k)=>vars[k]??'');
const $=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat(document.documentElement.lang,{maximumFractionDigits:1});
const gib=n=>n==null?L.unknown:(n>=2**30?`${fmt.format(n/2**30)} GiB`:`${fmt.format(n/2**20)} MiB`);
const timeFmt=new Intl.DateTimeFormat(document.documentElement.lang,{hour:'2-digit',minute:'2-digit'});
for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=L[el.dataset.i18n];
for(const el of document.querySelectorAll('[data-i18n-placeholder]'))el.placeholder=L[el.dataset.i18nPlaceholder];
const invoke=request=>window.__TAURI_INTERNALS__.invoke('inference_operation',{request});
const manager=window.AwaiInferenceManager;
const message=error=>L.err[error]||L.err.other;
let busy=false,catalog=[],status=null,usage=null;
// Downloads (AWAI-3307): the canonical broker asks for consent per download, follows only the declared
// CDN redirects, hashes the stream and closes the host sink only on an exact SHA-256 match.
// All devices (AWAI-3377): owner-pinned devices, each read with fresh consent and checked against its pinned key.
const devices=devicesProblems(pinnedDevices).length?[]:pinnedDevices;const reports=new Map(); // id -> {usage}|{error,reason}
const REPORT_MAX_AGE_MS=120000;const rel=new Intl.RelativeTimeFormat(document.documentElement.lang,{numeric:'auto'});
const ago=ms=>ms<60000?rel.format(-Math.round(ms/1000),'second'):ms<3600000?rel.format(-Math.round(ms/60000),'minute'):ms<86400000?rel.format(-Math.round(ms/3600000),'hour'):rel.format(-Math.round(ms/86400000),'day');
let broker=null,download=null; // download: {id,written,total,controller}
const CHUNK=4*1024*1024;
// Tauri on Android sends IPC as JSON (no request bodies), so chunks travel as base64 strings.
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s);}
function sinkFor(id){return async()=>{await window.__TAURI_INTERNALS__.invoke('model_download_begin',{model:id});
 let parts=[],held=0;const flush=async()=>{if(!held)return;const buf=new Uint8Array(held);let o=0;for(const p of parts){buf.set(p,o);o+=p.byteLength;}parts=[];held=0;await window.__TAURI_INTERNALS__.invoke('model_download_write',{chunk:base64(buf)});};
 return {write:async(chunk)=>{parts.push(chunk);held+=chunk.byteLength;download.written+=chunk.byteLength;if(held>=CHUNK){await flush();renderModels();}},
  close:async()=>{await flush();await window.__TAURI_INTERNALS__.invoke('model_download_finish');return {imported:true,model:id};},
  abort:async()=>{parts=[];held=0;await window.__TAURI_INTERNALS__.invoke('model_download_abort');}};};}
function setupBroker(){const runtime=appRuntime({models:catalog},devices);const sinks={[DOWNLOAD_SERVICE]:Object.fromEntries(catalog.map(m=>[operationFor(m.id),sinkFor(m.id)]))};
 broker=createClientOperationBroker({runtime,requestedCapabilities:appCapabilities(devices),approvedOperations:runtime.operations,
  hostSupportedOperations:runtime.operations.map(o=>[o.capability,o.service,o.operation]),consentHost:createClientConsentHost(),artifactSinks:sinks});}
const dlMessage=e=>/not approved/.test(e)?L.dl.denied:/digest mismatch/.test(e)?L.dl.mismatch:/byte budget/.test(e)?L.dl.budget:/not declared/.test(e)?L.dl.redirect:/cancelled/.test(e)?L.dl.cancelled:L.dl.failed;
async function startDownload(m){if(!broker||download)return;const controller=new AbortController();download={id:m.id,written:0,total:m.bytes,controller};renderModels();
 $('generation-status').textContent=t(L.dl.progress,{model:m.label});
 try{const op=runtimeFor({models:[m]}).operations[0];await broker.invoke({capability:op.capability,service:op.service,operation:op.operation},{input:`${op.endpoint.origin}${op.endpoint.path}`},{signal:controller.signal});$('generation-status').textContent=L.dl.done;}
 catch(e){const raw=String(e?.message??e);$('generation-status').textContent=dlMessage(raw);$('generation-status').dataset.error=raw;}
 finally{download=null;await refresh();}}

function button(label,{primary=false,disabled=false,onClick}={}){const b=document.createElement('button');b.type='button';b.textContent=label;if(!primary)b.className='tonal';b.disabled=disabled||busy;if(onClick)b.addEventListener('click',e=>{if(e.isTrusted&&!busy)onClick();});return b;}
function meter(label,value,fraction){const box=document.createElement('div');box.className='meter';const row=document.createElement('div');row.className='meter-row';const l=document.createElement('span');l.textContent=label;const v=document.createElement('span');v.textContent=value;row.append(l,v);const track=document.createElement('div');track.className='track';if(fraction==null){track.classList.add('unknown');}else{const fill=document.createElement('div');fill.className='fill';fill.style.inlineSize=`${Math.max(0,Math.min(100,fraction*100))}%`;track.append(fill);}box.append(row,track);return box;}

function renderModels(){
 const list=$('model-list');list.replaceChildren();
 const ram=usage?.ram?.total??null;
 const rec=manager.recommend(catalog,'android',ram,CONTEXT);
 const fits=Object.fromEntries(rec.fits);
 const byId=Object.fromEntries(catalog.map(m=>[m.id,m]));
 if(ram==null)$('recommendation').textContent=L.unknownRam;
 else if(!rec.recommended)$('recommendation').textContent=L.noRecommendation;
 else $('recommendation').textContent=t(L.recommendLine,{model:byId[rec.recommended].label,estimate:gib(manager.estimateBytes(byId[rec.recommended],CONTEXT)),budget:gib(rec.budget)});
 const imported=Object.fromEntries((status?.models??[]).map(m=>[m.id,m.imported]));
 for(const m of catalog){
  const li=document.createElement('li');li.className='model-row';li.dataset.model=m.id;
  const info=document.createElement('div');info.className='info';
  const name=document.createElement('p');name.className='name';name.textContent=m.id===rec.recommended?`${m.label}　${L.recommended}`:m.label;
  const detail=document.createElement('p');detail.className='detail';detail.textContent=t(L.detail,{quant:m.quant,size:gib(m.bytes),estimate:gib(manager.estimateBytes(m,CONTEXT))})+(imported[m.id]?` · ${L.imported}`:'');
  info.append(name,detail);
  const fit=fits[m.id]??'unknown';const badge=document.createElement('span');badge.className=`badge ${fit}`;badge.textContent=L.fit[fit];
  let action;
  if(status?.loadedModel===m.id)action=button(L.act.loaded,{primary:true,disabled:true});
  else if(status?.loading===m.id)action=button(L.act.loading,{primary:true,disabled:true});
  else if(fit==='no-fit')action=button(L.act.cannot,{primary:true,disabled:true});
  else if(imported[m.id])action=button(L.act.load,{primary:true,onClick:()=>run({action:'load',model:m.id},L.loadingModel)});
  else if(download?.id===m.id)action=button(t(L.act.downloading,{percent:Math.floor(download.written*100/download.total)}),{primary:true,disabled:true});
  else action=button(L.act.download,{primary:true,disabled:!!download||!broker,onClick:()=>startDownload(m)});
  li.append(info,badge,action);
  if(!imported[m.id]&&download?.id!==m.id&&fit!=='no-fit')li.append(button(L.act.import,{disabled:!!download,onClick:()=>run({action:'import',model:m.id},L.importing)}));
  if(download?.id===m.id){const stop=document.createElement('button');stop.type='button';stop.className='tonal';stop.textContent=L.act.stop;stop.addEventListener('click',e=>{if(e.isTrusted)download?.controller.abort();});li.append(meter(t(L.dl.progress,{model:m.label}),`${gib(download.written)} / ${gib(download.total)}`,download.written/download.total),stop);}
  list.append(li);
 }
}

function renderDevice(){
 const label=catalog.find(m=>m.id===usage?.loaded?.model)?.label;
 $('loaded-model').textContent=label??L.noModel;
 $('loaded-detail').textContent=usage?.loaded?t(L.loadedDetail,{context:usage.loaded.context,state:L.state[usage.loaded.state],since:timeFmt.format(new Date(usage.loaded['since-ms']))}):'';
 const r=usage?.ram,d=usage?.disk,cpu=usage?.['app-cpu-percent'];
 $('meters').replaceChildren(
  meter(L.ram,r?.total!=null&&r?.used!=null?`${gib(r.used)} / ${gib(r.total)}`:L.unknown,r?.total&&r?.used!=null?r.used/r.total:null),
  meter(L.appCpu,cpu!=null?`${cpu} % · ${L.cpuUnknown}`:L.unknown,cpu!=null?cpu/100:null),
  meter(L.gpu,L.gpuNone,null),
  meter(L.disk,d?.free!=null&&d?.total?t(L.free,{free:gib(d.free),total:gib(d.total)}):L.unknown,d?.total&&d?.free!=null?(d.total-d.free)/d.total:null));
 $('release').disabled=busy||!status?.loaded;
}

async function readReports(){if(!broker)return;const button=$('read-reports');button.disabled=true;
 try{for(const d of devices){$('devices-status').textContent=t(L.dev.reading,{device:d.label??d.id});
  try{const response=await broker.invoke({capability:USAGE_CAPABILITY,service:usageService(d.id),operation:USAGE_OPERATION},{input:`${d.origin}${USAGE_PATH}`});
   const v=await verifyReport(await readReport(response),d);
   if(v.ok)reports.set(d.id,{usage:v.usage});else reports.set(d.id,{...reports.get(d.id),error:'unverified',reason:v.reason});}
  catch(e){const denied=/not approved/.test(String(e?.message??e));reports.set(d.id,{...reports.get(d.id),error:denied?'denied':'unreachable',reason:String(e?.message??e)});}
  renderDevices();}
  $('devices-status').textContent=L.dev.read;}
 finally{button.disabled=false;}}
function deviceCard(title,kind,usage,note){
 const li=document.createElement('li');li.className='device-card';li.dataset.device=usage?.device??title;
 const v=usage?manager.deviceView(catalog,usage,Date.now(),REPORT_MAX_AGE_MS,CONTEXT):null;const fresh=v?.state==='fresh';
 const h=document.createElement('h3');h.textContent=title;
 const facts=[L.dev[kind]];if(fresh&&v['ram-total'])facts.push(gib(v['ram-total']));if(fresh&&v.recommended)facts.push(t(L.dev.recommended,{model:catalog.find(m=>m.id===v.recommended)?.label??v.recommended}));
 const line=document.createElement('p');line.className='label';line.textContent=facts.join(' · ');
 const when=document.createElement('p');when.className='label';when.dataset.state=v?.state??'none';
 when.textContent=!v?L.dev.none:v.state==='fresh'?t(L.dev.fresh,{age:ago(v['age-ms'])}):v.state==='stale'?t(L.dev.stale,{age:ago(v['age-ms'])}):v.state==='invalid'?L.dev.invalid:L.unknown;
 li.append(h,line,when);
 if(note){const n=document.createElement('p');n.className='label warn';n.textContent=note;li.append(n);}
 const box=document.createElement('div');const lab=document.createElement('p');lab.className='label';lab.textContent=L.loaded;const name=document.createElement('p');name.className='loaded-name';
 const ld=v?.loaded;const label=ld&&(catalog.find(m=>m.id===ld.model)?.label??(ld.model==='unrecognized'?L.dev.unrecognized:ld.model));
 name.textContent=!fresh?L.unknown:ld?`${label} · ${L.state[ld.state]}`:usage.engine==='loading'?L.dev.engineLoading:usage.engine==='serving'||usage.engine==='unknown'?L.unknown:L.dev.engineNone;
 box.append(lab,name);li.append(box);
 const cpu=kind==='android'?usage?.['app-cpu-percent']??null:v?.['cpu-percent']??null;
 li.append(meter(L.ram,fresh&&v['ram-total']!=null&&v['ram-used']!=null?`${gib(v['ram-used'])} / ${gib(v['ram-total'])}`:L.unknown,fresh&&v['ram-total']&&v['ram-used']!=null?v['ram-used']/v['ram-total']:null),
  meter(kind==='android'?L.dev.appCpu:L.dev.cpu,fresh&&cpu!=null?`${cpu} %`:L.unknown,fresh&&cpu!=null?cpu/100:null),
  meter(L.gpu,fresh&&v['gpu-percent']!=null?`${v['gpu-percent']} %`:L.unknown,fresh&&v['gpu-percent']!=null?v['gpu-percent']/100:null),
  meter(L.disk,fresh&&v['disk-free']!=null?t(L.free,{free:gib(v['disk-free']),total:gib(usage.disk.total)}):L.unknown,fresh&&v['disk-free']!=null&&usage.disk.total?(usage.disk.total-v['disk-free'])/usage.disk.total:null));
 return li;}
function renderDevices(){
 const cards=[deviceCard(L.thisDevice,'android',usage,null)];
 for(const d of devices){const r=reports.get(d.id);const note=r?.error==='unverified'?t(L.dev.unverified,{reason:r.reason}):r?.error==='unreachable'?L.dev.unreachable:r?.error==='denied'?L.dev.denied:null;cards.push(deviceCard(d.label??d.id,d.kind,r?.usage??null,note));}
 $('device-list').replaceChildren(...cards);$('read-reports').hidden=!devices.length;if(!devices.length)$('devices-status').textContent=L.dev.noDevices;}
$('read-reports').addEventListener('click',e=>{if(e.isTrusted)readReports();});
async function refresh(){
 try{[status,usage]=await Promise.all([invoke({action:'status'}),invoke({action:'usage'})]);
  const problems=manager.usageProblems(usage);if(problems.length)usage=null;}
 catch{status=null;usage=null;}
 renderModels();renderDevice();renderDevices();
}
function setBusy(value){busy=value;$('generate').disabled=value;$('cancel').hidden=!value;renderModels();renderDevice();}
async function run(request,progress){setBusy(true);$('generation-status').textContent=progress;try{await invoke(request);$('generation-status').textContent=L.ready;}catch(e){$('generation-status').textContent=message(e);}finally{busy=false;await refresh();setBusy(false);}}
$('release').addEventListener('click',e=>{if(e.isTrusted&&!busy)run({action:'release'},L.releasing);});
$('cancel').addEventListener('click',e=>{if(e.isTrusted)invoke({action:'cancel'}).catch(()=>{});});
$('generate-form').addEventListener('submit',async e=>{e.preventDefault();if(!e.isTrusted||busy)return;const prompt=$('prompt').value;if(requestAdmission('text',prompt,128)!=='accepted'){$('generation-status').textContent=L.checkInput;$('prompt').focus();return;}setBusy(true);$('generation-status').textContent=L.generating;try{const result=await invoke({action:'generate',modality:'text',prompt,maxTokens:128});$('result').textContent=result.text;window.awaiLastGeneration={engine:result.engine,outputTokens:result.outputTokens};$('generation-status').textContent=L.generated;}catch(e){$('generation-status').textContent=message(e);}finally{busy=false;await refresh();setBusy(false);}});
(async()=>{try{catalog=(await invoke({action:'catalog'})).models;const problems=manager.catalogProblems({schema:'awai.murakumo.catalog.v1',models:catalog});if(problems.length)catalog=[];}catch{catalog=[];}
 try{if(catalog.length)setupBroker();}catch{broker=null;}await refresh();setInterval(()=>{if(!busy&&!document.hidden)refresh();},5000);})();
