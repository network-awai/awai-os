// Host-side, fixed-scope diagnostics. Never reads or exports private identity bytes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const run=promisify(execFile),[serial,output,baseline]=process.argv.slice(2);
assert(serial==='10.77.0.2:5555'&&output,'state-audit <explicit Desktop serial> <new-output.json> [before.json]');
const adb=async(...args)=>(await run('adb',['-s',serial,...args],{timeout:30000,maxBuffer:1048576})).stdout.trim();
assert.equal(await adb('shell','cat','/sys/class/net/eth0/address'),'0c:47:a9:60:9d:34','Wrong physical target');
assert.equal(await adb('shell','getprop','ro.product.cpu.abi'),'x86_64');
const bootId=await adb('shell','cat','/proc/sys/kernel/random/boot_id');assert(/^[a-f0-9-]{36}$/.test(bootId));
const mounts=(await adb('shell','cat','/proc/mounts')).split('\n').map(s=>s.split(' '));
const data=mounts.find(p=>p[1]==='/data'),metadata=mounts.find(p=>p[1]==='/metadata');assert(data&&metadata);
const apps=[];
for(const id of ['app.aozora.awai.preview','network.itonami.dougaka.preview','network.itonami.ongakuka.preview','network.itonami.client.preview','network.itonami.yataverse.preview']){
 await adb('shell','run-as',id,'test','-s','p2p/peer-identity-v1.key');
 const peer=await adb('shell','run-as',id,'cat','p2p/peer-identity-v1.initialized');assert(/^12D3KooW[1-9A-HJ-NP-Za-km-z]{30,100}$/.test(peer));
 const version=(await adb('shell','dumpsys','package',id)).match(/versionCode=(\d+)/)?.[1];assert(version);
 const listing=await adb('shell','run-as',id,'sh','-c',"'if test -d p2p/store; then find p2p/store -type f -exec sha256sum {} \\;; fi'");
 const files=listing?listing.split('\n').map(line=>{const m=line.match(/^([a-f0-9]{64})\s+(p2p\/store\/[a-z0-9./_-]+)$/);assert(m&&!m[2].includes('..'),'Unexpected snapshot path');return {path:m[2],sha256:m[1]};}).sort((a,b)=>a.path.localeCompare(b.path)):[];
 apps.push({id,peer,versionCode:Number(version),identityFilePresent:true,files});
}
assert.equal(new Set(apps.map(a=>a.peer)).size,5,'Separate package identities required');
assert(apps.at(-1).files.length>=9,'Retained WNFS snapshot/block metadata required');
const result={schema:'awai.android.persistence.state.v1',checkedAt:new Date().toISOString(),bootId,model:await adb('shell','getprop','ro.product.model'),abi:'x86_64',data:{source:data[0],fsType:data[2]},metadata:{source:metadata[0],fsType:metadata[2]},cryptoState:await adb('shell','getprop','ro.crypto.state'),applications:apps};
if(baseline){const prior=JSON.parse(await readFile(baseline));assert.notEqual(result.bootId,prior.bootId,'Must actually reboot');assert(!['tmpfs','ramfs'].includes(result.data.fsType),'Require persistent userdata filesystem');assert(!['tmpfs','ramfs'].includes(result.metadata.fsType),'Require persistent metadata filesystem');assert.deepEqual(result.applications,prior.applications,'Peer identities and encrypted blocks must survive exactly');result.rebootRestored=true;}
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({output,bootId,fsType:result.data.fsType,peers:apps.length,encryptedFiles:apps.at(-1).files.length,rebootRestored:result.rebootRestored??false}));
