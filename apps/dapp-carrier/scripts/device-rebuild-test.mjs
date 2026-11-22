// Explicit preview updates only. Local ADB installation is not Store-install qualification.
import {chromium,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const run=promisify(execFile),repo=fileURLToPath(new URL('../../../',import.meta.url));
const [serial,distribution,portText,priorReport]=process.argv.slice(2),port=Number(portText);
assert(serial&&distribution&&Number.isInteger(port)&&port>1024&&port<65535,'device-rebuild-test <serial> <distribution> <owned-CDP-port>');
const release=JSON.parse(await readFile(resolve(distribution,'distribution.json')));
const profiles=JSON.parse(await readFile(resolve(repo,'apps/dapp-carrier/profiles/apps.json')));
assert.deepEqual(release.canonicalRuntime,profiles.canonicalRuntime);
const output=resolve(repo,'.agent-output',`apk-rebuild-${Date.now()}-${process.pid}`);await mkdir(output,{recursive:true});
const adb=(...args)=>run('adb',['-s',serial,...args],{timeout:120000,maxBuffer:1048576});
const results=[];let forwarded=false;
const known=priorReport?JSON.parse(await readFile(resolve(priorReport))).artifacts:[];
assert(Array.isArray(known),'Prior fixture report must contain artifacts');
async function inspect(profile,identityOnly=false){
 await adb('shell','am','force-stop',profile.id);
 await adb('shell','am','start','-W','-n',profile.id+'/.MainActivity');
 let pid;await expect.poll(async()=>{try{pid=(await adb('shell','pidof',profile.id)).stdout.trim();return /^\d+$/.test(pid);}catch{return false;}},{timeout:20000}).toBe(true);
 assert(!(await run('adb',['forward','--list'])).stdout.includes(`tcp:${port} `),'CDP port belongs to another task');
 await adb('forward',`tcp:${port}`,'localabstract:webview_devtools_remote_'+pid);forwarded=true;
 const endpoint=`http://127.0.0.1:${port}`;
 await expect.poll(async()=>{try{return(await(await fetch(endpoint+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).some(p=>p.url==='http://tauri.localhost/');}catch{return false;}},{timeout:20000}).toBe(true);
 let browser,page;await expect.poll(async()=>{try{browser=await chromium.connectOverCDP(endpoint,{timeout:3000});page=browser.contexts()[0].pages().find(p=>p.url()==='http://tauri.localhost/');if(page)return true;await browser.close();browser=undefined;return false;}catch{await browser?.close().catch(()=>{});browser=undefined;return false;}},{timeout:30000}).toBe(true);
 try{
  assert(page);
  // The original Aozora preview predates the shared panel but exposes the same
  // public identity command. Do not require its old UI to contain new controls.
  if(identityOnly){
   await page.waitForFunction(()=>!!(window.__TAURI__?.core?.invoke||window.__TAURI_INTERNALS__?.invoke));
   try{const info=await page.evaluate(()=>window.__TAURI__?.core?window.__TAURI__.core.invoke('peer_info'):window.__TAURI_INTERNALS__.invoke('peer_info'));assert(/^12D3KooW/.test(info.peerId));return {peer:info.peerId};}
   catch(error){
    if(profile.key!=='aozora'||!String(error).includes('Command not found'))throw error;
    const key=(await adb('shell','run-as',profile.id,'sh','-c',"'if test -e files/p2p/peer-identity-v1.key; then echo present; else echo absent; fi'" )).stdout.trim();
    assert.equal(key,'absent','Do not guess the identity of an initialized legacy preview');
    return {peer:null,legacyWithoutPeerHost:true};
   }
  }
  if(await page.locator('#awai-open-peer').count()&&!await page.locator('#awai-peer-panel').evaluate(el=>el.open))await page.locator('#awai-open-peer').click();
  await expect(page.locator('#awai-local-peer')).toContainText('12D3KooW',{timeout:15000});
  const peer=await page.locator('#awai-local-peer').textContent();
  const actual=await page.evaluate(async()=>{const bytes=await(await fetch('./runtime.js')).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');});
  const descriptor=await page.evaluate(async()=>await(await fetch('./dapp.json')).json());
  const host=await page.evaluate(()=>window.__TAURI__.core.invoke('peer_host_info'));
  return {peer,runtimeSha256:actual,canonicalRuntime:descriptor.canonicalRuntime,storageKind:host.storageKind,version:descriptor.version};
 }finally{await browser.close();await adb('forward','--remove',`tcp:${port}`);forwarded=false;}
}
try{
 for(const profile of profiles.apps){
  const artifact=release.artifacts.find(a=>a.id===profile.id);assert(artifact&&profile.id.endsWith('.preview'));
  const apk=resolve(distribution,artifact.asset),bytes=await readFile(apk);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
  let prior;try{prior=(await adb('shell','pm','path',profile.id)).stdout.trim();}catch(error){if(error.code===1&&!error.stdout&&!error.stderr)prior='';else throw error;}let before;
  let beforeVersion;
  if(prior){before=await inspect(profile,true);const info=(await adb('shell','dumpsys','package',profile.id)).stdout;beforeVersion=Number(info.match(/versionCode=(\d+)/)?.[1]);assert(beforeVersion<=artifact.versionCode,'Never downgrade a preview');}
  await adb('install','-r',apk);
  const after=await inspect(profile);assert.equal(after.runtimeSha256,release.canonicalRuntime.sha256);assert.deepEqual(after.canonicalRuntime,release.canonicalRuntime);assert.equal(after.version,artifact.versionName);if(before?.peer)assert.equal(after.peer,before.peer,'Preserve existing preview identity');
  const knownPeer=known.find(a=>a.id===profile.id)?.peer;if(knownPeer)assert.equal(after.peer,knownPeer,'Match independently recorded fixture identity');
  results.push({key:profile.key,id:profile.id,versionCode:artifact.versionCode,versionName:artifact.versionName,apkSha256:artifact.sha256,installed:true,launched:true,peerPreserved:before?.peer?true:null,legacyWithoutPeerHost:before?.legacyWithoutPeerHost,previousPeer:before?.peer,previousVersionCode:beforeVersion,alreadyAtTarget:beforeVersion===artifact.versionCode,priorReport:knownPeer?priorReport:undefined,priorReportedPeer:knownPeer,...after});
  await writeFile(output+'/checkpoint.json',JSON.stringify(results,null,2)+'\n');
 }
 const result={schema:'awai.apk.rebuild.device.v1',checkedAt:new Date().toISOString(),sourceRevision:release.sourceRevision,canonicalRuntime:release.canonicalRuntime,device:(await adb('shell','getprop','ro.product.model')).stdout.trim(),abi:(await adb('shell','getprop','ro.product.cpu.abi')).stdout.trim(),installation:'Explicit adb install -r of task-owned preview APKs; no Store-flow claim',results};
 await writeFile(output+'/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,...result},null,2));
}finally{if(forwarded)await adb('forward','--remove',`tcp:${port}`).catch(()=>{});}
