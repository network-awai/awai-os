// Murakumo model manager (AWAI-3203 stage 4a). Figma: docs/otehon/murakumo-model-manager-20261118.md §7.
// The catalog, fit and recommendation come from the shared CLJC domain (window.AwaiInferenceManager);
// the native plugin owns files, digests, the engine and usage readings. No network here.
import {bind_native} from './awai-ui/index.js';
import {requestAdmission} from './contract.js';
bind_native(document.documentElement,{tonal:'.tonal,.secondary',text:'#files button'});
const CONTEXT=2048;
const M={
 ja:{context:'この端末で推論',models:'モデル',thisDevice:'この端末',loaded:'読み込み中',release:'メモリから解放',prompt:'何を生成しますか？',placeholder:'短い自己紹介を日本語で書いて。',generate:'生成する',stop:'停止する',result:'結果',capability:'対応：テキスト · 画像・動画エンジンは未接続',estimateNote:'推定 = ファイル + context 2048 のメモリ + 0.3 GiB。予算は RAM の 40 %。',
  recommended:'推奨',recommendLine:'この端末の推奨：{model}（推定 {estimate} / 予算 {budget}）',noRecommendation:'この端末に入るモデルはありません。',unknownRam:'この端末の RAM が分からないため、推奨できません。',
  fit:{comfortable:'快適',tight:'余裕少','no-fit':'入らない',unknown:'不明'},
  act:{load:'読み込む',loaded:'読み込み済み',loading:'読み込み中…',import:'ファイルから取り込む',cannot:'読み込めません'},
  detail:'{quant} · {size} · 推定 {estimate}',imported:'取り込み済み',noModel:'読み込み中のモデルなし',loadedDetail:'ctx {context} · {state} · {since} から',
  state:{idle:'待機中',busy:'生成中',loading:'読み込み中'},ram:'RAM',appCpu:'このアプリの CPU',cpuUnknown:'端末全体の CPU は読めません',gpu:'GPU',gpuNone:'不明 · エンジンは CPU',disk:'ディスク',free:'{free} 空き / {total}',unknown:'不明',
  ready:'準備完了',loadingModel:'モデルを読み込んでいます…',importing:'ファイルを選んでください',releasing:'解放しています…',generating:'生成しています…',generated:'生成しました',checkInput:'入力内容を確認してください。',
  err:{busy:'別の処理が終わってから、もう一度お試しください。','model-import-rejected':'ファイルがこのモデルの SHA-256 と一致しないため、取り込みませんでした。','model-digest-mismatch':'ファイルが SHA-256 と一致しないため、読み込みませんでした。','release-required':'読み込み中のモデルは、解放してから取り込み直してください。',cancelled:'取り込みをやめました。','native-operation-rejected':'処理を完了できませんでした。',other:'処理を完了できませんでした。もう一度お試しください。'}},
 en:{context:'Inference on this device',models:'Models',thisDevice:'This device',loaded:'Loaded',release:'Release memory',prompt:'What should it write?',placeholder:'Write a short self-introduction.',generate:'Generate',stop:'Stop',result:'Result',capability:'Text only. Image and video engines are not connected.',estimateNote:'Estimate = file + memory for context 2048 + 0.3 GiB. Budget is 40 % of RAM.',
  recommended:'Recommended',recommendLine:'Recommended here: {model} (est. {estimate} of {budget} budget)',noRecommendation:'No model fits this device.',unknownRam:'This device’s RAM is unknown, so there is no recommendation.',
  fit:{comfortable:'Comfortable',tight:'Tight','no-fit':'Doesn’t fit',unknown:'Unknown'},
  act:{load:'Load',loaded:'Loaded',loading:'Loading…',import:'Import from file',cannot:'Can’t load'},
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
  else action=button(L.act.import,{onClick:()=>run({action:'import',model:m.id},L.importing)});
  li.append(info,badge,action);list.append(li);
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

async function refresh(){
 try{[status,usage]=await Promise.all([invoke({action:'status'}),invoke({action:'usage'})]);
  const problems=manager.usageProblems(usage);if(problems.length)usage=null;}
 catch{status=null;usage=null;}
 renderModels();renderDevice();
}
function setBusy(value){busy=value;$('generate').disabled=value;$('cancel').hidden=!value;renderModels();renderDevice();}
async function run(request,progress){setBusy(true);$('generation-status').textContent=progress;try{await invoke(request);$('generation-status').textContent=L.ready;}catch(e){$('generation-status').textContent=message(e);}finally{busy=false;await refresh();setBusy(false);}}
$('release').addEventListener('click',e=>{if(e.isTrusted&&!busy)run({action:'release'},L.releasing);});
$('cancel').addEventListener('click',e=>{if(e.isTrusted)invoke({action:'cancel'}).catch(()=>{});});
$('generate-form').addEventListener('submit',async e=>{e.preventDefault();if(!e.isTrusted||busy)return;const prompt=$('prompt').value;if(requestAdmission('text',prompt,128)!=='accepted'){$('generation-status').textContent=L.checkInput;$('prompt').focus();return;}setBusy(true);$('generation-status').textContent=L.generating;try{const result=await invoke({action:'generate',modality:'text',prompt,maxTokens:128});$('result').textContent=result.text;window.awaiLastGeneration={engine:result.engine,outputTokens:result.outputTokens};$('generation-status').textContent=L.generated;}catch(e){$('generation-status').textContent=message(e);}finally{busy=false;await refresh();setBusy(false);}});
(async()=>{try{catalog=(await invoke({action:'catalog'})).models;const problems=manager.catalogProblems({schema:'awai.murakumo.catalog.v1',models:catalog});if(problems.length)catalog=[];}catch{catalog=[];}await refresh();setInterval(()=>{if(!busy&&!document.hidden)refresh();},5000);})();
