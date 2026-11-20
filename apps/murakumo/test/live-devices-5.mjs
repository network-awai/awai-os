// AWAI-3377 on an emulator this run owns: Murakumo's All devices list reads benjamin's signed usage report
// over the tailnet HTTPS route, one canonical consent per read. Taps are real input.
// usage: node test/live-devices-5.mjs --serial=emulator-NNNN --apk=/abs/app.apk --out=/abs/dir --host=node@benjamin --remote=DIR
//   DIR on the host holds reporter.pid / reporter.log (see node/README.md). The emulator must resolve MagicDNS
//   (for example -dns-server 100.100.100.100).
import {execFileSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';
const opt=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
const adbPath=path.join(process.env.HOME,'Library/Android/sdk/platform-tools/adb');
const adb=(...a)=>execFileSync(adbPath,['-s',opt.serial,...a],{encoding:'utf8',maxBuffer:1<<26});
const remote=cmd=>execFileSync('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',opt.host,`cd ${opt.remote} && ${cmd}`],{encoding:'utf8'});
const PKG='network.awai.murakumo',DEVICE='benjamin',ORIGIN='https://benjamin.tail110d8b.ts.net:8443';const results=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,ok,detail)=>{results.push({check:name,passed:!!ok,detail:ok?undefined:detail});console.log(`${ok?'PASS':'FAIL'} ${name}${ok||detail===undefined?'':'  '+JSON.stringify(detail)}`);return ok;};
fs.mkdirSync(opt.out,{recursive:true});
const anrWaits=[];
function rawUi(){adb('shell','uiautomator','dump','/sdcard/mk-ui.xml');const x=adb('shell','cat','/sdcard/mk-ui.xml');return [...x.matchAll(/<node [^>]*>/g)].map(m=>({text:/text="([^"]*)"/.exec(m[0])?.[1]??'',desc:/content-desc="([^"]*)"/.exec(m[0])?.[1]??'',bounds:/bounds="([^"]*)"/.exec(m[0])?.[1]??''}));}
function ui(){for(let i=0;i<5;i++){let n;try{n=rawUi();}catch{execFileSync('sleep',['2']);continue;}const anr=n.find(x=>/isn.t responding/.test(x.text));const w=n.find(x=>x.text==='Wait');if(!(anr&&w))return n;
  const [x1,y1,x2,y2]=w.bounds.match(/\d+/g).map(Number);adb('shell','input','tap',String((x1+x2)>>1),String((y1+y2)>>1));anrWaits.push({at:new Date().toISOString(),dialog:anr.text});execFileSync('sleep',['2']);}return rawUi();}
async function tapText(text,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const n=ui().find(n=>(n.text===text||n.desc===text)&&n.bounds!=='[0,0][0,0]');if(n){const [x1,y1,x2,y2]=n.bounds.match(/\d+/g).map(Number);adb('shell','input','tap',String((x1+x2)>>1),String((y1+y2)>>1));return true;}await sleep(800);}return false;}
async function cdp(){const pid=adb('shell',`pidof ${PKG}; true`).trim();adb('forward','tcp:9335',`localabstract:webview_devtools_remote_${pid}`);
 let pages=[];for(let i=0;i<30&&!pages.length;i++){try{pages=(await (await fetch('http://127.0.0.1:9335/json')).json()).filter(p=>p.type==='page');}catch{}if(!pages.length)await sleep(1000);}
 const ws=new WebSocket(pages[0].webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pend=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);pend.get(m.id)?.(m)};
 const ev=expr=>new Promise(r=>{const n=++id;pend.set(n,m=>r(m.result?.result?.value));ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression:expr,awaitPromise:true,returnByValue:true}}))});return {ev,close:()=>ws.close()};}
const card=c=>c.ev(`(()=>{const li=document.querySelector('.device-card[data-device="${DEVICE}"]');return li?{when:li.querySelector('[data-state]').dataset.state,text:li.innerText}:null})()`);
const requests=()=>remote('grep -c "GET /v1/murakumo/usage" reporter.log || true').trim()|0;
async function read(c,answer){await c.ev(`document.getElementById('read-reports').scrollIntoView({block:'center'})`);await sleep(1000);
 const label=await c.ev(`document.getElementById('read-reports').textContent`);if(!await tapText(label))return {tapped:false};
 await sleep(1500);const dialog=ui().map(n=>n.text).join('\n');await sleep(800);const answered=await tapText(answer);
 for(let i=0;i<40;i++){await sleep(1000);if(!await c.ev(`document.getElementById('read-reports').disabled`))break;}return {tapped:true,dialog,answered};}
