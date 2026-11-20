// Explicit operator provisioning on the handed-off physical device; not an app API.
// No partition, boot, PIN, account, service, download or cleanup operations.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const run=promisify(execFile),[source,receipt]=process.argv.slice(2);
assert(source&&receipt&&path.isAbsolute(source)&&path.isAbsolute(receipt),'explicit absolute model directory and new receipt required');
const pins=JSON.parse(await fs.readFile(new URL('../../../apps/murakumo/image-pins.json',import.meta.url)));
assert.equal(pins.schema,'awai.image.model-set.v1');assert.equal(pins.id,'qwen-image-2.1-turbo-uncensored-ad-q2-k');assert.equal(pins.models.length,3);
const adb=async(...args)=>(await run('adb',['-s','10.77.0.2:5555',...args],{timeout:240000,maxBuffer:1048576})).stdout.trim();
const shell=cmd=>adb('shell','set -eu; '+cmd);
const digest=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex')};
const base='/mnt/vendor/generic_init/android',target=base+'/awai-models/'+pins.id;
const app='/data/user/0/network.awai.murakumo/files/image-models';
assert.equal(await shell('cat /sys/class/net/eth0/address'),'0c:47:a9:60:9d:34');
assert.equal(await shell('cat /sys/block/nvme0n1/size'),'500118192');
assert.match(await shell('blkid /dev/block/nvme0n1p2'),/UUID="9476f840-c703-4d5b-af77-41ea3c7986fb"/);
assert.match(await shell('mount'),/\/dev\/block\/nvme0n1p2 on \/mnt\/vendor\/generic_init\/android type ext4 \(rw,/);
const total=pins.models.reduce((n,p)=>n+p.bytes,0);
const report={schema:'awai.persistent-image-provisioning.v1',at:new Date().toISOString(),modelSet:pins.id,target,files:[],newDownloads:0,partitionChanges:false};
for(const p of pins.models){assert.match(p.localFile,/^[a-z][a-z0-9.-]*$/);assert(Number.isSafeInteger(p.bytes)&&p.bytes>0);assert.match(p.sha256,/^[a-f0-9]{64}$/);const f=path.join(source,p.localFile);const st=await fs.lstat(f);assert(st.isFile()&&!st.isSymbolicLink());assert.equal(st.size,p.bytes);assert.equal(await digest(f),p.sha256);}
await shell(`test -d ${base}/awai-android-2992; mkdir -p ${target}; test ! -L ${target}; test "$(readlink -f ${target})" = ${target}; chmod 755 ${base}/awai-models ${target}`);
let missing=0;for(const p of pins.models)if(await shell(`if test -e ${target}/${p.localFile}; then echo exists; else echo missing; fi`)==='missing')missing+=p.bytes;
const free=Number((await shell(`df -k ${target}`)).split('\n').at(-1).trim().split(/\s+/)[3])*1024;
assert(free>missing+536870912,'require full missing model bytes plus 512MiB reserve');
const label=await shell('stat -c %C /data/user/0/network.awai.murakumo/files');assert.match(label,/^u:object_r:app_data_file:s0(?::c[0-9]+(?:,c[0-9]+)*)?$/);
for(const p of pins.models){const to=target+'/'+p.localFile,incoming=to+'.incoming-3107';
 const exists=await shell(`if test -e ${to}; then echo exists; else echo missing; fi`);
 if(exists==='missing'){
  const staged=await shell(`if test -e ${incoming}; then echo exists; else echo missing; fi`);
  if(staged==='missing')await adb('push',path.join(source,p.localFile),incoming);
  assert.equal(Number(await shell(`stat -c %s ${incoming}`)),p.bytes);
  assert.equal((await shell(`sha256sum ${incoming}`)).split(/\s/)[0],p.sha256);
  await shell(`test ! -e ${to}; mv ${incoming} ${to}; chown 0:0 ${to}; chmod 444 ${to}; chcon ${label} ${to}`);
 }
 assert.equal(Number(await shell(`stat -c %s ${to}`)),p.bytes);assert.equal((await shell(`sha256sum ${to}`)).split(/\s/)[0],p.sha256);
 const link=app+'/'+p.localFile;const current=await shell(`test -L ${link}; readlink ${link}`);
 if(current!==to){assert.equal(current,'/mnt/awai-manimani-models-3076/'+p.localFile,'refuse unrelated model installation');await shell(`test ! -e ${link}.pre-3107-ram; test ! -L ${link}.pre-3107-ram; mv ${link} ${link}.pre-3107-ram; ln -s ${to} ${link}`);}
 assert.equal(await shell(`readlink ${link}`),to);
 assert.equal((await adb('shell','run-as','network.awai.murakumo','sha256sum',to)).split(/\s/)[0],p.sha256);
 report.files.push({name:p.localFile,bytes:p.bytes,sha256:p.sha256,appReadback:true,preexisting:exists==='exists'});
}
await shell('sync');report.totalBytes=total;report.bootId=await shell('cat /proc/sys/kernel/random/boot_id');report.selinux=await shell('getenforce');report.actualRebootVerified=false;
await fs.writeFile(receipt,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({modelSet:pins.id,files:report.files.length,bytes:total,verified:true,rebootPending:true}));
