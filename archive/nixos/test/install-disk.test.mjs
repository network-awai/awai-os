import test from 'node:test';
import assert from 'node:assert/strict';
import {diskReason, fingerprint, verifyDisk, partitionPath, targetConfiguration, bootParameters, patchBootEntry, offlineSystem, ROOT_LABEL, BOOT_LABEL} from '../scripts/install-disk.mjs';
const nvme = {path:'/dev/nvme0n1', 'maj:min':'259:0', type:'disk', size:512*1024**3, model:'Internal SSD', serial:'NVME-A', wwn:'id-a', tran:'nvme', rm:false, hotplug:false, ro:false, mountpoints:[null], children:[{path:'/dev/nvme0n1p1',type:'part',mountpoints:[null],fstype:'ntfs'}]};
test('unmounted Windows disk is eligible, boot USB is never eligible', () => {
  assert.equal(diskReason(nvme), null);
  for (const extra of [{tran:'usb'},{rm:true},{hotplug:1},{ro:true},{size:8*1024**3},{size:null},{path:'/dev/loop0',type:'loop'}]) assert.ok(diskReason({...nvme,...extra}));
});
test('every mounted child, swap, mapper or installer backing disk is refused', () => {
  for (const child of [{type:'part',mountpoints:['/iso']},{type:'part',mountpoints:['/nix/.ro-store']},{type:'part',mountpoints:['[SWAP]']},{type:'part',children:[{type:'crypt',mountpoints:[null]}]},{type:'lvm',mountpoints:[null]}]) assert.ok(diskReason({...nvme,children:[child]}));
  assert.ok(diskReason({...nvme,mountpoints:['/']}));
});
test('a changed or newly mounted disk is refused after approval', () => {
  const id = fingerprint(nvme);
  assert.equal(verifyDisk([nvme],nvme.path,id),nvme);
  for (const extra of [{serial:'NVME-B'},{wwn:'id-b'},{size:nvme.size/2},{'maj:min':'259:3'},{ro:1},{children:[{type:'part',mountpoints:['/mnt']}]}]) assert.throws(()=>verifyDisk([{...nvme,...extra}],nvme.path,id));
  assert.throws(()=>verifyDisk([],nvme.path,id));
});
test('NVMe/eMMC and SATA/virtio partition paths are correct', () => {
  for (const [disk,path] of [['/dev/nvme0n1','/dev/nvme0n1p2'],['/dev/mmcblk0','/dev/mmcblk0p2'],['/dev/sda','/dev/sda2'],['/dev/vda','/dev/vda2']]) assert.equal(partitionPath(disk,2),path);
});
test('NVMe is refused in BIOS mode before any destructive preparation', () => {
  assert.equal(diskReason(nvme, {uefi:true}), null);
  assert.match(diskReason(nvme, {uefi:false}), /UEFI/);
  assert.throws(()=>verifyDisk([nvme],nvme.path,fingerprint(nvme),{uefi:false}));
  assert.equal(diskReason({...nvme,path:'/dev/sda',tran:'sata'},{uefi:false}),null);
});
test('installed configuration imports the shipped mode without host compilation', () => {
  assert.match(targetConfiguration({uefi:true,rootUuid:'01010101-0202-0303-0404-050505050505',bootUuid:'1234-ABCD'}), /offline-uefi.nix/);
  assert.match(targetConfiguration({uefi:false,rootUuid:'01010101-0202-0303-0404-050505050505'}), /offline-bios.nix/);
});
test('boot entries use installation UUIDs and replace only previous UUID parameters', () => {
  const options={uefi:true,rootUuid:'01010101-0202-0303-0404-050505050505',bootUuid:'1234-ABCD'};
  const result=patchBootEntry('title NixOS\noptions init=/nix/store/example/init quiet murakumo.root_uuid=old\n',options);
  assert.match(result,/quiet murakumo.root_uuid=01010101/);
  assert.match(result,/murakumo.boot_uuid=1234-ABCD/);
  assert.doesNotMatch(result,/=old/);
  assert.match(patchBootEntry(' linux /kernel init=/init\n',{...options,uefi:false}),/murakumo.root_uuid=/);
  assert.throws(()=>patchBootEntry('title only',options));
  for(const change of [{rootUuid:'../../sda'},{rootUuid:'bad value'},{bootUuid:'ABCD;EFGH'}]) assert.throws(()=>bootParameters({...options,...change}));
});
test('offline manifest must identify the supported shipped system and labels', () => {
  const manifest={version:2,rootLabel:ROOT_LABEL,bootLabel:BOOT_LABEL,
    uefi:'/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-nixos-system-murakumo-node-26.05',
    bios:'/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-nixos-system-murakumo-node-26.05'};
  assert.equal(offlineSystem(manifest,true),manifest.uefi);
  assert.equal(offlineSystem(manifest,false),manifest.bios);
  for (const change of [{version:1},{rootLabel:'other'},{bootLabel:'other'},{uefi:undefined},{uefi:'/tmp/system'},{uefi:manifest.uefi+';reboot'}]) {
    assert.throws(()=>offlineSystem({...manifest,...change},true));
  }
});
