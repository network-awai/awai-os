import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,readlinkSync,readdirSync,lstatSync,mkdtempSync,mkdirSync,cpSync,writeFileSync,symlinkSync,renameSync,rmSync,realpathSync} from 'node:fs';
import {posix} from 'node:path';
const run=(p,a,options={})=>{const r=spawnSync(p,a,{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe'],...options});if(r.status!==0)throw Error(`${p} failed: ${(r.stderr||r.error?.message||'').slice(0,400)}`);return (r.stdout||'').trim();};
const systemPath=/^\/nix\/store\/[a-z0-9]{32}-nixos-system-[A-Za-z0-9._+-]+$/;
export function replaceShippedSource(source,destination,{directory=false,dereference=true}={}){
 const stage=mkdtempSync(posix.join(posix.dirname(destination),'.aiueos-source-'));
 try{
  const staged=stage+'/content';
  if(directory)cpSync(realpathSync(source),staged,{recursive:true,dereference});
  else writeFileSync(staged,readFileSync(source),{mode:0o644});
  // Replace the directory entry, never write through an existing store symlink.
  // A repeated USB update can have exactly the same source and target link.
  if(directory)rmSync(destination,{recursive:true,force:true});
  renameSync(staged,destination);
 }finally{rmSync(stage,{recursive:true,force:true});}
}
export function existingTarget(disk,rootUUID,bootUUID){
 const root=(disk.children||[]).find(x=>x.uuid===rootUUID&&x.fstype==='ext4');
 const boot=(disk.children||[]).find(x=>x.uuid===bootUUID&&x.fstype==='vfat');
 if(!root||!boot||root.label!=='MURAKUMO_ROOT'||boot.label!=='MURA_BOOT')throw Error('Not a NixOS UEFI installation on one disk.');
 return {root:root.path,boot:boot.path,rootUuid:rootUUID,bootUuid:bootUUID};
}
export function installedBinding(config){
 const root=config.match(/murakumo\.root_uuid=([a-f0-9-]{36})/)?.[1];
 const boot=config.match(/murakumo\.boot_uuid=([A-F0-9]{4}-[A-F0-9]{4})/)?.[1];
 if(!/offline-uefi\.nix/.test(config)||!root||!boot)throw Error('Installation UUID binding is missing. No update performed.');
 return {root,boot};
}
export function updateGuard({previous,pending,available,needed}){
 if(!systemPath.test(previous))throw Error('Previous NixOS generation is missing.');
 if(pending)throw Error('An update trial is pending. Boot the internal disk to recover first.');
 if(!Number.isFinite(available)||!Number.isSafeInteger(needed)||needed<=0||available<needed+2*1024**3)throw Error('Not enough free space. Data will not be erased.');
}
export function profileSystem(root,readlink=readlinkSync){
 let path='/nix/var/nix/profiles/system';
 for(let i=0;i<8;i++){const link=readlink(root+path);path=posix.resolve(posix.dirname(path),link);if(systemPath.test(path))return path;if(!path.startsWith('/nix/var/nix/profiles/'))break;}
 throw Error('Invalid installed system profile.');
}
export function verifyInstalledState(before,after){
 if(before.previous!==after.previous||JSON.stringify(before.binding)!==JSON.stringify(after.binding)||JSON.stringify(before.journal)!==JSON.stringify(after.journal))throw Error('Installed state changed. Boot the internal disk to complete recovery before updating.');
}
// Manual, owner-selected USB update. No partitioning, formatting, account reset,
// automatic-update journal replacement, or changes to NetworkManager secrets.
export async function updateFromUSB({ui,t,diskReason,fingerprint,offlineSystem,configureBoot}){
 if(process.getuid?.()!==0||!existsSync('/etc/murakumo/installation-media'))throw Error('USB media and root required.');
 if(!existsSync('/sys/firmware/efi'))throw Error('Restart this USB in UEFI mode to update an existing installation.');
 const inventory=()=>JSON.parse(run('lsblk',['--json','--tree','--bytes','--paths','--output','PATH,MAJ:MIN,SIZE,MODEL,SERIAL,WWN,TRAN,RM,HOTPLUG,RO,TYPE,MOUNTPOINTS,LABEL,UUID,FSTYPE'])).blockdevices;
 const disks=inventory().filter(d=>!diskReason(d,{uefi:true})&&(d.children||[]).some(x=>x.label==='MURAKUMO_ROOT'));
 if(!disks.length){ui.message(t('更新できるNixOSが見つかりません。新規インストールで代用しないでください。','No eligible NixOS installation found. Do not use a new installation to update.'));return;}
 const selected=ui.menu(t('更新する内蔵ディスクを選びます。設定・データは保持します。','Choose the internal NixOS disk to update. Settings and data are kept.'),disks.map(d=>[d.path,`${d.model||''} · ${d.serial||d.path}`]));
 if(!selected)return;
 const disk=disks.find(x=>x.path===selected);if(!disk||(disk.children||[]).filter(x=>x.label==='MURAKUMO_ROOT').length!==1)throw Error('Unknown or ambiguous disk.');
 const identity=fingerprint(disk),root=(disk.children||[]).find(x=>x.label==='MURAKUMO_ROOT');
 const mount=mkdtempSync('/mnt/aiueos-update-');let mounted=false,backup=null,previous=null;
 try{
  run('mount',['-o','ro,noload',root.path,mount]);mounted=true;
  for(const path of ['/etc','/etc/nixos','/boot','/nix','/nix/store','/nix/var','/nix/var/nix','/nix/var/nix/profiles','/var','/var/lib','/var/lib/aiueos-update','/var/lib/aiueos-usb-update'])if(existsSync(mount+path)){const s=lstatSync(mount+path);if(s.isSymbolicLink()||!s.isDirectory())throw Error('Unsafe installed directory: '+path);}
  const binding=installedBinding(readFileSync(mount+'/etc/nixos/configuration.nix','utf8'));
  const target=existingTarget(disk,binding.root,binding.boot);
  const partitions=inventory().flatMap(d=>d.children||[]);
  if(partitions.filter(p=>p.uuid===binding.root).length!==1||partitions.filter(p=>p.uuid===binding.boot).length!==1)throw Error('Duplicate installation UUIDs on connected disks.');
  previous=profileSystem(mount);
  if(!existsSync(mount+previous+'/init'))throw Error('Previous generation is incomplete.');
  run('mount',['-o','ro',target.boot,mount+'/boot']);
  const entries=mount+'/boot/loader/entries';
  if(!existsSync(entries)||!readdirSync(entries).some(n=>n.endsWith('.conf')&&readFileSync(entries+'/'+n,'utf8').includes('murakumo.root_uuid='+binding.root)))throw Error('Previous UUID-bound boot entry is missing.');
  if(Number(run('df',['--output=avail','-B1',mount+'/boot']).split('\n').at(-1))<128*1024**2)throw Error('The EFI partition needs at least 128 MiB free.');
  const journalPath=mount+'/var/lib/aiueos-update/journal.json';
  if(existsSync(journalPath)){const s=lstatSync(journalPath);if(s.isSymbolicLink()||!s.isFile()||s.uid!==0||(s.mode&0o077))throw Error('Unsafe update journal.');}
  const journal=existsSync(journalPath)?JSON.parse(readFileSync(journalPath,'utf8')):null;
  const system=offlineSystem(JSON.parse(readFileSync('/etc/murakumo/offline-systems.json','utf8')),true);
  const needed=JSON.parse(run('nix',['path-info','--json','--closure-size',system,'--extra-experimental-features','nix-command']));
  const bytes=(Array.isArray(needed)?needed[0]:Object.values(needed)[0]).closureSize;
  if(!Number.isSafeInteger(bytes)||bytes<=0)throw Error('Invalid closure size.');
  const available=Number(run('df',['--output=avail','-B1',mount]).split('\n').at(-1));
  updateGuard({previous,pending:journal?.pending,available,needed:bytes});
  ui.busy(t('USB内の更新データを検証しています。内蔵ディスクはまだ変更していません。','Verifying the USB update data. The internal disk has not been changed.'));
  const closure=run('nix-store',['--query','--requisites',system]).split('\n');
  run('nix-store',['--verify-path',...closure]);
  const choice=ui.menu(t('NixOSを更新します。端末ID・Wi-Fi・アカウント・保存データと以前の起動世代を保持します。電源を接続してください。','Update NixOS. Device identity, Wi-Fi, account, stored data and the previous boot generation are retained. Connect AC power.'),[['apply',t('更新する','Update')],['back',t('戻る','Back')]]);
  if(choice!=='apply')return;
  const current=inventory().find(x=>x.path===selected);
  // Expected mount belongs to this update; all other identity fields must match.
  if(!current||fingerprint(current)!==identity)throw Error('Disk identity changed.');
  for(const [path,uuid] of [[target.root,binding.root],[target.boot,binding.boot]])if(run('blkid',['-s','UUID','-o','value',path])!==uuid)throw Error('Filesystem identity changed.');
  run('umount',['--recursive',mount]);mounted=false;
  run('mount',[target.root,mount]);mounted=true;
  run('mount',[target.boot,mount+'/boot']);
  // An ext4 recovery replay on the writable mount can reveal a newer journal
  // or generation than the read-only preflight. Never overwrite that history.
  verifyInstalledState({previous,binding,journal},{previous:profileSystem(mount),binding:installedBinding(readFileSync(mount+'/etc/nixos/configuration.nix','utf8')),journal:existsSync(journalPath)?JSON.parse(readFileSync(journalPath,'utf8')):null});
  backup=mount+'/var/lib/aiueos-usb-update/'+Date.now();mkdirSync(backup,{recursive:true,mode:0o700});
  cpSync(mount+'/boot',backup+'/boot',{recursive:true});
  cpSync(mount+'/etc/nixos',backup+'/nixos',{recursive:true});
  mkdirSync(mount+'/nix/var/nix/gcroots/aiueos-usb-update',{recursive:true});
  symlinkSync(previous,mount+'/nix/var/nix/gcroots/aiueos-usb-update/'+Date.now());
  writeFileSync(backup+'/receipt.json',JSON.stringify({schema:'aiueos.usb-update.v1',previous,target:system,rootUuid:binding.root,bootUuid:binding.boot,state:'prepared'}),{mode:0o600});
  ui.busy(t('USBから更新しています。電源を切らないでください。','Updating from USB. Keep the power connected.'));
  // nixos-install with an existing root installs a new generation; it does not
  // partition or format. No channel fetch or root password prompt is allowed.
  run('nixos-install',['--root',mount,'--system',system,'--no-root-passwd','--no-channel-copy'],{env:{...process.env,NIX_CONFIG:'substituters =\nfallback = false\nconnect-timeout = 1\n'}});
  configureBoot(mount,{uefi:true,rootUuid:binding.root,bootUuid:binding.boot});
  // Retain the installed UUID/hardware configuration and update only shipped
  // source modules. Never replace host policy, credentials or identity files.
  for(const name of readdirSync('/etc/murakumo'))if(/\.(nix|mjs|js|svg|json|html|py|txt|cljk|tar\.gz)$/.test(name)&&!['configuration.example.nix','offline-systems.json','voice-policy.json'].includes(name))replaceShippedSource('/etc/murakumo/'+name,mount+'/etc/nixos/'+name);
  replaceShippedSource('/etc/murakumo/update-policy-runtime',mount+'/etc/nixos/update-policy-runtime',{directory:true});
  // The USB source is newer than production sequence 4. Preserve all journal
  // fields and prevent an older published image from replacing this manual update.
  if(journal){const next={...journal,revision:(journal.revision||0)+1,highestSequence:Math.max(journal.highestSequence||0,4)};writeFileSync(journalPath+'.usb-new',JSON.stringify(next),{mode:0o600});run('mv',[journalPath+'.usb-new',journalPath]);}
  // Old generated entries remain available from the firmware boot menu.
  // Keep previous kernels/initrds as well as their entries. Newer files win.
  cpSync(backup+'/boot',mount+'/boot',{recursive:true,force:false,errorOnExist:false});
  writeFileSync(backup+'/receipt.json',JSON.stringify({schema:'aiueos.usb-update.v1',previous,target:system,rootUuid:binding.root,bootUuid:binding.boot,state:'installed'}),{mode:0o600});
  run('sync',[]);
 }catch(e){
  // Recover boot files only. The retained profile, user data and update journal
  // are never deleted. If recovery itself fails, stop and show maintenance.
  if(backup&&mounted){
   run('nix-env',['--store',mount,'--profile',mount+'/nix/var/nix/profiles/system','--set',previous]);
   cpSync(backup+'/boot',mount+'/boot',{recursive:true});
   replaceShippedSource(backup+'/nixos',mount+'/etc/nixos',{directory:true,dereference:false});run('sync',[]);
  }
  throw e;
 }finally{if(mounted)run('umount',['--recursive',mount]);}
 ui.message(t('更新が完了しました。再起動時にUSBを外してください。設定とデータは保持されています。','Update completed. Remove the USB when restarting. Settings and data are retained.'));
 run('systemctl',['reboot']);
 return true;
}
