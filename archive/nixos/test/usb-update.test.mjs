import test from 'node:test';import assert from 'node:assert/strict';
import {existingTarget,installedBinding,updateGuard,profileSystem,verifyInstalledState,replaceShippedSource} from '../usb-update.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,lstatSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const root='12345678-1234-1234-1234-123456789abc',boot='1234-ABCD';
const previous='/nix/store/'+ 'a'.repeat(32)+'-nixos-system-murakumo-node-26.05';
const disk={children:[{path:'/dev/vda2',uuid:root,fstype:'ext4',label:'MURAKUMO_ROOT'},{path:'/dev/vda1',uuid:boot,fstype:'vfat',label:'MURA_BOOT'}]};
test('requires root and EFI partition on same selected disk with exact binding',()=>{assert.equal(existingTarget(disk,root,boot).boot,'/dev/vda1');assert.throws(()=>existingTarget({children:[disk.children[0]]},root,boot));assert.throws(()=>existingTarget(disk,root,'4321-ABCD'));});
test('reads retained installation UUIDs; rejects generic or BIOS config',()=>{assert.deepEqual(installedBinding(`imports = [ ./offline-uefi.nix ]; murakumo.root_uuid=${root} murakumo.boot_uuid=${boot}`),{root,boot});assert.throws(()=>installedBinding('imports = [ ./offline-bios.nix ];'));});
test('refuses pending recovery, missing generation and insufficient space',()=>{assert.doesNotThrow(()=>updateGuard({previous,pending:null,available:5*2**30,needed:2**30}));assert.throws(()=>updateGuard({previous,pending:{system:previous},available:9*2**30,needed:2**30}));assert.throws(()=>updateGuard({previous:'/etc/passwd',available:9*2**30,needed:2**30}));assert.throws(()=>updateGuard({previous,available:2**30,needed:2**30}));});
test('resolves profiles inside mounted root without following host absolute store symlinks',()=>{let reads=[];assert.equal(profileSystem('/mnt/target',p=>{reads.push(p);return p.endsWith('/system')?'system-4-link':previous;}),previous);assert.deepEqual(reads,['/mnt/target/nix/var/nix/profiles/system','/mnt/target/nix/var/nix/profiles/system-4-link']);assert.throws(()=>profileSystem('/mnt/target',()=>'/etc/passwd'));});
test('invalid space evidence cannot allow a write',()=>{assert.throws(()=>updateGuard({previous,available:NaN,needed:1024}));assert.throws(()=>updateGuard({previous,available:2**40,needed:NaN}));});
test('filesystem recovery cannot make USB update overwrite newer generation or replay history',()=>{const before={previous,binding:{root,boot},journal:{highestSequence:4,pending:null}};assert.doesNotThrow(()=>verifyInstalledState(before,structuredClone(before)));assert.throws(()=>verifyInstalledState(before,{...before,journal:{highestSequence:8,pending:null}}));assert.throws(()=>verifyInstalledState(before,{...before,previous:'/nix/store/'+'b'.repeat(32)+'-nixos-system-new'}));});
test('repeated USB source replacement never follows or mutates identical store symlinks',()=>{
 const d=mkdtempSync(join(tmpdir(),'usb-source-'));try{
  writeFileSync(d+'/store-file','original');symlinkSync(d+'/store-file',d+'/source');symlinkSync(d+'/store-file',d+'/installed');
  replaceShippedSource(d+'/source',d+'/installed');replaceShippedSource(d+'/source',d+'/installed');
  assert.equal(lstatSync(d+'/installed').isSymbolicLink(),false);assert.equal(readFileSync(d+'/installed','utf8'),'original');assert.equal(readFileSync(d+'/store-file','utf8'),'original');
  mkdirSync(d+'/store-runtime');writeFileSync(d+'/store-runtime/module','runtime');symlinkSync(d+'/store-runtime',d+'/runtime-source');symlinkSync(d+'/store-runtime',d+'/runtime-installed');
  replaceShippedSource(d+'/runtime-source',d+'/runtime-installed',{directory:true});replaceShippedSource(d+'/runtime-source',d+'/runtime-installed',{directory:true});
  assert.equal(lstatSync(d+'/runtime-installed').isSymbolicLink(),false);assert.equal(readFileSync(d+'/runtime-installed/module','utf8'),'runtime');assert.equal(readFileSync(d+'/store-runtime/module','utf8'),'runtime');
 }finally{rmSync(d,{recursive:true,force:true});}
});
test('source rollback replaces a complete directory while preserving saved symlinks',()=>{
 const d=mkdtempSync(join(tmpdir(),'usb-source-'));try{
  mkdirSync(d+'/backup');mkdirSync(d+'/installed');writeFileSync(d+'/backup/configuration.nix','host UUIDs');symlinkSync('/nix/store/old-source',d+'/backup/module');writeFileSync(d+'/installed/partial','new');
  replaceShippedSource(d+'/backup',d+'/installed',{directory:true,dereference:false});
  assert.equal(readFileSync(d+'/installed/configuration.nix','utf8'),'host UUIDs');assert.equal(lstatSync(d+'/installed/module').isSymbolicLink(),true);
 }finally{rmSync(d,{recursive:true,force:true});}
});
