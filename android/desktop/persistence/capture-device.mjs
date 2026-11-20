// Fixed physical target. Encrypt locally before exporting; survive Android network reconfiguration.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,stat,chmod} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const run=promisify(execFile),[serial,keychain,out]=process.argv.slice(2);
assert(serial==='10.77.0.2:5555'&&keychain&&out,'capture-device <Desktop serial> <Keychain helper> <new output directory>');
const adb=(...args)=>run('adb',['-s',serial,...args],{timeout:600000,maxBuffer:1048576});
assert.equal((await adb('shell','cat','/sys/class/net/eth0/address')).stdout.trim(),'0c:47:a9:60:9d:34');
assert((await adb('shell','cat','/proc/mounts')).stdout.includes('/data /data tmpfs '));
const base='/data/local/tmp/awai-2992-maintenance';
assert.equal((await adb('shell','sha256sum',base+'/age')).stdout.split(/\s/)[0],'2e305637f2a0555305e21c17fb74446acbb39b53135d43d4b744e50c287133a5');
assert.equal((await adb('shell','sha256sum',base+'/busybox')).stdout.split(/\s/)[0],'ee558fc041571a95fdeee5ed91cf2cc5647a7873a07c52af99227aca8451b711');
await mkdir(out,{mode:0o700});
const recipient=(await run(resolve(keychain),['recipient'])).stdout.trim();assert(/^age1[a-z0-9]{50,100}$/.test(recipient));
const work=base+'/capture-'+Date.now()+'-'+process.pid;
const script=[
 '#!/data/local/tmp/awai-2992-maintenance/busybox sh','set -eu','set -o pipefail',
 `work=${work}`,`base=${base}`,`recipient=${recipient}`,
 `trap 'status=$?; start; rm -f "$work/paths"; printf "%s\\n" "$status" > "$work/status"; exit "$status"' EXIT`,
 'trap "exit 124" TERM INT HUP',
 'stop','sync','test "$(getprop init.svc.zygote)" = stopped','cd /',
 '{ find data -xdev \\( -path data/local/tmp/awai-2992-maintenance -o -path "data/vendor/*/sockets" -o -path data/vendor/sockets \\) -prune -o \\( -type f -o -type d -o -type l \\) -print0; find metadata -xdev \\( -type f -o -type d -o -type l \\) -print0; } > "$work/paths"',
 'tar --numeric-owner --no-recursion --null -cf - -C / -T "$work/paths" | "$base/age" -r "$recipient" -o "$work/checkpoint.age"','sync','exit 0',''
].join('\n');
await writeFile(resolve(out,'worker.sh'),script,{flag:'wx',mode:0o600});
await adb('shell','mkdir','-m','700',work);await adb('push',resolve(out,'worker.sh'),work+'/worker.sh');
await adb('shell',`${base}/busybox setsid ${base}/busybox timeout 240 ${base}/busybox sh ${work}/worker.sh > ${work}/worker.log 2>&1 < /dev/null &`);
const until=Date.now()+300000;let status;
while(Date.now()<until){
 try{status=(await adb('shell','cat',work+'/status')).stdout.trim();if(/^\d+$/.test(status))break;await new Promise(r=>setTimeout(r,2000));}
 catch{await run('adb',['connect',serial],{timeout:10000,maxBuffer:4096}).catch(()=>{});await new Promise(r=>setTimeout(r,2000));}
}
if(status!=='0')await adb('shell','start').catch(()=>{});
assert.equal(status,'0','Device capture failed/timed out; encrypted partial and local diagnostics preserved; no reboot');
assert.equal((await adb('shell','getprop','init.svc.zygote')).stdout.trim(),'running');
const expected=(await adb('shell','sha256sum',work+'/checkpoint.age')).stdout.split(/\s/)[0];assert(/^[a-f0-9]{64}$/.test(expected));
const archive=resolve(out,'android-data-metadata.tar.age');
await adb('pull',work+'/checkpoint.age',archive);
await chmod(archive,0o600);
const hash=createHash('sha256');for await(const b of createReadStream(archive))hash.update(b);assert.equal(hash.digest('hex'),expected);
await run(resolve(keychain),['verify',archive],{timeout:600000,maxBuffer:4096});
const result={schema:'awai.android.encrypted.checkpoint.v1',checkedAt:new Date().toISOString(),bootId:(await adb('shell','cat','/proc/sys/kernel/random/boot_id')).stdout.trim(),archive:'android-data-metadata.tar.age',bytes:(await stat(archive)).size,sha256:expected,scope:['/data','/metadata'],frameworkQuiesced:true,frameworkRestarted:true,authenticatedArchiveVerified:true,encryptedBeforeExport:true,plaintextArchiveWritten:false,keyCustody:'macOS Keychain network.awai.android.checkpoint.v1 / AWAI-2992-20261117',remoteEncryptedArchive:work+'/checkpoint.age',transientExclusions:'Other filesystems, sockets/FIFOs/devices, vendor IPC sockets directories and this task maintenance directory; enumerated entries only',selinuxLabels:'Not archived; restorecon and actual restart/application readback required',aospFbeQualified:false};
await writeFile(resolve(out,'checkpoint.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
