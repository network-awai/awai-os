// Explicit two-preview fixture; real trusted UI choices, synthetic encrypted snapshot only.
import {chromium,expect} from '@playwright/test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
const [phoneSerial,desktopSerial,phoneCdp,desktopCdp,phoneRelayIp,desktopRelayIp,snapshot]=process.argv.slice(2);
if(!snapshot||![phoneCdp,desktopCdp].every(v=>/^http:\/\/127\.0\.0\.1:\d+$/.test(v))||![phoneRelayIp,desktopRelayIp].every(v=>/^\d{1,3}(\.\d{1,3}){3}$/.test(v)))throw Error('device-pair-test <phone-serial> <desktop-serial> <phone-CDP> <desktop-CDP> <relay-IP-seen-by-phone> <relay-IP-seen-by-desktop> <snapshot>');
const run=promisify(execFile),repo=fileURLToPath(new URL('../../../',import.meta.url));
const output=resolve(repo,'.agent-output',`apk-pair-${Date.now()}`);await mkdir(output,{recursive:true});
const adb=(serial,...args)=>run('adb',['-s',serial,...args],{timeout:30000,maxBuffer:1048576});
const browsers=await Promise.all([phoneCdp,desktopCdp].map(url=>chromium.connectOverCDP(url)));
const [phone,desktop]=browsers.map(b=>b.contexts()[0].pages().find(p=>p.url()==='http://tauri.localhost/'));assert(phone&&desktop,'Only own Yataverse previews may be controlled');
const phonePeer=await phone.locator('#awai-local-peer').textContent(),desktopPeer=await desktop.locator('#awai-local-peer').textContent();assert(phonePeer!==desktopPeer);
const participants=resolve(output,'participants.json');await writeFile(participants,JSON.stringify([phonePeer,desktopPeer]));
const relay=spawn(resolve(repo,'packages/awai-peer/target/debug/awai-peer'),['relay',output+'/relay','/ip4/0.0.0.0/tcp/40218',participants,'300'],{stdio:['ignore','pipe','pipe']});let relayErrors='';relay.stderr.on('data',d=>relayErrors+=d);let receiving=false;
async function hideKeyboard(page,serial){const ime=await adb(serial,'shell','dumpsys input_method | grep mInputShown').catch(()=>({stdout:''}));if(ime.stdout.includes('mInputShown=true')){await adb(serial,'shell','input','keyevent','KEYCODE_BACK');await page.waitForFunction(()=>!window.visualViewport?.offsetTop);}}
async function approve(page,button,expected){await page.locator(button).click();const dialog=page.getByRole('dialog');for(const text of expected)await expect(dialog).toContainText(text);const allow=page.getByRole('button',{name:'Allow once',exact:true});await expect(allow).toBeEnabled();await allow.click();}
try{
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('relay startup timeout '+relayErrors)),30000);createInterface({input:relay.stdout}).once('line',line=>{clearTimeout(timer);try{resolve(JSON.parse(line));}catch(e){reject(e);}});relay.once('exit',code=>{clearTimeout(timer);reject(Error('relay stopped '+code+' '+relayErrors));});});
 const relayPeer=ready.relay.split('/').at(-1);assert(/^12D3KooW/.test(relayPeer));
 await desktop.locator('#awai-snapshot').fill(snapshot);if(!await desktop.locator('#awai-source-peer').isVisible())await desktop.locator('#awai-transfer details summary').click();
 await desktop.locator('#awai-source-peer').fill(phonePeer);await desktop.locator('#awai-listen').fill(`/ip4/${desktopRelayIp}/tcp/40218/p2p/${relayPeer}/p2p-circuit`);await hideKeyboard(desktop,desktopSerial);await desktop.locator('#awai-read-back').check();
 await approve(desktop,'button[value=receive]',[snapshot,phonePeer,relayPeer,'"allow-read-back":true']);
 await expect(desktop.locator('#awai-session-status')).toContainText(/受信中|Receiving/,{timeout:65000});receiving=true;
 const service=(await adb(desktopSerial,'shell','dumpsys','activity','services','network.itonami.yataverse.preview')).stdout;assert(service.includes('isForeground=true'));
 await adb(desktopSerial,'shell','input','keyevent','KEYCODE_HOME');
 await phone.locator('#awai-snapshot').fill(snapshot);await phone.locator('#awai-address').fill(`/ip4/${phoneRelayIp}/tcp/40218/p2p/${relayPeer}/p2p-circuit/p2p/${desktopPeer}`);
 await hideKeyboard(phone,phoneSerial);
 const results={};
 for(const action of ['push','query','pull']){
  await approve(phone,`button[value=${action}]`,[snapshot,desktopPeer,relayPeer]);
  await expect(phone.locator('#awai-peer-status')).toContainText(action==='push'?/送信して保持|Sent and retention/:action==='query'?/保持を確認|Retention verified/:/検証して保存|Verified and saved/,{timeout:60000});
  results[action]=JSON.parse(await phone.locator('#awai-peer-result').textContent());assert(results[action].verified===true);
 }
 await adb(desktopSerial,'shell','am','start','-n','network.itonami.yataverse.preview/.MainActivity');await desktop.locator('#awai-stop').click();await expect(desktop.locator('#awai-session-status')).toContainText(/受信していません|Not receiving/);receiving=false;
 await expect.poll(async()=>(await adb(desktopSerial,'shell','dumpsys','activity','services','network.itonami.yataverse.preview')).stdout.includes('isForeground=true')).toBe(false);
 const result={schema:'awai.apk.peer.pair.v1',checkedAt:new Date().toISOString(),sourceRevision:(await run('git',['rev-parse','HEAD'],{cwd:repo})).stdout.trim(),package:'network.itonami.yataverse.preview',tauri:'3.0.0-alpha.6',devices:[{role:'sender',abi:'arm64-v8a',peer:phonePeer},{role:'receiver',abi:'x86_64',peer:desktopPeer}],snapshot,relay:relayPeer,explicitRelayCircuit:true,canonicalTrustedUiApproval:true,backgroundReceiver:true,push:true,verifiedPinQuery:true,pull:true,explicitStop:true,independentDevices:true,localNetworkSegments:2,wanNatHolePunchQualified:false,results};
 await writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n');await writeFile(resolve(repo,'.agent-output/apk-pair-latest.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await desktop.locator('#awai-cancel').click().catch(()=>{});if(receiving){await adb(desktopSerial,'shell','am','start','-n','network.itonami.yataverse.preview/.MainActivity').catch(()=>{});await desktop.locator('#awai-stop').click().catch(()=>{});}relay.kill('SIGTERM');for(const browser of browsers)await browser.close();}
