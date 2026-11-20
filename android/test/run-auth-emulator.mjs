#!/usr/bin/env node
/** Unattended regression of exact packaged Itonami using production crypto and random test keys.
 * Creates its own AVD. No owner-linked device, auth flag, remote relay, or production auth change.
 */
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {assertDisposableScope} from './emulator-scope.mjs';
import {randomWallet,walletResponse,passkeyResponse} from '../../otehon/shell/test/signers.js';
import {p256} from '../otehon/shell/node_modules/@noble/curves/nist.js';
import {build} from '../otehon/shell/node_modules/esbuild/lib/main.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const options=Object.fromEntries(process.argv.slice(2).map(x=>x.split('=')));
if(Boolean(options['--provider'])!==Boolean(options['--model']))throw Error('provider and model must both be supplied');
if(options['--restart']&&!['abrupt','backgrounded'].includes(options['--restart']))throw Error('invalid-restart-mode');
if(!options['--apk'])throw Error('Usage: node android/test/run-auth-emulator.mjs --apk=/absolute/itonami-arm64.apk [--port=5572]');
const port=Number(options['--port']||5572);if(!Number.isInteger(port)||port<5554||port>5682||port%2)throw Error('invalid-emulator-port');
const serial=`emulator-${port}`,sdk=process.env.ANDROID_HOME||path.join(os.homedir(),'Library/Android/sdk');
const apk=path.resolve(options['--apk']),run=path.join(root,'.agent-output',`qa-${Date.now()}`),avd=path.join(run,'avd');
const name=`Awai_Regression_${path.basename(run).replaceAll('-','_')}`;
const adb=(...args)=>execFileSync(path.join(sdk,'platform-tools/adb'),['-s',serial,...args],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=60000){const end=Date.now()+ms;let err;while(Date.now()<end){try{const result=await fn();if(result)return result;}catch(e){err=e;}await delay(500);}throw Error(`timeout: ${label}: ${err?.message||''}`);}
await access(apk);
// Refuse occupied ports and any pre-existing AVD: never reuse or clear someone else's state.
const devices=execFileSync(path.join(sdk,'platform-tools/adb'),['devices'],{encoding:'utf8'});if(devices.includes(serial))throw Error('emulator-port-occupied');
await mkdir(avd,{recursive:true});await mkdir(path.join(os.homedir(),'.android/avd'),{recursive:true});
await writeFile(path.join(os.homedir(),'.android/avd',name+'.ini'),`avd.ini.encoding=UTF-8\npath=${avd}\ntarget=android-35\n`,{flag:'wx'});
await writeFile(path.join(avd,'config.ini'),`avd.ini.encoding=UTF-8\nabi.type=arm64-v8a\nhw.cpu.arch=arm64\nhw.cpu.ncore=4\nhw.ramSize=3072\nhw.lcd.width=1440\nhw.lcd.height=900\nhw.lcd.density=160\nhw.gpu.enabled=yes\nhw.gpu.mode=swiftshader_indirect\nhw.keyboard=yes\nhw.mainKeys=no\ndisk.dataPartition.size=6442450944\nimage.sysdir.1=${sdk}/system-images/android-35/default/arm64-v8a/\ntag.id=default\nPlayStore.enabled=false\n`);
const marker={schema:'awai.disposable-emulator.v1',serial,name,root:run};await writeFile(path.join(run,'scope.json'),JSON.stringify(marker));
const emulator=spawn(path.join(sdk,'emulator/emulator'),['-avd',name,'-port',String(port),'-no-window','-no-audio','-no-snapshot','-gpu','swiftshader_indirect'],{stdio:['ignore','pipe','pipe']});
let log='';emulator.stdout.on('data',d=>log+=d);emulator.stderr.on('data',d=>log+=d);
const sourceHashes={};for(const file of ['android/test/auth-fixture-entry.js','otehon/shell/src/identity/device.js','otehon/shell/src/identity/link.js'])sourceHashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
const report={sourceHashes,schema:'awai.android.auth-regression.v1',startedAt:new Date().toISOString(),serial,avd:name,apkSha256:createHash('sha256').update(await readFile(apk)).digest('hex'),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),cases:[],boundaries:['software wallet/passkey fixture, not owner authentication','production APK and verifier; test module injected only over scoped emulator CDP','no physical device access','no relay consent or request required']};
let cdp,forward;const forwards=[];
try{
 await until(()=>adb('shell','getprop','sys.boot_completed')==='1','Android boot',180000);
 const scope={serial,name:adb('emu','avd','name').split(/\r?\n/)[0],expectedName:name,qemu:adb('shell','getprop','ro.kernel.qemu')||adb('shell','getprop','ro.boot.qemu'),hardware:adb('shell','getprop','ro.hardware'),marker:JSON.parse(await readFile(path.join(run,'scope.json'))),root:run};report.scope=scope;assertDisposableScope(scope);
 const version=Number(adb('shell','getprop','ro.build.version.sdk'));assert(version>=35);
 // Offline from first launch: a fixture must not call the real relay or a remote inference service.
 adb('shell','svc','wifi','disable');adb('shell','svc','data','disable');
 if(options['--provider'])adb('install',path.resolve(options['--provider']));
 adb('install',apk);adb('shell','am','start','-n','network.itonami.app/.MainActivity');
 async function connect(pkg='network.itonami.app'){
 const pid=await until(()=>adb('shell','pidof',pkg),'WebView process');
 forward=adb('forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`);forwards.push(forward);
 const target=await until(async()=>{const r=await fetch(`http://127.0.0.1:${forward}/json`,{signal:AbortSignal.timeout(4000)});const ts=await r.json();return ts.find(t=>t.type==='page');},'CDP target');
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map();
 ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id){pending.get(r.id)?.(r);pending.delete(r.id)}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method))},30000);pending.set(n,r=>{clearTimeout(timer);r.error?reject(Error(JSON.stringify(r.error))):resolve(r.result)});ws.send(JSON.stringify({id:n,method,params}));});
 const read=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const click=async selector=>{const b=await read(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(!b)throw Error('visible element missing');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...b,button:'left',clickCount:1});};
 return {read,click,call,close:()=>ws.close()};
 }
 cdp=await connect();await until(()=>cdp.read('Boolean(window.__TAURI_INTERNALS__ && document.querySelector("#root")?.innerText.length)'),'application ready');
 assert.equal(await cdp.read('typeof AwaiTestFixture'),'undefined');console.log('production APK has no injected test fixture');
 const compiled=await build({entryPoints:[path.join(root,'android/test/auth-fixture-entry.js')],bundle:true,write:false,format:'iife',globalName:'AwaiTestFixture',platform:'browser',target:'es2022'});
 const source=compiled.outputFiles[0].text;await writeFile(path.join(run,'fixture-source.sha256'),createHash('sha256').update(source).digest('hex'));
 await cdp.read(source+'; true');assert.equal(await cdp.read('AwaiTestFixture.current()'),null);
 const request=await cdp.read('AwaiTestFixture.begin()'),now=Date.now(),wallet=randomWallet(),response=walletResponse(wallet,request,now);
 const check=async(name,responseArg,requestArg=request,time=Date.now())=>{
 const result=await cdp.read(`AwaiTestFixture.accept(${JSON.stringify(requestArg)},${JSON.stringify(responseArg)},${time}).then(()=>({accepted:true}),e=>({accepted:false,error:e.message}))`);
 assert.equal(result.accepted,false,name);assert.equal(await cdp.read('AwaiTestFixture.current()'),null,name+' changed state');console.log('case',report.cases.length+1);report.cases.push({name,passed:true,error:result.error});};
 await check('invalid-signature',{...response,signature:'0x'+'00'.repeat(65)});
 await check('wrong-device',response,{...request,device:request.device+'wrong'});
 await check('expired-proof',response,request,now+31*86400000);
 assert.deepEqual(await cdp.read(`AwaiTestFixture.accept(${JSON.stringify(request)},${JSON.stringify(response)})`),{method:'wallet',verified:true});console.log('case',report.cases.length+1);report.cases.push({name:'valid-wallet-signature',passed:true});
 await cdp.read('AwaiTestFixture.clearSession()');
 await check('passkey-wrong-origin',passkeyResponse(p256.utils.randomSecretKey(),request,Date.now(),{origin:'https://untrusted.invalid'}));
 await check('passkey-no-user-verification',passkeyResponse(p256.utils.randomSecretKey(),request,Date.now(),{flags:1}));
 const passkey=passkeyResponse(p256.utils.randomSecretKey(),request,Date.now());
 assert.deepEqual(await cdp.read(`AwaiTestFixture.accept(${JSON.stringify(request)},${JSON.stringify(passkey)})`),{method:'passkey',verified:true});console.log('case',report.cases.length+1);report.cases.push({name:'valid-passkey-signature-software-authenticator',passed:true});
 await cdp.call('Page.reload');await until(()=>cdp.read('Boolean(document.querySelector("button[data-next]"))'),'actual trust screen');
 await cdp.click('button[data-next]');await until(()=>cdp.read('Boolean(document.querySelector("button[data-finish]"))'),'actual completion screen');await cdp.click('button[data-finish]');
 await until(()=>cdp.read('Boolean(document.querySelector("button[data-dapp]"))'),'authenticated application home');
 console.log('case',report.cases.length+1);report.cases.push({name:'actual-trust-completion-home-clicks',passed:true});
 if(options['--restart']!=='abrupt')await delay(500);if(options['--restart']!=='abrupt')await writeFile(path.join(run,'home.png'),execFileSync(path.join(sdk,'platform-tools/adb'),['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:8*1024*1024}));
 if(options['--restart']==='abrupt'){report.durabilityBoundary='immediate force-stop after observed native-acknowledged Home; no background or flush delay';report.homeObservedAt=new Date().toISOString();}else{adb('shell','input','keyevent','KEYCODE_HOME');await delay(6500);report.durabilityBoundary='backgrounded for 6.5 seconds before process force-stop; not abrupt power-loss qualification';}cdp.close();cdp=null;report.forceStopIssuedAt=new Date().toISOString();adb('shell','am','force-stop','network.itonami.app');adb('shell','am','start','-n','network.itonami.app/.MainActivity');cdp=await connect();
 await until(()=>cdp.read('Boolean(document.querySelector("button[data-dapp]"))'),'restarted home');
 assert.equal(await cdp.read('typeof AwaiTestFixture'),'undefined');await cdp.read(source+'; true');assert.deepEqual(await cdp.read('AwaiTestFixture.current()'),{method:'passkey',verified:true});console.log('case',report.cases.length+1);report.cases.push({name:'process-restart-reverifies-retained-link-and-home',passed:true});
 assert.equal((await cdp.read(`window.__TAURI_INTERNALS__.invoke('awai_setup_state',{action:'read'})`)).complete,true);
 // Actual guest OS reboot, preserving its newly owned userdata; never another AVD.
 const oldBoot=adb('shell','cat','/proc/sys/kernel/random/boot_id');cdp.close();cdp=null;adb('reboot');
 await until(()=>adb('shell','cat','/proc/sys/kernel/random/boot_id')!==oldBoot&&adb('shell','getprop','sys.boot_completed')==='1','OS reboot',180000);
 adb('shell','input','keyevent','KEYCODE_WAKEUP');adb('shell','input','keyevent','KEYCODE_MENU');
 adb('shell','am','start','-n','network.itonami.app/.MainActivity');cdp=await connect();
 await until(()=>cdp.read('Boolean(document.querySelector("button[data-dapp]"))'),'OS reboot application Home');
 assert.equal((await cdp.read(`window.__TAURI_INTERNALS__.invoke('awai_setup_state',{action:'read'})`)).complete,true);
 assert.equal(await cdp.read('typeof AwaiTestFixture'),'undefined');await cdp.read(source+'; true');
 assert.deepEqual(await cdp.read('AwaiTestFixture.current()'),{method:'passkey',verified:true});
 report.cases.push({name:'OS-reboot-relaunch-retains-native-completion-and-verified-account',passed:true});
 await delay(500);await writeFile(path.join(run,'reboot-home.png'),execFileSync(path.join(sdk,'platform-tools/adb'),['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:8*1024*1024}));


 if(options['--provider']||options['--model']){
  if(!options['--provider']||!options['--model'])throw Error('provider and model must both be supplied');
  const provider=path.resolve(options['--provider']),model=path.resolve(options['--model']);
  const pins=JSON.parse(await readFile(path.join(root,'apps/murakumo/pins.json')));
  assert.equal(createHash('sha256').update(await readFile(model)).digest('hex'),pins.model.sha256);
  report.providerSha256=createHash('sha256').update(await readFile(provider)).digest('hex');report.modelSha256=pins.model.sha256;
  adb('push',model,'/data/local/tmp/awai-qa.gguf');
  // Public model fixture only; load still performs the production digest admission.
  // SAF import has separate coverage: this provision step does not claim to exercise it.
  adb('shell','run-as','network.awai.murakumo','mkdir','-p','files/models');
  adb('shell',"run-as network.awai.murakumo sh -c 'cat /data/local/tmp/awai-qa.gguf > files/models/qwen3.gguf'");
  report.modelProvision='public pinned model seeded into disposable app storage; production load digest verified; not SAF-import coverage';
  cdp.close();cdp=null;adb('shell','am','start','-n','network.awai.murakumo/.MainActivity');cdp=await connect('network.awai.murakumo');
  await until(()=>cdp.read('Boolean(document.getElementById("load")) && document.getElementById("model-state").innerText.includes("モデル取得済み")'),'provider UI');await cdp.click('#load');
  await until(()=>cdp.read('document.getElementById("model-state").innerText.includes("読み込み済み")'),'native load',90000);
  cdp.close();cdp=null;adb('shell','am','start','-n','network.itonami.app/.MainActivity');cdp=await connect();
  await until(()=>cdp.read(`Boolean(document.querySelector('button[data-dapp="murakumo"]'))`),'consumer shell');
  const ready=await cdp.read(`window.__TAURI_INTERNALS__.invoke('awai_local_inference',{request:{action:'info'}})`);report.inferenceReadiness=ready;assert.equal(ready.status?.loaded,true,'signed consumer permission and native readiness');
  await cdp.click('button[data-dapp="murakumo"]');await until(()=>cdp.read('Boolean(document.querySelector("#local-inference-prompt"))'),'real Core panel');
  await cdp.click('#local-inference-prompt');await cdp.call('Input.insertText',{text:'Write one short sentence saying hello.'});
  async function nativeButton(id){return until(()=>{
   adb('shell','uiautomator','dump','/sdcard/awai-qa-ui.xml');const xml=adb('shell','cat','/sdcard/awai-qa-ui.xml');
   const node=xml.match(new RegExp('<node[^>]*resource-id="android:id/'+id+'"[^>]*>'))?.[0];
   const b=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);if(!b)return false;
   adb('shell','input','tap',String(Math.round((+b[1]+ +b[3])/2)),String(Math.round((+b[2]+ +b[4])/2)));return true;
  },'native '+id);}
  await cdp.click('.local-inference-generation button[type="submit"]');await nativeButton('button2');
  await until(()=>cdp.read('!document.querySelector(".local-inference-generation button[type=submit]").disabled'),'consumer denial');
  assert.equal(await cdp.read('document.querySelector(".local-inference-generation output").innerText'),'');
  report.cases.push({name:'authenticated-Core-UI-native-confirmation-denial',passed:true});
  await cdp.click('.local-inference-generation button[type="submit"]');await nativeButton('button1');
  const generated=await until(()=>cdp.read('document.querySelector(".local-inference-generation output").innerText'),'actual llama.cpp UI output',120000);
  report.cases.push({name:'authenticated-Core-UI-actual-local-llama-generation',passed:true,outputBytes:Buffer.byteLength(generated)});
  await delay(500);await writeFile(path.join(run,'inference.png'),execFileSync(path.join(sdk,'platform-tools/adb'),['-s',serial,'exec-out','screencap','-p'],{timeout:30000,maxBuffer:8*1024*1024}));
  cdp.close();cdp=null;adb('shell','am','start','-n','network.awai.murakumo/.MainActivity');cdp=await connect('network.awai.murakumo');await cdp.click('#release');
  await until(()=>cdp.read('document.getElementById("model-state").innerText.includes("未読み込み")'),'model release');
  report.cases.push({name:'provider-UI-native-model-release',passed:true});
 }
 // Return from the provider before checking the consumer's identity gate.
 cdp.close();cdp=null;adb('shell','am','start','-n','network.itonami.app/.MainActivity');cdp=await connect();
 await until(()=>cdp.read('Boolean(document.querySelector("button[data-dapp]"))'),'consumer before sign-out');
 // A completion marker alone must never bypass account authentication.
 await cdp.read(source+'; true');await cdp.read('AwaiTestFixture.clearSession()');await cdp.call('Page.reload');
 await until(()=>cdp.read('Boolean(document.querySelector("#local-start")) && !document.querySelector("button[data-dapp]")'),'identity gate with completed setup');
 report.cases.push({name:'completed-setup-never-authenticates-an-unlinked-account',passed:true});
 report.status='passed';
}catch(e){report.status='failed';report.error=e.stack;if(cdp)try{report.failurePage=await cdp.read('({text:document.body.innerText,setup:localStorage.getItem("otehon.setup.v1"),title:document.title})')}catch{}process.exitCode=1;}finally{
 cdp?.close();for(const ownForward of forwards)try{adb('forward','--remove',`tcp:${ownForward}`)}catch{}
 // Only this runner's own newly started emulator is stopped. All evidence/state remains for diagnosis.
 emulator.kill('SIGTERM');await writeFile(path.join(run,'emulator.log'),log);report.endedAt=new Date().toISOString();await writeFile(path.join(run,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:path.join(run,'report.json'),cases:report.cases,error:report.error},null,2));
}
