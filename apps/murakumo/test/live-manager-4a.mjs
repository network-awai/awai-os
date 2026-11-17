// AWAI-3203 stage 4a on an emulator this run owns: the Murakumo model manager with the real APK.
// Drives the WebView through Chrome DevTools (debug build) and the Android document picker through
// UI Automator. Writes evidence with counts and hashes only; never the model file or a prompt body.
// usage: node test/live-manager-4a.mjs --serial=emulator-NNNN --apk=/abs/app.apk --model=/abs/Qwen3-0.6B-Q8_0.gguf --out=/abs/dir
import {execFileSync,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';
const opt=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
const adbPath=path.join(process.env.HOME,'Library/Android/sdk/platform-tools/adb');
const adb=(...a)=>execFileSync(adbPath,['-s',opt.serial,...a],{encoding:'utf8',maxBuffer:1<<26});
const PKG='network.awai.murakumo';const results=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,ok,detail)=>{results.push({check:name,passed:!!ok,detail:ok?undefined:detail});console.log(`${ok?'PASS':'FAIL'} ${name}${ok||detail===undefined?'':'  '+JSON.stringify(detail)}`);return ok;};
fs.mkdirSync(opt.out,{recursive:true});

function ui(){adb('shell','uiautomator','dump','/sdcard/mk-ui.xml');const x=adb('shell','cat','/sdcard/mk-ui.xml');return [...x.matchAll(/<node [^>]*>/g)].map(m=>({text:/text="([^"]*)"/.exec(m[0])?.[1]??'',desc:/content-desc="([^"]*)"/.exec(m[0])?.[1]??'',bounds:/bounds="([^"]*)"/.exec(m[0])?.[1]??''}));}
// In the system picker: if the file is not in Recent, open the drawer and choose Downloads.
async function pickFile(name,timeout=60000){const end=Date.now()+timeout;let opened=false;while(Date.now()<end){const nodes=ui();const n=nodes.find(n=>n.text===name);if(n){const [x1,y1,x2,y2]=n.bounds.match(/\d+/g).map(Number);adb('shell','input','tap',String((x1+x2)>>1),String((y1+y2)>>1));return true;}
 if(!opened){const menu=nodes.find(n=>n.desc==='Show roots'||n.desc==='Open navigation drawer');if(menu){const [x1,y1,x2,y2]=menu.bounds.match(/\d+/g).map(Number);adb('shell','input','tap',String((x1+x2)>>1),String((y1+y2)>>1));await sleep(1500);if(await tapText('Downloads',5000))opened=true;}}
 await sleep(1500);}return false;}
async function tapText(text,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const n=ui().find(n=>(n.text===text||n.desc===text)&&n.bounds!=='[0,0][0,0]');if(n){const [x1,y1,x2,y2]=n.bounds.match(/\d+/g).map(Number);adb('shell','input','tap',String((x1+x2)>>1),String((y1+y2)>>1));return true;}await sleep(1000);}return false;}

async function cdp(){
 const pid=adb('shell','pidof',PKG).trim();if(!pid)throw Error('app not running');
 adb('forward','tcp:9333',`localabstract:webview_devtools_remote_${pid}`);
 let pages=[];for(let i=0;i<20&&!pages.length;i++){try{pages=(await (await fetch('http://127.0.0.1:9333/json')).json()).filter(p=>p.type==='page');}catch{}if(!pages.length)await sleep(1000);}
 const ws=new WebSocket(pages[0].webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
 const call=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async(expr)=>{const r=await call('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result?.result?.value;};
 return {evaluate,close:()=>ws.close()};
}
const rows=`[...document.querySelectorAll('.model-row')].map(r=>({id:r.dataset.model,name:r.querySelector('.name').textContent,detail:r.querySelector('.detail').textContent,fit:r.querySelector('.badge').className.replace('badge ',''),action:r.querySelector('button').textContent,disabled:r.querySelector('button').disabled}))`;
(async()=>{
 const ev={schema:'awai.murakumo.manager-4a-evidence/1',issue:'AWAI-3203',serial:opt.serial,apkSha256:crypto.createHash('sha256').update(fs.readFileSync(opt.apk)).digest('hex')};
 adb('install','-r',opt.apk);adb('shell','am','force-stop',PKG);adb('shell','pm','clear',PKG);
 adb('shell','am','start','-W','-n',`${PKG}/.MainActivity`);await sleep(4000);
 let c=await cdp();await sleep(2000);
 let r=await c.evaluate(rows);
 check('the catalog shows six pinned models',r?.length===6,r);
 const usage=await c.evaluate(`window.__TAURI_INTERNALS__.invoke('inference_operation',{request:{action:'usage'}})`);
 ev.usage={ramTotal:usage.ram.total,cpu:usage['cpu-percent'],gpu:usage['gpu-percent'],diskTotal:usage.disk.total};
 check('the usage report is a valid device-usage.v1 snapshot',JSON.stringify(await c.evaluate(`window.AwaiInferenceManager.usageProblems(${JSON.stringify(usage)})`))==='[]');
 check('device-wide CPU and GPU are unknown, not 0',usage['cpu-percent']===null&&usage['gpu-percent']===null,usage);
 const rec=await c.evaluate(`document.getElementById('recommendation').textContent`);ev.recommendation=rec;
 check('a recommendation is shown for this RAM',/Qwen3 · 0\.6B/.test(rec),rec);
 check('the badges follow the shared fit (0.6B fits, 8B does not)',r[0].fit!=='no-fit'&&r.find(x=>x.id==='qwen3-8b-q4_k_m')?.fit==='no-fit',r.map(x=>x.fit));
 check('a model that does not fit cannot be loaded',r.find(x=>x.id==='qwen3-8b-q4_k_m')?.disabled===true);
 // Wrong file for 0.6B: refused by size/digest.
 fs.writeFileSync(path.join(opt.out,'wrong.gguf'),'not a model');adb('push',path.join(opt.out,'wrong.gguf'),'/sdcard/Download/wrong.gguf');
 adb('shell','am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file:///sdcard/Download/wrong.gguf');
 const importWrong=c.evaluate(`window.__TAURI_INTERNALS__.invoke('inference_operation',{request:{action:'import',model:'qwen3-0.6b-q8_0'}}).then(()=>'imported',e=>String(e))`);
 await sleep(3000);check('the wrong file is picked in the system picker',await pickFile('wrong.gguf'));
 const wrong=await importWrong;check('a wrong file is refused for the model',wrong==='model-import-rejected',wrong);
 // Real import through the picker.
 adb('push',opt.model,'/sdcard/Download/Qwen3-0.6B-Q8_0.gguf');adb('shell','am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file:///sdcard/Download/Qwen3-0.6B-Q8_0.gguf');
 const importReal=c.evaluate(`window.__TAURI_INTERNALS__.invoke('inference_operation',{request:{action:'import',model:'qwen3-0.6b-q8_0'}}).then(s=>JSON.stringify(s.models.find(m=>m.id==='qwen3-0.6b-q8_0')),e=>String(e))`);
 await sleep(3000);check('the real file is picked in the system picker',await pickFile('Qwen3-0.6B-Q8_0.gguf'));
 const imported=await importReal;check('the real file imports after SHA-256 admission',imported.includes('"imported":true'),imported);
 await c.evaluate(`location.reload()`);await sleep(3000);c.close();c=await cdp();await sleep(2000);
 r=await c.evaluate(rows);check('the row now offers Load',r[0].action===await c.evaluate(`({ja:'読み込む',en:'Load'})[document.documentElement.lang]`),r[0]);
 const loadLabel=r[0].action;await c.evaluate(`document.querySelector('.model-row[data-model="qwen3-0.6b-q8_0"] button').scrollIntoView({block:'center'})`);await sleep(1500);check('the Load button is tapped in the WebView',await tapText(loadLabel,20000));
 let loaded=null;for(let i=0;i<60&&loaded!=='qwen3-0.6b-q8_0';i++){await sleep(1000);loaded=await c.evaluate(`window.__TAURI_INTERNALS__.invoke('inference_operation',{request:{action:'status'}}).then(s=>s.loadedModel)`);}
 check('the model loads',loaded==='qwen3-0.6b-q8_0',loaded);
 await sleep(6000);
 const card=await c.evaluate(`({model:document.getElementById('loaded-model').textContent,detail:document.getElementById('loaded-detail').textContent,meters:[...document.querySelectorAll('.meter-row')].map(m=>m.textContent),action:document.querySelector('.model-row button').textContent,release:!document.getElementById('release').disabled})`);
 ev.card=card;check('the device panel shows the loaded model, context and meters',card.model==='Qwen3 · 0.6B'&&/2048/.test(card.detail)&&card.meters.length===4&&card.release,card);
 const gen=await c.evaluate(`window.__TAURI_INTERNALS__.invoke('inference_operation',{request:{action:'generate',modality:'text',prompt:'Say hello in one short sentence.',maxTokens:32}}).then(r=>({len:r.text.length,tokens:r.outputTokens}),e=>String(e))`);
 ev.generation=gen;check('the loaded model generates text',gen?.len>0,gen);
 const rel=await c.evaluate(`window.__TAURI_INTERNALS__.invoke('inference_operation',{request:{action:'release'}}).then(s=>s.loaded,e=>String(e))`);
 check('release unloads it',rel===false,rel);
 adb('exec-out','screencap','-p');fs.writeFileSync(path.join(opt.out,'after.png'),execFileSync(adbPath,['-s',opt.serial,'exec-out','screencap','-p'],{maxBuffer:1<<26}));
 c.close();adb('shell','rm','-f','/sdcard/Download/wrong.gguf','/sdcard/Download/Qwen3-0.6B-Q8_0.gguf');
 ev.checks=results;ev.passed=results.filter(x=>x.passed).length;ev.total=results.length;
 fs.writeFileSync(path.join(opt.out,'evidence.json'),JSON.stringify(ev,null,2)+'\n');console.log(`${ev.passed} of ${ev.total} checks`);process.exit(ev.passed===ev.total?0:1);
})().catch(e=>{console.error(e);process.exit(2);});
