// Explicit update of task-owned preview apps only; preserves recorded public PeerIDs.
import {chromium,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const [serial,storeCdp,distribution,...keys]=process.argv.slice(2);if(!serial||!/^http:\/\/127\.0\.0\.1:\d+$/.test(storeCdp)||!keys.length)throw Error('device-store-update-test <serial> <own-preview-Store-CDP> <distribution-dir> <app-key>...');
const run=promisify(execFile),app=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(app,'../..');const profiles=JSON.parse(await readFile(resolve(app,'profiles/apps.json'),'utf8'));
const adb=(...args)=>run('adb',['-s',serial,...args],{timeout:45000,maxBuffer:1048576});
await adb('shell','am','start','-n','network.awai.store.p2p.preview/network.awai.store.StoreActivity');
const browser=await chromium.connectOverCDP(storeCdp),page=browser.contexts()[0].pages().find(p=>p.url()==='https://appassets.androidplatform.net/awai/index.html');assert(page,'Own preview Store only');
const release=JSON.parse(await readFile(resolve(distribution,'distribution.json'),'utf8'));const prior=JSON.parse(await readFile(resolve(repo,'.agent-output/20261116-store-device-evidence.json'),'utf8'));
const result=[];const forwards=[];
async function nodes(){await adb('shell','uiautomator','dump','/data/local/tmp/awai-3001-store-install.xml');const xml=(await adb('shell','cat','/data/local/tmp/awai-3001-store-install.xml')).stdout;return [...xml.matchAll(/<node\s([^>]+)>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));}
async function clickNative(pkg,text,appName){
 const until=Date.now()+20000;
 while(Date.now()<until){const all=await nodes();const selected=all.filter(n=>n.package===pkg&&n.text===text);if(selected.length===1&&(!appName||all.some(n=>n.package===pkg&&n.text===appName))){const [x1,y1,x2,y2]=selected[0].bounds.match(/\d+/g).map(Number);await adb('shell','input','tap',String(Math.floor((x1+x2)/2)),String(Math.floor((y1+y2)/2)));return;}await new Promise(r=>setTimeout(r,300));}
 throw Error('Expected native confirmation not visible: '+pkg+' '+text);
}
try{
 for(const [i,key]of keys.entries()){
  const profile=profiles.apps.find(p=>p.key===key);assert(profile,'Only a pinned profile can be tested');
  const expected=release.artifacts.find(a=>a.id===profile.id),old=prior.applications.find(a=>a.id===profile.id);assert(expected&&old,'Pinned release and prior fixture evidence required');const before=(await adb('shell','dumpsys','package',profile.id)).stdout;const beforeVersion=Number(before.match(/versionCode=(\d+)/)?.[1]);assert(Number.isSafeInteger(beforeVersion)&&beforeVersion<expected.versionCode,'Only a forward update from the existing preview fixture is allowed');
  await adb('shell','am','start','-n','network.awai.store.p2p.preview/network.awai.store.StoreActivity');
  for(let n=0;n<3&&await page.locator('.app-row').count()===0;n++)await page.getByRole('button',{name:'戻る',exact:true}).click();
  await page.locator('.app-row').filter({hasText:profile.name}).click();await page.getByRole('button',{name:'更新内容を確認',exact:true}).click();await expect(page.locator('dl')).toContainText(profile.name+' v');await page.getByRole('button',{name:'今回の更新を確認',exact:true}).click();
  await clickNative('network.awai.store.p2p.preview','今回の更新に進む');await clickNative('com.android.packageinstaller','Update',profile.name);
  await expect.poll(async()=>{try{return Number((await adb('shell','dumpsys','package',profile.id)).stdout.match(/versionCode=(\d+)/)?.[1])===expected.versionCode;}catch{return false;}},{timeout:30000}).toBe(true);
  const info=(await adb('shell','dumpsys','package',profile.id)).stdout;assert(info.includes('installerPackageName=network.awai.store.p2p.preview'));
  const entry={key,id:profile.id,versionCode:Number(info.match(/versionCode=(\d+)/)?.[1]),installer:'network.awai.store.p2p.preview',nativeConfirmation:true,androidInstallConfirmation:true,storeLaunch:false,sharedNativePeerReady:false,domainUi:profile.domainUi};result.push(entry);await writeFile(resolve(repo,'.agent-output/store-update-checkpoint-'+process.pid+'.json'),JSON.stringify(result,null,2)+'\n');
  await adb('shell','am','start','-n','network.awai.store.p2p.preview/network.awai.store.StoreActivity');await page.getByRole('button',{name:'今は追加しない',exact:true}).click();await page.getByRole('button',{name:profile.name+' を開く',exact:true}).click();
  let pid;await expect.poll(async()=>{try{pid=(await adb('shell','pidof',profile.id)).stdout.trim();return /^\d+$/.test(pid);}catch{return false;}},{timeout:15000}).toBe(true);
  const port=49321+i;const listed=(await run('adb',['forward','--list'])).stdout;assert(!listed.includes('tcp:'+port),'Forward port already owned');await adb('forward','tcp:'+port,'localabstract:webview_devtools_remote_'+pid);forwards.push(port);
  const endpoint='http://127.0.0.1:'+port;await expect.poll(async()=>{try{return (await(await fetch(endpoint+'/json/list',{signal:AbortSignal.timeout(1000)})).json()).some(p=>p.url==='http://tauri.localhost/');}catch{return false;}},{timeout:20000}).toBe(true);
  const appBrowser=await chromium.connectOverCDP(endpoint);try{
   const appPage=appBrowser.contexts()[0].pages().find(p=>p.url()==='http://tauri.localhost/');assert(appPage,'Local Tauri app required');if(await appPage.locator('#awai-open-peer').count())await appPage.locator('#awai-open-peer').click();
   await expect(appPage.locator('#awai-local-peer')).toContainText('12D3KooW',{timeout:15000});const peer=await appPage.locator('#awai-local-peer').textContent();assert.equal(peer,old.peer,'Updating must preserve the fixture peer identity');const info=await appPage.evaluate(()=>window.__TAURI__.core.invoke('peer_host_info'));assert.equal(info.storageKind,'temporary');await expect(appPage.locator('body > .awai-storage-notice')).toContainText(/temporary storage|再起動すると/);if(key==='aozora')await expect(appPage.locator('#peer-help')).not.toBeEmpty();
   Object.assign(entry,{storeLaunch:true,sharedNativePeerReady:true,peer,peerPreserved:true,temporaryStorageNotice:true,previousVersionCode:beforeVersion});await writeFile(resolve(repo,'.agent-output/store-update-checkpoint-'+process.pid+'.json'),JSON.stringify(result,null,2)+'\n');
  }finally{await appBrowser.close();}
 }
 const report={schema:'awai.store.device.update.v1',checkedAt:new Date().toISOString(),androidAbi:(await adb('shell','getprop','ro.product.cpu.abi')).stdout.trim(),store:'network.awai.store.p2p.preview',productionStoreReplaced:false,apkTransfers:'Bundled APKs through verified native PackageInstaller sessions; no adb install for tested dapps',artifacts:result};await writeFile(resolve(repo,'.agent-output/store-update-device.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();for(const port of forwards)await adb('forward','--remove','tcp:'+port).catch(()=>{});}