(async()=>{
 const ev={schema:'awai.murakumo.devices-5-evidence/1',issue:'AWAI-3377',serial:opt.serial,apkSha256:crypto.createHash('sha256').update(fs.readFileSync(opt.apk)).digest('hex'),device:DEVICE,origin:ORIGIN};
 adb('install','-r',opt.apk);adb('shell','am','force-stop',PKG);adb('shell','pm','clear',PKG);
 ev.startupCrashes=[];for(let i=0;i<4;i++){adb('logcat','-c');adb('shell','am','start','-W','-n',`${PKG}/.MainActivity`);await sleep(15000);
  const log=adb('logcat','-d');if(adb('shell',`pidof ${PKG}; true`).trim()&&!/RustPanic/.test(log))break;ev.startupCrashes.push((/RustPanic: (.*)/.exec(log)?.[1]??'process died').trim());}
 let c=await cdp();await sleep(2000);
 ev.cspMeta=await c.ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content??null`);
 ev.ed25519=await c.ev(`crypto.subtle.importKey('raw',new Uint8Array(32),{name:'Ed25519'},false,['verify']).then(()=>'supported',e=>String(e))`);
 let k=await card(c);check('the list shows benjamin with no report read yet',k?.when==='none',k);
 // 1. Deny: no request reaches the reporter.
 let before=requests();let r=await read(c,'Deny');
 check('Read reports opens the canonical consent dialog for benjamin’s usage endpoint',r.tapped&&r.dialog.includes('benjamin.tail110d8b.ts.net:8443')&&r.dialog.includes('/v1/murakumo/usage'),r.dialog?.slice(0,500));
 check('the owner taps Deny',r.answered);await sleep(3000);
 k=await card(c);check('denied: no request reached the reporter and the card says nothing was sent',requests()===before&&/Nothing was sent|何も送っていません/.test(k?.text)&&k?.when==='none',{before,after:requests(),k});
 // 2. Allow: the signed report arrives, verifies against the pinned key and fills the card.
 before=requests();const direct=JSON.parse(remote('curl -s -m 5 http://127.0.0.1:18790/v1/murakumo/usage'));const directUsage=JSON.parse(direct.payload);
 r=await read(c,'Allow once');check('the owner taps Allow once',r.answered);await sleep(2000);
 k=await card(c);ev.allowedCard=k?.text;
 check('allowed: exactly one request reached the reporter',requests()===before+2,{before,after:requests(),note:'one direct curl plus one read'});
 check('the card is fresh, from a report that verified against the pinned key',k?.when==='fresh',k);
 check('it names the model benjamin serves and its state',/Qwen3 · 0\.6B · (idle|generating)/.test(k?.text??''),k?.text);
 check('it shows benjamin’s RAM total, CPU, GPU and disk',/16 GiB/.test(k?.text??'')&&/CPU\n\d+ %/.test(k?.text??'')&&/GPU\n\d+ %/.test(k?.text??'')&&/GiB free of|GiB 空き/.test(k?.text??''),k?.text);
 ev.directLoaded=directUsage.loaded?.model;ev.directRamTotal=directUsage.ram.total;
 // 3. The reporter stops: the read fails, the last report stays with its age, then goes stale and shows no values.
 remote('kill $(cat reporter.pid); sleep 1; true');before=requests();
 r=await read(c,'Allow once');await sleep(2000);k=await card(c);
 check('reporter stopped: the card says the report did not arrive and keeps the last report’s age',/did not arrive|届きませんでした/.test(k?.text??''),k?.text);
 const waitMs=125000;await sleep(waitMs);await c.ev(`document.getElementById('read-reports').scrollIntoView({block:'center'})`);await sleep(6000);
 k=await card(c);ev.staleCard=k?.text;
 check('after 2 minutes the last report is stale and its values show as unknown',k?.when==='stale'&&!/\d+ %/.test(k?.text??'')&&/Unknown|不明/.test(k?.text??''),k?.text);
 fs.writeFileSync(path.join(opt.out,'after.png'),execFileSync(adbPath,['-s',opt.serial,'exec-out','screencap','-p'],{maxBuffer:1<<26}));
 remote('nohup /opt/homebrew/bin/nbb murakumo/node/usage-reporter.cljs serve root 18790 >> reporter.log 2>&1 & echo $! > reporter.pid');
 c.close();ev.anrWaits=anrWaits;ev.checks=results;ev.passed=results.filter(r=>r.passed).length;ev.total=results.length;
 fs.writeFileSync(path.join(opt.out,'evidence.json'),JSON.stringify(ev,null,2)+'\n');console.log(`${ev.passed} of ${ev.total} checks`);process.exit(ev.passed===ev.total?0:1);
})().catch(e=>{console.error(e);process.exit(2);});
