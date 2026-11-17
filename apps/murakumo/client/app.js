import {bind_native} from './awai-ui/index.js';
bind_native(document.documentElement,{tonal:'.tonal,.secondary',text:'#files button'});
import {requestAdmission} from './contract.js';
const $=id=>document.getElementById(id);let busy=false;
const invoke=request=>window.__TAURI_INTERNALS__.invoke('inference_operation',{request});
const errorText={busy:'別の処理が終わってから、もう一度お試しください。','native-operation-rejected':'処理を完了できませんでした。モデルと接続を確認してください。','unsupported-modality':'このエンジンはテキスト生成に対応しています。'};
const message=error=>errorText[error]||'処理を完了できませんでした。モデルを選び直してお試しください。';
async function refresh(){try{const s=await invoke({action:'status'});$('model-state').textContent=s.loaded?'読み込み済み · CPU':s.imported?'モデル取得済み · 未読み込み':'モデルを選んでください';}catch{$('model-state').textContent='推論エンジンを確認できません';}}
function setBusy(value){busy=value;for(const id of ['generate','import','load','release'])$(id).disabled=value;$('cancel').hidden=!value;}
for(const action of ['import','load','release'])$(action).addEventListener('click',async e=>{if(!e.isTrusted||busy)return;setBusy(true);$('generation-status').textContent=action==='load'?'モデルを読み込んでいます…':action==='import'?'モデルを選んでください':'解放しています…';try{await invoke({action});$('generation-status').textContent='準備完了';}catch(e){$('generation-status').textContent=message(e);}finally{setBusy(false);refresh();}});
$('cancel').addEventListener('click',e=>{if(e.isTrusted)invoke({action:'cancel'}).catch(()=>{});});
$('generate-form').addEventListener('submit',async e=>{e.preventDefault();if(!e.isTrusted||busy)return;const prompt=$('prompt').value;const refusal=requestAdmission('text',prompt,128);if(refusal!=='accepted'){$('generation-status').textContent='入力内容を確認してください。';$('prompt').focus();return;}setBusy(true);$('generation-status').textContent='生成しています…';try{const result=await invoke({action:'generate',modality:'text',prompt,maxTokens:128});$('result').textContent=result.text;window.awaiLastGeneration={engine:result.engine,outputTokens:result.outputTokens};$('generation-status').textContent='生成しました';}catch(e){$('generation-status').textContent=message(e);}finally{setBusy(false);refresh();}});
refresh();
