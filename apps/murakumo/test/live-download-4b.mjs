// AWAI-3307 on an emulator this run owns: Murakumo downloads a pinned catalog model from Hugging Face
// through the canonical broker (consent dialog per download, declared CDN redirects, streamed SHA-256,
// host sink) and admits it. Taps are real input on the WebView's consent dialog.
// usage: node test/live-download-4b.mjs --serial=emulator-NNNN --apk=/abs/app.apk --out=/abs/dir
import {execFileSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';
const opt=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
const adbPath=path.join(process.env.HOME,'Library/Android/sdk/platform-tools/adb');
const adb=(...a)=>execFileSync(adbPath,['-s',opt.serial,...a],{encoding:'utf8',maxBuffer:1<<26});
const PKG='network.awai.murakumo',ID='qwen3-0.6b-q8_0',BYTES=639446688;const results=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,ok,detail)=>{results.push({check:name,passed:!!ok,detail:ok?undefined:detail});console.log(`${ok?'PASS':'FAIL'} ${name}${ok||detail===undefined?'':'  '+JSON.stringify(detail)}`);return ok;};
fs.mkdirSync(opt.out,{recursive:true});
// A starved emulator raises "isn't responding". Press "Wait" (never "Close app") and record it.
const anrWaits=[];
function rawUi(){adb('shell','uiautomator','dump','/sdcard/mk-ui.xml');const x=adb('shell','cat','/sdcard/mk-ui.xml');return [...x.matchAll(/<node [^>]*>/g)].map(m=>({text:/text="([^"]*)"/.exec(m[0])?.[1]??'',desc:/content-desc="([^"]*)"/.exec(m[0])?.[1]??'',bounds:/bounds="([^"]*)"/.exec(m[0])?.[1]??''}));}
function ui(){for(let i=0;i<5;i++){const n=rawUi();const anr=n.find(x=>/isn.t responding/.test(x.text));const w=n.find(x=>x.text==='Wait');if(!(anr&&w))return n;
  const [x1,y1,x2,y2]=w.bounds.match(/\d+/g).map(Number);adb('shell','input','tap',String((x1+x2)>>1),String((y1+y2)>>1));anrWaits.push({at:new Date().toISOString(),dialog:anr.text});execFileSync('sleep',['2']);}return rawUi();}
async function tapText(text,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const n=ui().find(n=>(n.text===text||n.desc===text)&&n.bounds!=='[0,0][0,0]');if(n){const [x1,y1,x2,y2]=n.bounds.match(/\d+/g).map(Number);adb('shell','input','tap',String((x1+x2)>>1),String((y1+y2)>>1));return true;}await sleep(800);}return false;}
async function cdp(){const pid=adb('shell','pidof',PKG).trim();adb('forward','tcp:9334',`localabstract:webview_devtools_remote_${pid}`);
 let pages=[];for(let i=0;i<20&&!pages.length;i++){try{pages=(await (await fetch('http://127.0.0.1:9334/json')).json()).filter(p=>p.type==='page');}catch{}if(!pages.length)await sleep(1000);}
 const ws=new WebSocket(pages[0].webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pend=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);pend.get(m.id)?.(m)};
 const ev=expr=>new Promise(r=>{const n=++id;pend.set(n,m=>r(m.result?.result?.value));ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression:expr,awaitPromise:true,returnByValue:true}}))});return {ev,close:()=>ws.close()};}
const files=()=>adb('shell',`run-as ${PKG} ls -l files/models 2>/dev/null; true`).split('\n').filter(l=>l.includes('.gguf')||l.includes('.download')).map(l=>l.trim().split(/\s+/)).map(p=>({name:p.at(-1),size:Number(p[4])}));
async function startDownload(c){await c.ev(`document.querySelector('.model-row[data-model="${ID}"] button').scrollIntoView({block:'center'})`);await sleep(1200);
 const label=await c.ev(`document.querySelector('.model-row[data-model="${ID}"] button').textContent`);return tapText(label);}
