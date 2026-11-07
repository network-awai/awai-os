// Local QEMU test of USB boot and the real installer's destructive-operation guards.
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, rm, copyFile, chmod, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const work = resolve(process.argv[2]);
const media = resolve(process.argv[3]);
const code = '/opt/homebrew/share/qemu/edk2-x86_64-code.fd';
const vars = '/opt/homebrew/share/qemu/edk2-i386-vars.fd';
const run = (program, args) => { const r = spawnSync(program, args, { encoding:'utf8' }); if (r.status !== 0) throw Error(`${program} failed: ${r.stderr}`); return r.stdout; };
await mkdir(work);
await copyFile(vars, join(work, 'vars.fd')); await chmod(join(work, 'vars.fd'), 0o644);
for (const [name, size] of [['target','60G'], ['small','2G']]) run('qemu-img', ['create','-q','-f','qcow2',join(work, `${name}.qcow2`),size]);
const sock = join(work, 'serial.sock'); await rm(sock, {force:true});
const machine = spawn('qemu-system-x86_64', [
 '-machine','q35','-accel','tcg,thread=multi','-cpu','max','-smp','6','-m','12288','-display','none',
 '-drive',`if=pflash,format=raw,readonly=on,file=${code}`,
 '-drive',`if=pflash,format=raw,file=${join(work,'vars.fd')}`,
 '-device','qemu-xhci,id=xhci','-device','virtio-vga',
 '-drive',`id=usb,if=none,format=raw,readonly=on,file=${media}`,
 '-device','usb-storage,bus=xhci.0,drive=usb,serial=AWAIUSBTEST,bootindex=1',
 '-drive',`id=target,if=none,format=qcow2,discard=unmap,detect-zeroes=unmap,file=${join(work,'target.qcow2')}`,
 '-device','virtio-blk-pci,drive=target,serial=AWAI-TARGET-1',
 '-drive',`id=small,if=none,format=qcow2,file=${join(work,'small.qcow2')}`,
 '-device','virtio-blk-pci,drive=small,serial=AWAI-SMALL-2',
 '-net','none','-monitor',`unix:${join(work,'monitor.sock')},server,nowait`,'-serial',`unix:${sock},server,nowait`,
], {stdio:['ignore','ignore','pipe']});
machine.stderr.on('data', data => appendFile(join(work,'qemu.stderr'),data));
const pause = ms => new Promise(r=>setTimeout(r,ms));
let serial;
for(let n=0;n<60;n++){try{serial=await new Promise((resolve,reject)=>{const s=createConnection(sock);s.once('connect',()=>resolve(s));s.once('error',reject)});break}catch{await pause(1000)}}
if(!serial){machine.kill();throw Error('serial socket unavailable')}
let buffer='', ended=false;
serial.on('data', data=>{buffer+=data.toString('utf8');appendFile(join(work,'serial.log'),data)});
machine.on('exit',()=>{ended=true});
async function expect(text,seconds=1800){const end=Date.now()+seconds*1000;while(Date.now()<end){const i=buffer.indexOf(text);if(i>=0){buffer=buffer.slice(i+text.length);console.log('PASS', text);return}if(ended)throw Error(`QEMU ended while waiting for ${text}`);await pause(500)}throw Error(`timeout waiting for ${text}`)}
const send = s => serial.write(`${s}\r`);
const prompt='press Enter to list disks again: ';
const bytes = name => JSON.parse(run('qemu-img',['map','-U','--output=json',join(work,`${name}.qcow2`)])).filter(e=>e.data).reduce((s,e)=>s+e.length,0);
try {
 await expect(prompt);
 if(bytes('target') || bytes('small')) throw Error('scratch disks changed before input');
 send('NOT-A-SERIAL'); await expect('No single disk has that serial',60); await expect(prompt,60);
 send('AWAI-SMALL-2'); await expect('too small',60); await expect(prompt,60);
 // This 6 GiB test media is rejected by the size guard before the mount guard.
 send('AWAIUSBTEST'); await expect('too small',60); await expect(prompt,60);
 send('AWAI-TARGET-1'); await expect('Type ERASE',60); send('no'); await expect('Stopped. Nothing was written.',60); await expect(prompt,60);
 if(bytes('target') || bytes('small')) throw Error('scratch disks changed during refusals');
 if (process.env.ALLOW_SCRATCH_WRITE !== '1') {
   console.log('PASS USB offline boot and refusal guards; write was not attempted');
 } else {
   send('AWAI-TARGET-1'); await expect('Type ERASE',60); send('ERASE'); await expect('INSTALLED on',7200);
   if(!bytes('target') || bytes('small')) throw Error('wrong scratch disk write result');
   console.log('PASS USB offline boot, guards, write and readback');
 }
} finally { serial.destroy(); machine.kill('SIGTERM'); }
