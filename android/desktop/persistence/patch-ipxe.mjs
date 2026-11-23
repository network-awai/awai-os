// Preserve PE layout; alter only the pinned unsigned engineering embedded script/checksum.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [input,mode,output,imgMode,imgSectors]=process.argv.slice(2);assert(['audit','persistent','recovery','repair','reblock','install'].includes(mode)&&output);
assert(mode!=='install'||(['erase','shared'].includes(imgMode||'erase')&&/^\d+$/.test(imgSectors||'500118192')),'install args: [erase|shared] [sectors]');
const b=await readFile(input),sha=x=>createHash('sha256').update(x).digest('hex');
assert.equal(sha(b),'e7fb0e08d957f4e8014348f95717ececbf81513d52a5b6f275b782fed426d5eb','Unreviewed iPXE input');
const pe=b.readUInt32LE(0x3c),optional=pe+24;assert.equal(b.readUInt32LE(pe),0x4550);assert.equal(b.readUInt16LE(optional),0x20b);
assert.equal(b.readUInt32LE(optional+112+4*8+4),0,'Never silently invalidate an Authenticode signature');
const needle=Buffer.from('kernel http://10.77.0.1:18090/kernel');const at=b.indexOf(needle);assert(at>=0&&b.indexOf(needle,at+1)===-1);
const start=b.lastIndexOf(Buffer.from('#!ipxe\n'),at),end=b.indexOf(0,at);assert(start>=0&&end>at);
const original=b.toString('ascii',start,end);assert(original.includes('module_blacklist=nvme,nvme_core,ahci,sd_mod,usb_storage,uas'));
let script=original.replaceAll('10.77.0.1:18090','10.77.0.1:18091').replace('module_blacklist=nvme,nvme_core,','module_blacklist=');
if(mode!=='audit'&&mode!=='install')script=script.replace('androidboot.android_dir=android-Generic_x86_64','androidboot.android_dir=awai-android-2992');
if(mode==='install'){
 // Installer profile: same port/blacklist ops as other modes. It BOOTS the
 // installer init with a short cmdline marker only; image sha/bytes/url pins
 // live inside the initrd overlay (/awai/install.pins), digest-covered by the
 // whole-initrd pin in the serve manifest. The length assert below refuses
 // to grow the embedded region into an overlong marker set.
 if(/awai\.install\.profile=/.test(script))throw new Error('already an install script');
 script=script.replace('androidboot.mount_userdata=tmpfs',
  `androidboot.mount_userdata=tmpfs awai.install.profile=1 awai.install.mode=${imgMode||'erase'} awai.install.sectors=${imgSectors||'500118192'}`);
}
if(mode==='persistent')script=script.replace('androidboot.mount_userdata=tmpfs','androidboot.mount_userdata=imgs');
if(['repair','reblock'].includes(mode))script=script.replace('module_blacklist=','awai.os_journal_repair=1 module_blacklist=');
if(mode==='reblock')script=script.replace('module_blacklist=','awai.reblock_small_images=1 module_blacklist=');
script=script.replace('echo Awai Android diagnostic LAN boot failed. Existing Nix disk was not selected.',`echo Awai Android ${mode} boot failed.`);
assert(script.length<=original.length,'Embedded region cannot grow');
b.write(script.padEnd(original.length,' '),start,'ascii');
const checksumAt=optional+64;b.writeUInt32LE(0,checksumAt);let checksum=0;
for(let i=0;i<b.length;i+=2){checksum+=(b[i]??0)|((b[i+1]??0)<<8);checksum=(checksum&0xffff)+(checksum>>>16);}
checksum=(checksum&0xffff)+(checksum>>>16);b.writeUInt32LE((checksum+b.length)>>>0,checksumAt);
await writeFile(output,b,{flag:'wx',mode:0o644});console.log(JSON.stringify({mode,sha256:sha(b),bytes:b.length,scriptRegion:{start,end},unsignedEngineeringImage:true}));
