// Read-only partition identity and protected-region digests, never raw header/key bytes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const run=promisify(execFile),[output,priorFile]=process.argv.slice(2);assert(output);
const shell=async cmd=>(await run('adb',['-s','10.77.0.2:5555','shell','set -o pipefail; '+cmd],{timeout:120000,maxBuffer:16384})).stdout.trim();
assert.equal(await shell('cat /sys/class/net/eth0/address'),'0c:47:a9:60:9d:34');
assert.equal(await shell('cat /sys/block/nvme0n1/size'),'500118192');
const checks={gptHead:'dd if=/dev/block/nvme0n1 bs=512 count=34 2>/dev/null | sha256sum',gptTail:'dd if=/dev/block/nvme0n1 bs=512 skip=500118159 count=33 2>/dev/null | sha256sum',esp:'sha256sum /dev/block/nvme0n1p1',luksHeader:'dd if=/dev/block/nvme0n1p3 bs=1048576 count=4 2>/dev/null | sha256sum'};
const digests={};for(const[name,cmd]of Object.entries(checks)){const value=(await shell(cmd)).split(/\s/)[0];assert(/^[a-f0-9]{64}$/.test(value));assert.notEqual(value,'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','Empty protected-region read');digests[name]=value;}
const result={schema:'awai.android.protected.disk.witness.v1',checkedAt:new Date().toISOString(),partitions:await shell('sgdisk --android-dump /dev/block/nvme0n1'),digests};
if(priorFile){const prior=JSON.parse(await readFile(priorFile));assert.deepEqual(result.digests,prior.digests);assert.equal(result.partitions,prior.partitions);result.protectedRegionsUnchanged=true;}
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({output,protectedRegionsUnchanged:result.protectedRegionsUnchanged??false}));
