// Forced-Doze fixture, not natural overnight idle or a product-granted exemption.
import {chromium,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const run=promisify(execFile),repo=fileURLToPath(new URL('../../../',import.meta.url));
const [serial,ip,cdp,identity,store,snapshot,car]=process.argv.slice(2);
assert(serial&&/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)&&/^http:\/\/127\.0\.0\.1:\d+$/.test(cdp)&&car,'device-doze-test <serial> <IPv4> <own-CDP> <identity> <store> <snapshot> <CAR>');
const pkg='network.itonami.yataverse.preview',output=resolve(repo,'.agent-output',`apk-doze-${Date.now()}`);await mkdir(output,{recursive:true});
const adb=(...args)=>run('adb',['-s',serial,...args],{timeout:30000,maxBuffer:1048576});
const cli=async(...args)=>JSON.parse((await run(resolve(repo,'packages/awai-peer/target/debug/awai-peer'),args,{timeout:45000,maxBuffer:1048576})).stdout);
const deep=async()=>(await adb('shell','dumpsys','deviceidle','get','deep')).stdout.trim();
const baseline={idle:(await adb('shell','dumpsys','deviceidle')).stdout,battery:(await adb('shell','dumpsys','battery')).stdout,whitelist:(await adb('shell','dumpsys','deviceidle','whitelist')).stdout,tempWhitelist:(await adb('shell','dumpsys','deviceidle','tempwhitelist')).stdout};
assert.equal(await deep(),'ACTIVE','Do not disturb an existing idle experiment');
assert(baseline.idle.includes('mForceIdle=false')&&!baseline.battery.includes('UPDATES STOPPED'),'Do not replace another battery/idle fixture');
assert(!baseline.whitelist.includes(pkg),'Default-mode control requires a non-exempt preview');
assert(!baseline.tempWhitelist.includes(pkg),'Do not replace an existing temporary exemption');
await writeFile(output+'/baseline.json',JSON.stringify(baseline,null,2)+'\n');
let browser,started=false,mutated=false,temp=false,receiver,sessionId;
const result={schema:'awai.apk.forced-doze.v1',checkedAt:new Date().toISOString(),sourceRevision:(await run('git',['rev-parse','HEAD'],{cwd:repo})).stdout.trim(),package:pkg,snapshot,forcedIdle:true,adbUsbAttached:true,naturalOvernightQualified:false,networkSettingsChanged:false,phases:[],cleanup:{}};
async function checkpoint(){await writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n');}
async function settledIdle(){
 await adb('shell','dumpsys','deviceidle','force-idle','deep');
 await new Promise(r=>setTimeout(r,15000));
 assert.equal(await deep(),'IDLE');
 const power=(await adb('shell','dumpsys power | grep -E "mDeviceIdleMode=|mWakefulness=|mIsPowered="')).stdout;
 const policy=(await adb('shell','dumpsys netpolicy | head -8')).stdout;
 assert(power.includes('mDeviceIdleMode=true'),'PowerManager must observe deep idle');
 assert(policy.includes('Device idle: true'),'Network policy must observe idle before transfer');
 return {settledMs:15000,power,policy};
}
async function cancelNative(){
 if(!sessionId)return;
 if(!browser)browser=await chromium.connectOverCDP(cdp);
 const page=browser.contexts()[0].pages().find(p=>p.url()==='http://tauri.localhost/');assert(page);
 // Cancellation never grants network authority and works without unlocking.
 await page.evaluate(id=>window.__TAURI__.core.invoke('peer_stop',{sessionId:id}),sessionId);
 result.nativeCancellation=true;started=false;
}
async function roundTrip(label){
 const before=await deep(),start=Date.now();
 try{
  const push=await cli('sync-push',resolve(identity),resolve(store),result.address,snapshot);
  const query=await cli('pin-query',resolve(identity),resolve(store),result.address,snapshot);
  const pulled=await cli('sync-pull',resolve(identity),output+'/'+label,result.address,snapshot,output+'/'+label+'.car');
  assert.equal(push.verified.provider,receiver);assert.equal(query.verified.blocks,8);assert(pulled.verified);
  const expected=await readFile(resolve(car)),actual=await readFile(output+'/'+label+'.car');assert.deepEqual(actual,expected);
  result.phases.push({label,before,after:await deep(),elapsedMs:Date.now()-start,success:true,blocks:8,bytes:actual.length,carSha256:createHash('sha256').update(actual).digest('hex')});
 }catch(error){result.phases.push({label,before,after:await deep(),elapsedMs:Date.now()-start,success:false,error:String(error.stderr||error.message).slice(0,1500)});}
 await checkpoint();return result.phases.at(-1);
}
try{
 const sender=await cli('identity',resolve(identity));browser=await chromium.connectOverCDP(cdp);
 const page=browser.contexts()[0].pages().find(p=>p.url()==='http://tauri.localhost/');assert(page);
 receiver=await page.locator('#awai-local-peer').textContent();assert(/^12D3KooW/.test(receiver));result.receiver=receiver;result.sender=sender.peerId;result.canonicalRuntime=await page.evaluate(async()=>await(await fetch('./dapp.json')).json()).then(d=>d.canonicalRuntime);
 await page.locator('#awai-snapshot').fill(snapshot);
 if(!await page.locator('#awai-source-peer').isVisible())await page.locator('#awai-transfer details summary').click();
 await page.locator('#awai-source-peer').fill(sender.peerId);await page.locator('#awai-listen').fill(`/ip4/${ip}/tcp/40217`);await page.locator('#awai-minutes').fill('10');
 const ime=(await adb('shell','dumpsys input_method | grep mInputShown')).stdout;if(ime.includes('mInputShown=true')){await adb('shell','input','keyevent','KEYCODE_BACK');await page.waitForFunction(()=>!window.visualViewport?.offsetTop);}
 await page.locator('#awai-read-back').check();await page.locator('button[value=receive]').click();
 const dialog=page.getByRole('dialog');for(const text of [snapshot,sender.peerId,'"allow-read-back":true'])await expect(dialog).toContainText(text);
 const allow=page.getByRole('button',{name:'Allow once',exact:true});await expect(allow).toBeEnabled();await allow.click();await expect(page.locator('#awai-session-status')).toContainText(/受信中|Receiving/);started=true;
 const sessions=await page.evaluate(()=>window.__TAURI__.core.invoke('peer_sessions'));sessionId=sessions.find(s=>s.state==='receiving'&&s.snapshot===snapshot)?.id;assert(sessionId,'Capture only the explicitly approved receive session');
 await browser.close();browser=undefined;await adb('shell','input','keyevent','KEYCODE_HOME');
 result.address=`/ip4/${ip}/tcp/40217/p2p/${receiver}`;
 assert((await adb('shell','dumpsys','activity','services',pkg)).stdout.includes('isForeground=true'));
 assert((await roundTrip('background-before-idle')).success,'Baseline transfer must work');
 mutated=true;await adb('shell','dumpsys','battery','unplug');await adb('shell','input','keyevent','KEYCODE_SLEEP');
 result.defaultIdleEvidence=await settledIdle();
 await roundTrip('doze-default');
 assert.equal(await deep(),'IDLE','Do not claim Doze for transfers that wake the device');
 await adb('shell','dumpsys','deviceidle','unforce');
 // Deliberately app-scoped and bounded diagnostic condition, not shipping behavior.
 await adb('shell','dumpsys','deviceidle','tempwhitelist','-d','120000',pkg);temp=true;
 result.temporaryExemption={scope:pkg,requestedMs:120000,source:'Explicit ADB diagnostic fixture; not product authority or human settings qualification'};
 result.exemptIdleEvidence=await settledIdle();
 const exempt=await roundTrip('doze-temporarily-exempt');
 result.temporarilyExemptReceive=exempt.success&&exempt.after==='IDLE';
 await adb('shell','dumpsys','deviceidle','unforce');await adb('shell','dumpsys','deviceidle','tempwhitelist','-r',pkg);temp=false;
 await adb('shell','dumpsys','battery','reset');mutated=false;
 assert((await roundTrip('after-idle-recovery')).success,'Same scoped session must recover');
 await cancelNative();
 let refused=false;try{await cli('pin-query',resolve(identity),resolve(store),result.address,snapshot);}catch{refused=true;}assert(refused);result.stoppedRefused=true;
}finally{
 if(temp)await adb('shell','dumpsys','deviceidle','tempwhitelist','-r',pkg).catch(()=>{});
 if(mutated){await adb('shell','dumpsys','deviceidle','unforce').catch(()=>{});await adb('shell','dumpsys','battery','reset').catch(()=>{});}
 await adb('shell','input','keyevent','KEYCODE_WAKEUP').catch(()=>{});
 if(started)try{await cancelNative();}catch{await adb('shell','am','force-stop',pkg);result.cleanupFallback='Force-stopped only the task-owned preview after diagnostic cancellation failed; not a UI Stop test';started=false;}
 await browser?.close();
 result.cleanup={deep:await deep(),force:(await adb('shell','dumpsys','deviceidle','get','force')).stdout.trim(),batteryRestored:!(await adb('shell','dumpsys','battery')).stdout.includes('UPDATES STOPPED'),persistentWhitelistUnchanged:(await adb('shell','dumpsys','deviceidle','whitelist')).stdout===baseline.whitelist,foregroundReceiverStopped:!(await adb('shell','dumpsys','activity','services',pkg)).stdout.includes('isForeground=true')};
 await checkpoint();console.log(JSON.stringify({output,...result},null,2));
}