(async()=>{
 const ev={schema:'awai.murakumo.download-4b-evidence/1',issue:'AWAI-3307',serial:opt.serial,apkSha256:crypto.createHash('sha256').update(fs.readFileSync(opt.apk)).digest('hex')};
 adb('install','-r',opt.apk);adb('shell','am','force-stop',PKG);adb('shell','pm','clear',PKG);
 // wry 0.57 panics when the WebView-version reply misses its 10 s main-pipe deadline (a loaded host). Relaunch, and record each such crash.
 ev.startupCrashes=[];const launch=async()=>{for(let i=0;i<4;i++){adb('logcat','-c');adb('shell','am','start','-W','-n',`${PKG}/.MainActivity`);await sleep(15000);
  const log=adb('logcat','-d');if(adb('shell',`pidof ${PKG}; true`).trim()&&!/RustPanic/.test(log))return;ev.startupCrashes.push((/RustPanic: (.*)/.exec(log)?.[1]??'process died').trim());}throw Error('the app did not start');};
 await launch();
 let c=await cdp();await sleep(1500);
 check('the app holds no model yet',files().length===0,files());
 const csp=await c.ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content??null`);ev.cspMeta=csp;
 // 1. Deny: nothing is fetched or written.
 check('Download is offered for the model that fits',await startDownload(c));
 const dialog=ui().map(n=>n.text).join('\n');check('the canonical consent dialog shows the artifact SHA-256 and budget',dialog.includes('9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031')&&dialog.includes(`${BYTES} bytes`),dialog.slice(0,400));
 await sleep(900);check('the owner taps Deny',await tapText('Deny'));await sleep(1500);
 const denied=await c.ev(`document.getElementById('generation-status').textContent`);
 check('denied: nothing is written and the status says nothing was sent',files().length===0&&/Nothing was sent|何も送っていません/.test(denied),{denied,files:files()});
 // 2. Stop partway: the partial file is deleted and nothing is imported.
 await startDownload(c);await sleep(900);check('the owner taps Allow once (download to be stopped)',await tapText('Allow once'));
 let partial=0;for(let i=0;i<60&&partial<32*1024*1024;i++){await sleep(1000);partial=files().find(f=>f.name.endsWith('.download'))?.size??0;}
 check('bytes stream into the host-named .download file',partial>=32*1024*1024,partial);
 check('the owner taps Stop',await tapText('Stop'));await sleep(3000);
 const stopped=await c.ev(`document.getElementById('generation-status').textContent`);
 check('stopped: the partial file is deleted and nothing is imported',files().length===0&&/stopped|止め/.test(stopped),{stopped,files:files()});
 // 3. Allow: the whole pinned file arrives through the CDN redirect, matches its SHA-256 and is admitted.
 await startDownload(c);await sleep(900);check('the owner taps Allow once',await tapText('Allow once'));
 const t0=Date.now();let st=null;for(let i=0;i<900;i++){await sleep(2000);st=await c.ev(`window.__TAURI_INTERNALS__.invoke('inference_operation',{request:{action:'status'}}).then(s=>JSON.stringify({imported:s.models.find(m=>m.id==='${ID}').imported,downloading:s.downloading}))`);if(st&&JSON.parse(st).imported)break;}
 ev.downloadSeconds=Math.round((Date.now()-t0)/1000);
 const done=await c.ev(`document.getElementById('generation-status').textContent`);
 check('the model downloads, its SHA-256 matches and it is admitted',JSON.parse(st??'{}').imported===true&&/matched|一致したため取り込み/.test(done),{st,done});
 check('exactly the model file remains, at its catalog size',JSON.stringify(files())===JSON.stringify([{name:`${ID}.gguf`,size:BYTES}]),files());
 // 4. The downloaded model loads and generates.
 await c.ev(`location.reload()`);await sleep(3000);c.close();c=await cdp();await sleep(1500);
 await c.ev(`document.querySelector('.model-row[data-model="${ID}"] button').scrollIntoView({block:'center'})`);await sleep(1000);
 check('Load is tapped',await tapText('Load'));let loaded=null;for(let i=0;i<60&&loaded!==ID;i++){await sleep(1000);loaded=await c.ev(`window.__TAURI_INTERNALS__.invoke('inference_operation',{request:{action:'status'}}).then(s=>s.loadedModel)`);}
 check('the downloaded model loads',loaded===ID,loaded);
 const gen=await c.ev(`window.__TAURI_INTERNALS__.invoke('inference_operation',{request:{action:'generate',modality:'text',prompt:'Say hello in one short sentence.',maxTokens:32}}).then(r=>({len:r.text.length,tokens:r.outputTokens}),e=>String(e))`);
 ev.generation=gen;check('it generates text',gen?.len>0,gen);
 fs.writeFileSync(path.join(opt.out,'after.png'),execFileSync(adbPath,['-s',opt.serial,'exec-out','screencap','-p'],{maxBuffer:1<<26}));c.close();
 ev.anrWaits=anrWaits;ev.checks=results;ev.passed=results.filter(r=>r.passed).length;ev.total=results.length;fs.writeFileSync(path.join(opt.out,'evidence.json'),JSON.stringify(ev,null,2)+'\n');
 console.log(`${ev.passed} of ${ev.total} checks`);process.exit(ev.passed===ev.total?0:1);
})().catch(e=>{console.error(e);process.exit(2);});
