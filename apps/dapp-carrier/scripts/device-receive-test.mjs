// Explicit disposable preview fixture. CDP carries UI control only, never snapshot data.
import {chromium,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const run=promisify(execFile),repo=fileURLToPath(new URL('../../../',import.meta.url));
const [serial,ip,cdp,sourceIdentity,sourceStore,snapshot,originalCar]=process.argv.slice(2);
if(!serial||!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)||!/^http:\/\/127\.0\.0\.1:\d+$/.test(cdp)||!originalCar)throw Error('device-receive-test <serial> <literal-ip> <local-CDP> <sender-identity> <source-store> <snapshot> <CAR>');
const output=resolve(repo,'.agent-output',`apk-receive-${Date.now()}`);await mkdir(output,{recursive:true});
const adb=(...args)=>run('adb',['-s',serial,...args],{timeout:30000,maxBuffer:1048576});
const cli=async(...args)=>JSON.parse((await run(resolve(repo,'packages/awai-peer/target/debug/awai-peer'),args,{timeout:60000,maxBuffer:1048576})).stdout);
const sender=await cli('identity',resolve(sourceIdentity));
const receiverPackage='network.itonami.yataverse.preview';
const desktopBackground=process.env.AWAI_FIXTURE_DESKTOP_BACKGROUND;
assert(!desktopBackground||desktopBackground==='aozora','Only the owned Aozora preview may cover the receiver');
async function activityStates(pkg){
 const dump=(await adb('shell','dumpsys','activity','activities')).stdout;
 const records=[...dump.matchAll(/^\s*\* Hist\s+#\d+: ActivityRecord\{([^\n]+)\}/gm)],result=[];
 for(let i=0;i<records.length;i++){
  const m=records[i];if(!m[1].includes(pkg+'/'))continue;
  const body=dump.slice(m.index,records[i+1]?.index??dump.length);
  const visible=body.match(/mVisibleRequested=(\w+) mVisible=(\w+) mClientVisible=(\w+)/);
  const displays=[...dump.slice(0,m.index).matchAll(/^Display #(\d+)/gm)];
  result.push({taskId:Number(m[1].match(/\bt(\d+)\b/)?.[1]),displayId:Number(displays.at(-1)?.[1]),state:body.match(/^\s*state=(\w+)/m)?.[1],visibleRequested:visible?.[1],visible:visible?.[2],clientVisible:visible?.[3]});
 }
 return result;
}
const hidden=states=>states.length>0&&states.every(s=>s.state==='STOPPED'&&s.visibleRequested==='false'&&s.visible==='false'&&s.clientVisible==='false');
await adb('shell','am','start','-W','-n',receiverPackage+'/.MainActivity');
let desktopDisplay;
if(desktopBackground){
 const current=(await activityStates(receiverPackage)).find(s=>s.visibleRequested==='true');assert(current&&Number.isInteger(current.taskId)&&Number.isInteger(current.displayId));desktopDisplay=current.displayId;
 const moved=await adb('shell','wm','shell','desktopmode','moveTaskOutOfDesk',String(current.taskId));assert(!/Invalid command|Not implemented/.test(moved.stdout));
}
let backgroundActivityVerified=false,backgroundBeforeTransfer,backgroundAfterTransfer;

const browser=await chromium.connectOverCDP(cdp);const page=browser.contexts()[0].pages().find(p=>p.url()==='http://tauri.localhost/');
assert(page,'Own preview page required');let started=false;
try{
 const receiver=await page.locator('#awai-local-peer').textContent();assert(/^12D3KooW/.test(receiver));if(process.env.AWAI_FIXTURE_EXPECTED_PEER)assert.equal(receiver,process.env.AWAI_FIXTURE_EXPECTED_PEER);const hostInfo=await page.evaluate(()=>window.__TAURI__.core.invoke('peer_host_info'));assert(['temporary','app-private'].includes(hostInfo.storageKind));if(hostInfo.storageKind==='temporary')await expect(page.locator('body > .awai-storage-notice')).toContainText(/temporary storage|再起動すると/);else await expect(page.locator('body > .awai-storage-notice')).toHaveCount(0);
 await page.locator('#awai-snapshot').fill(snapshot);
 if(!await page.locator('#awai-source-peer').isVisible())await page.locator('#awai-transfer details summary').click();
 await page.locator('#awai-source-peer').fill(sender.peerId);await page.locator('#awai-listen').fill(`/ip4/${ip}/tcp/40217`);const ime=await adb('shell','dumpsys input_method | grep mInputShown').catch(()=>({stdout:''}));if(ime.stdout.includes('mInputShown=true')){await adb('shell','input','keyevent','KEYCODE_BACK');await page.waitForFunction(()=>!window.visualViewport?.offsetTop);}
 await page.locator('#awai-read-back').check();
 await page.locator('button[value=receive]').click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText(snapshot);await expect(dialog).toContainText(sender.peerId);await expect(dialog).toContainText('"allow-read-back":true');
 const allow=page.getByRole('button',{name:'Allow once',exact:true});await expect(allow).toBeEnabled();await allow.click();
 await expect(page.locator('#awai-session-status')).toContainText(/受信中|Receiving/,{timeout:15000});started=true;
 const service=(await adb('shell','dumpsys','activity','services','network.itonami.yataverse.preview')).stdout;
 assert(service.includes('PeerReceiveService')&&service.includes('isForeground=true'),'Foreground receiver must actually run');
 if(!process.env.AWAI_FIXTURE_FOREGROUND){
  if(desktopBackground){
   await adb('shell','am','start','-W','--display',String(desktopDisplay),'--windowingMode','1','-n','app.aozora.awai.preview/.MainActivity');
   const cover=(await activityStates('app.aozora.awai.preview')).find(s=>s.visibleRequested==='true');assert(cover&&Number.isInteger(cover.taskId));
   const moved=await adb('shell','wm','shell','desktopmode','moveTaskOutOfDesk',String(cover.taskId));assert(!/Invalid command|Not implemented/.test(moved.stdout));
  }else await adb('shell','input','keyevent','KEYCODE_HOME');
  await expect.poll(async()=>hidden(await activityStates(receiverPackage)),{timeout:15000}).toBe(true);
  backgroundBeforeTransfer=await activityStates(receiverPackage);
  const running=(await adb('shell','dumpsys','activity','services',receiverPackage)).stdout;assert(running.includes('PeerReceiveService')&&running.includes('isForeground=true'));
  backgroundActivityVerified=true;
 }
 const address=`/ip4/${ip}/tcp/40217/p2p/${receiver}`;
 let preexistingSnapshotVerified=false;if(process.env.AWAI_FIXTURE_QUERY_BEFORE_PUSH){const prior=await cli('pin-query',resolve(sourceIdentity),resolve(sourceStore),address,snapshot);assert.equal(prior.verified.blocks,8);preexistingSnapshotVerified=true;}
 const pushed=await cli('sync-push',resolve(sourceIdentity),resolve(sourceStore),address,snapshot);assert.equal(pushed.verified.provider,receiver);
 const query=await cli('pin-query',resolve(sourceIdentity),resolve(sourceStore),address,snapshot);assert.equal(query.verified.snapshot,snapshot);
 const pulled=await cli('sync-pull',resolve(sourceIdentity),output+'/restored',address,snapshot,output+'/restored.car');assert(pulled.verified);
 const original=await readFile(resolve(originalCar)),returned=await readFile(output+'/restored.car');assert.deepEqual(returned,original);
 const hash=b=>createHash('sha256').update(b).digest('hex');
 if(backgroundActivityVerified){backgroundAfterTransfer=await activityStates(receiverPackage);assert(hidden(backgroundAfterTransfer),'Receiver must remain hidden throughout transfer');}
 await adb('shell','am','start','-n','network.itonami.yataverse.preview/.MainActivity');
 await page.locator('#awai-stop').click();await expect(page.locator('#awai-session-status')).toContainText(/受信していません|Not receiving/);started=false;
 await expect.poll(async()=>(await adb('shell','dumpsys','activity','services','network.itonami.yataverse.preview')).stdout.includes('isForeground=true')).toBe(false);
 let refused=false;try{await cli('pin-query',resolve(sourceIdentity),resolve(sourceStore),address,snapshot);}catch{refused=true;}assert(refused,'Stopped listener must refuse traffic');
 const result={schema:'awai.apk.peer.device.v1',workingTreeCandidate:true,checkedAt:new Date().toISOString(),devices:['macOS',(await adb('shell','getprop','ro.product.model')).stdout.trim()],androidAbi:(await adb('shell','getprop','ro.product.cpu.abi')).stdout.trim(),androidApi:(await adb('shell','getprop','ro.build.version.sdk')).stdout.trim(),tauri:'3.0.0-alpha.6',package:'network.itonami.yataverse.preview',sender:sender.peerId,receiver,snapshot,blocks:query.verified.blocks,carBytes:original.length,carSha256:hash(original),returnedCarSha256:hash(returned),canonicalTrustedUiApproval:true,foregroundService:true,storageKind:hostInfo.storageKind,preexistingSnapshotVerified,backgroundLanRoundTrip:backgroundActivityVerified,backgroundActivityVerified,backgroundBeforeTransfer,backgroundAfterTransfer,backgroundMethod:desktopBackground?'owned-preview-fullscreen':'home',explicitStopRefusedTraffic:true,independentDevices:true,independentNetworks:false,controlChannel:'installation, own WebView UI control and diagnostics only; ciphertext travels over literal IPv4 TCP/Noise/Yamux',restoredStore:output+'/restored',output};
 await writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n');await writeFile(resolve(repo,'.agent-output/apk-receive-latest.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{if(started){await adb('shell','am','start','-n','network.itonami.yataverse.preview/.MainActivity').catch(()=>{});await page.locator('#awai-stop').click().catch(()=>{});}await browser.close();}
