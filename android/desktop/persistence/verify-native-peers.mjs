// Operator acceptance: invoke each restored app's real native identity command.
// Requires existing keys before launch; never installs, resets or grants receive access.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const run=promisify(execFile),[baseline,playwrightModule,output]=process.argv.slice(2);assert(output);
const {chromium,expect}=await import(playwrightModule),prior=JSON.parse(await readFile(baseline));
const port=49419,serial='10.77.0.2:5555';
const adb=async(...args)=>(await run('adb',['-s',serial,...args],{timeout:30000,maxBuffer:1048576})).stdout.trim();
assert.equal(await adb('shell','cat','/sys/class/net/eth0/address'),'0c:47:a9:60:9d:34');
assert(!(await run('adb',['forward','--list'])).stdout.includes(`tcp:${port} `),'Port already owned');
const results=[];
for(const app of prior.applications){
 assert(/^[a-z.]+$/.test(app.id));
 await adb('shell','run-as',app.id,'test','-s','p2p/peer-identity-v1.key');
 assert.equal(await adb('shell','run-as',app.id,'cat','p2p/peer-identity-v1.initialized'),app.peer);
 let browser,forwarded=false;
 try{
  await adb('shell','am','start','-W','-n',app.id+'/.MainActivity');
  let pid;await expect.poll(async()=>{try{pid=await adb('shell','pidof',app.id);return /^\d+$/.test(pid);}catch{return false;}},{timeout:30000}).toBe(true);
  await adb('forward',`tcp:${port}`,'localabstract:webview_devtools_remote_'+pid);forwarded=true;
  await expect.poll(async()=>{try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:2000});return true;}catch{return false;}},{timeout:30000}).toBe(true);
  const page=browser.contexts()[0].pages().find(p=>p.url()==='http://tauri.localhost/');assert(page);
  await page.waitForFunction(()=>!!window.__TAURI__?.core?.invoke);
  const native=await page.evaluate(async()=>({peer:await window.__TAURI__.core.invoke('peer_info'),host:await window.__TAURI__.core.invoke('peer_host_info')}));
  assert.equal(native.peer.peerId,app.peer);assert.equal(native.host.storageKind,'app-private');
  const services=await adb('shell','dumpsys','activity','services',app.id);assert(!services.includes('isForeground=true'),'Receive authority must not auto-resume');
  results.push({id:app.id,peer:native.peer.peerId,storageKind:native.host.storageKind,nativeKeyDerivationMatched:true,receiveServiceAutoResumed:false});
 }finally{await browser?.close();if(forwarded)await adb('forward','--remove',`tcp:${port}`);}
}
const result={schema:'awai.android.native-restored-peers.v1',checkedAt:new Date().toISOString(),results};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
