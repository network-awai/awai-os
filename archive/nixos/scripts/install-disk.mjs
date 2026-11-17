#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, copyFileSync, writeFileSync, realpathSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

import {fileURLToPath} from 'node:url';

const MIN_SIZE = 16 * 1024 ** 3;
const truth = x => x === true || x === 1 || x === '1';
const tree = disk => [disk, ...(disk.children || []).flatMap(tree)];
export function diskReason(disk, {uefi = true} = {}) {
  if (disk.type !== 'disk' || !/^\/dev\/(nvme\d+n\d+|sd[a-z]+|vd[a-z]+|mmcblk\d+)$/.test(disk.path || '')) return 'unsupported device';
  if (!uefi && disk.path.startsWith('/dev/nvme')) return 'NVMe installation requires UEFI boot';
  if (truth(disk.ro)) return 'read only';
  if (disk.tran === 'usb' || truth(disk.rm) || truth(disk.hotplug)) return 'USB/removable/hotplug';
  if (Number(disk.size) < MIN_SIZE || !Number.isSafeInteger(Number(disk.size))) return 'requires at least 16 GiB';
  if (tree(disk).some(d => (d.mountpoints || []).some(Boolean) || !['disk', 'part'].includes(d.type))) return 'mounted, swap, or mapped device';
  return null;
}
export function fingerprint(disk) {
  return JSON.stringify(['path', 'maj:min', 'size', 'model', 'serial', 'wwn', 'tran', 'rm', 'hotplug', 'ro'].map(k => disk[k] ?? null));
}
export function verifyDisk(disks, selected, identity, options) {
  const disk = disks.find(d => d.path === selected);
  if (!disk || diskReason(disk, options) || fingerprint(disk) !== identity) throw Error('Target disk changed or is now in use. Nothing will be erased.');
  return disk;
}
export function partitionPath(disk, number) { return `${disk}${/\d$/.test(disk) ? 'p' : ''}${number}`; }
export const ROOT_LABEL = 'MURAKUMO_ROOT';
export const BOOT_LABEL = 'MURA_BOOT';
const ROOT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BOOT_UUID = /^[0-9A-F]{4}-[0-9A-F]{4}$/;
export function bootParameters({uefi, rootUuid, bootUuid}) {
  if (!ROOT_UUID.test(rootUuid || '') || (uefi && !BOOT_UUID.test(bootUuid || ''))) throw Error('Invalid installation UUID.');
  return [`murakumo.root_uuid=${rootUuid}`, ...(uefi ? [`murakumo.boot_uuid=${bootUuid}`] : [])];
}
export function patchBootEntry(content, options) {
  const params = bootParameters(options);
  let count = 0;
  const patched = content.replace(options.uefi ? /^(options\s+)(.*)$/gm : /^(\s*linux(?:efi)?\s+)(.*)$/gm, (_, prefix, value) => {
    count++;
    return prefix + value.split(/\s+/).filter(x => !/^murakumo\.(root|boot)_uuid=/.test(x)).concat(params).join(' ');
  });
  if (!count) throw Error('No kernel boot entry was generated.');
  return patched;
}
export function configureBoot(mount, options) {
  const files = options.uefi
    ? readdirSync(`${mount}/boot/loader/entries`).filter(n => /^nixos.*\.conf$/.test(n)).map(n => `${mount}/boot/loader/entries/${n}`)
    : [`${mount}/boot/grub/grub.cfg`];
  if (!files.length) throw Error('No installed boot entries.');
  for (const file of files) writeFileSync(file, patchBootEntry(readFileSync(file, 'utf8'), options));
}
export function offlineSystem(manifest, uefi) {
  const system = manifest[uefi ? 'uefi' : 'bios'];
  if (manifest.version !== 2 || manifest.rootLabel !== ROOT_LABEL || manifest.bootLabel !== BOOT_LABEL ||
      !/^\/nix\/store\/[a-z0-9]{32}-nixos-system-[A-Za-z0-9._+-]+$/.test(system || '')) {
    throw Error('Invalid offline OS manifest. Nothing erased.');
  }
  return system;
}
export function targetConfiguration(options) {
  const params = bootParameters(options);
  return `{ ... }: { imports = [ ./offline-${options.uefi ? 'uefi' : 'bios'}.nix ]; boot.kernelParams = ${JSON.stringify(params).replaceAll(',', ' ')}; }\n`;
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${program} failed (${result.status}).`);
  return result.stdout?.toString().trim();
}
function capture(program, args, options = {}) { return run(program, args, {...options, stdio: ['pipe', 'pipe', 'inherit']}); }
function inventory() {
  return JSON.parse(capture('lsblk', ['--json', '--tree', '--bytes', '--paths', '--output', 'PATH,MAJ:MIN,SIZE,MODEL,SERIAL,WWN,TRAN,RM,HOTPLUG,RO,TYPE,MOUNTPOINTS,LABEL,UUID'])).blockdevices;
}
function dialog(args, {allowCancel = false} = {}) {
  const result = spawnSync('dialog', ['--clear', '--stdout', '--title', 'NixOS installation', ...args], {stdio: ['inherit', 'pipe', 'inherit']});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowCancel) return null;
    throw Error('Cancelled. No further installation steps will run.');
  }
  return result.stdout.toString();
}
async function main() {
  if (process.getuid() !== 0) throw Error('Run as root.');
  // The launcher is deliberately available only on the installation medium.
  if (!existsSync('/etc/murakumo/installation-media')) throw Error('This is not Murakumo installation media.');
  const {chooseLanguage} = await import("/etc/murakumo/language.mjs");
  const {dialogUI, setupNetwork, text} = await import("/etc/murakumo/network-setup.mjs");
  chooseLanguage(dialogUI("installer"));
  for (;;) {
  const mode = dialogUI('installer').menu(text('NixOSを更新、または新しくインストールします。更新は設定とデータを保持します。', 'Update NixOS or install a new system. Updates preserve settings and data.'), [
    ['remote', text('8桁コードで別のPCから接続・Kekkai SSH（Passkey不要）', 'Connect another PC / Kekkai SSH with 8 digits (no Passkey)')],
    ['update', text('既存NixOSを更新（データを保持）', 'Update existing NixOS (keep data)')],
    ['install', text('新規インストール（選択したディスクを消去）', 'New installation (erase selected disk)')],
    ['shutdown', text('電源を切る', 'Shut down')],
  ]);
  if (mode == null) continue;
  if (mode === 'remote') {
    if (await setupNetwork(dialogUI('installer')) === 'back') continue;
    const {showRemote}=await import('/etc/murakumo/remote-ui.mjs');
    await showRemote(dialogUI('installer'),text);continue;
  }
  if (mode === 'shutdown') { run('systemctl', ['poweroff']); return; }
  if (mode === 'update') { const {updateFromUSB}=await import('/etc/murakumo/usb-update.mjs'); if(await updateFromUSB({ui:dialogUI('installer'),t:text,diskReason,fingerprint,offlineSystem,configureBoot}))return; continue; }
  if (mode !== 'install') throw Error('Unknown installation action.');
  break;
  }
  await setupNetwork({stage: "installer"});
  const uefi = existsSync('/sys/firmware/efi');
  let selected, target, identity, system, directory, configFiles, rootUuid, bootUuid;
  for (;;) {
    const disks = inventory(), eligible = disks.filter(d => !diskReason(d, {uefi}));
    if (!eligible.length) throw Error('No unused internal disk of at least 16 GiB. NVMe requires restarting with the UEFI USB entry. Use the recovery console to inspect disks.');
    selected = dialog(['--menu', text(`起動方式：${uefi ? 'UEFI' : 'BIOS（NVMeにはUEFI起動が必要です）'}。インストール先の内蔵ディスクを選んでください。Windowsを含む、選んだディスクの全データを消去します。USBは対象外です。電源を接続してください。`, `Boot mode: ${uefi ? 'UEFI' : 'BIOS (NVMe requires UEFI)'}. Choose the internal disk to REPLACE. All data including Windows will be erased. USB is excluded. Connect AC power.`), '0', '0', '8', ...eligible.flatMap(d => [d.path, `${String(d.model || '').trim()} | ${(Number(d.size) / 1024 ** 3).toFixed(1)} GiB | ${d.serial || d.wwn || 'no serial'}`])], {allowCancel:true});
    if(selected===null){await setupNetwork({stage:"installer"});continue;}
    target = eligible.find(d => d.path === selected);
    if (!target || realpathSync(selected) !== selected) throw Error('Invalid target selection.');
    identity = fingerprint(target);
    system = offlineSystem(JSON.parse(readFileSync('/etc/murakumo/offline-systems.json', 'utf8')), uefi);
    dialog(['--infobox', text('USB内のOSを確認しています…', 'Checking the offline OS…'), '0', '0']);
    const closure = capture('nix-store', ['--query', '--requisites', system]).split('\n').filter(Boolean);
    if (!closure.length || closure.some(p => !existsSync(p))) throw Error('Offline OS is incomplete. Nothing erased.');
    run('nix-store', ['--check-validity', ...closure]);
    directory = mkdtempSync(join(tmpdir(), 'murakumo-install-'));
    configFiles = ['node-base.nix', 'update-service.nix', 'update-release.mjs', 'update-controller.mjs', 'update-linux.mjs', 'update-policy.mjs', 'update-defaults.json', 'node-status.mjs', 'account-link.mjs', 'offline-base.nix', 'offline-uefi.nix', 'offline-bios.nix', 'console-ui.nix', 'network-setup.mjs', 'setup-ui.mjs', 'registration-ui.mjs', 'graphical-ui.js', 'graphical-dialog.mjs', 'murakumo-logo.svg', 'local-setup.mjs', 'language.mjs', 'acoustic-code.mjs', 'setup-sound.mjs', 'sound-link.html', 'voice-runtime.nix', 'voice-agent.mjs', 'voice-control.mjs', 'voice-policy.json', 'voice-tts.py', 'voice-NOTICES.txt', 'ble-setup.nix', 'ble-controller.mjs', 'ble-protocol.mjs', 'ble-gatt.js', 'ble-client.mjs', 'ble-setup.html'];
    configFiles.push('kekkai-runtime.nix','kekkai-runtime.tar.gz','kekkai-bootstrap.cljk','kekkai-setup-client.mjs','remote-access.nix','remote-access.mjs','remote-ui.mjs','remote-access.html','remote-client.js');
    configFiles.push('update-ui.mjs','production-update-trust.json');
    for (const name of configFiles) copyFileSync(`/etc/murakumo/${name}`, join(directory, name));
    run('cp', ['-a', '/etc/murakumo/update-policy-runtime', join(directory, 'update-policy-runtime')]);
    rootUuid = randomUUID(); bootUuid = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const otherUuids = disks.filter(d => d.path !== selected).flatMap(tree).map(d => String(d.uuid || '').toUpperCase());
    if (otherUuids.includes(rootUuid.toUpperCase()) || otherUuids.includes(`${bootUuid.slice(0,4)}-${bootUuid.slice(4)}`)) throw Error('Generated UUID conflicts with another disk. Nothing erased.');
    run('nixos-generate-config', ['--no-filesystems', '--dir', directory]);
    // Retain hardware detection for later review; the shipped system is generic.
    run('mv', [join(directory, 'hardware-configuration.nix'), join(directory, 'detected-hardware.nix')]);
    writeFileSync(join(directory, 'configuration.nix'), targetConfiguration({uefi, rootUuid, bootUuid: `${bootUuid.slice(0,4)}-${bootUuid.slice(4)}`}));
    const phrase = `ERASE ${selected}`;
    const approval = dialog(['--inputbox', text(`消去するディスク：${selected}\n機種：${String(target.model || '').trim()}\n容量：${(Number(target.size) / 1024 ** 3).toFixed(1)} GiB\n製造番号：${target.serial || target.wwn || '不明'}\nWindowsを含む全データが失われます。\n次の文字をそのまま入力してください：${phrase}`, `Ready to replace ${selected}\nModel: ${String(target.model || '').trim()}\nSize: ${(Number(target.size) / 1024 ** 3).toFixed(1)} GiB\nSerial: ${target.serial || target.wwn || 'not available'}\nALL DATA INCLUDING WINDOWS WILL BE LOST.\nType exactly: ${phrase}`), '0', '0'], {allowCancel:true});
    if (approval === null) {rmSync(directory, {recursive:true, force:true});continue;}
    if (approval !== phrase) throw Error('Erase confirmation did not match. Nothing erased.');
    break;
  }
  run('udevadm', ['settle']);
  const current = inventory();
  verifyDisk(current, selected, identity, {uefi});
  dialog(['--infobox', text('選択したディスクを準備しています…\n電源を切らずにお待ちください。', 'Preparing the selected disk…'), '0', '0']);
  // No shell interpolation and no device auto-selection beyond this boundary.
  run('parted', ['--script', selected, 'mklabel', 'gpt', ...(uefi
    ? ['mkpart', 'ESP', 'fat32', '1MiB', '513MiB', 'set', '1', 'esp', 'on', 'mkpart', 'root', 'ext4', '513MiB', '100%']
    : ['mkpart', 'biosboot', '1MiB', '3MiB', 'set', '1', 'bios_grub', 'on', 'mkpart', 'root', 'ext4', '3MiB', '100%'])]);
  run('partprobe', [selected]);
  run('udevadm', ['settle']);
  const root = partitionPath(selected, 2), boot = partitionPath(selected, 1);
  run('mkfs.ext4', ['-F', '-U', rootUuid, '-L', ROOT_LABEL, root]);
  if (uefi) run('mkfs.fat', ['-F', '32', '-i', bootUuid, '-n', BOOT_LABEL, boot]);
  run('udevadm', ['trigger', '--subsystem-match=block']);
  run('udevadm', ['settle']);
  const expectedBootUuid = `${bootUuid.slice(0,4)}-${bootUuid.slice(4)}`;
  if (capture('blkid', ['-s', 'UUID', '-o', 'value', root]) !== rootUuid || (uefi && capture('blkid', ['-s', 'UUID', '-o', 'value', boot]) !== expectedBootUuid)) throw Error('Formatted filesystem UUID did not match.');
  const mount = mkdtempSync('/mnt/murakumo-install-');
  let mounted = false;
  try {
    run('mount', [root, mount]); mounted = true;
    run('mkdir', ['-p', `${mount}/etc/nixos`, `${mount}/etc/NetworkManager`, `${mount}/boot`]);
    if (uefi) run('mount', [boot, `${mount}/boot`]);
    for (const name of ['configuration.nix', 'detected-hardware.nix', ...configFiles]) copyFileSync(join(directory, name), `${mount}/etc/nixos/${name}`);
    run('mkdir', ['-p', `${mount}/var/lib/murakumo`]);
    run('chmod', ['0700', `${mount}/var/lib/murakumo`]);
    run('cp', ['-a', join(directory, 'update-policy-runtime'), `${mount}/etc/nixos/update-policy-runtime`]);
    if (existsSync('/var/lib/murakumo/ui-language')) copyFileSync('/var/lib/murakumo/ui-language', `${mount}/var/lib/murakumo/ui-language`);
    // Copy persistent Wi-Fi profiles, never print them or put them in the Nix store.
    if (existsSync('/etc/NetworkManager/system-connections')) run('cp', ['-a', '/etc/NetworkManager/system-connections', `${mount}/etc/NetworkManager/`]);
    // Preserve physically approved administration keys and the pinned local overlay identity.
    if (existsSync('/etc/ssh/authorized_keys.d/murakumo-admin')) {
      run('mkdir', ['-p', `${mount}/etc/ssh/authorized_keys.d`]);
      run('cp', ['-a', '/etc/ssh/authorized_keys.d/murakumo-admin', `${mount}/etc/ssh/authorized_keys.d/`]);
      if (existsSync('/var/lib/murakumo-remote')) run('cp', ['-a', '/var/lib/murakumo-remote', `${mount}/var/lib/`]);
      // Keep the approved host identity: otherwise the same overlay alias would
      // correctly fail SSH host-key verification after installing to disk.
      for (const name of readdirSync('/etc/ssh').filter(n => /^ssh_host_(ed25519|rsa|ecdsa)_key(?:\.pub)?$/.test(n)))
        run('cp', ['-a', `/etc/ssh/${name}`, `${mount}/etc/ssh/${name}`]);
    }
    dialog(['--infobox', text('NixOSをインストールしています…\nネット接続は不要です。電源を切らずにお待ちください。', 'Installing NixOS… Keep the power connected.'), '0', '0']);
    run('nixos-install', ['--root', mount, '--system', system, '--no-root-passwd', '--no-channel-copy'], {env: {...process.env, NIX_CONFIG: 'substituters =\nfallback = false\nconnect-timeout = 1\n'}});
    if (!uefi) run('grub-install', ['--target=i386-pc', `--boot-directory=${mount}/boot`, selected]);
    configureBoot(mount, {uefi, rootUuid, bootUuid: expectedBootUuid});
    run('sync', []);
  } finally {
    if (mounted) run('umount', ['--recursive', mount]);
  }
  dialog(['--msgbox', text('インストールが完了しました。次へ進むと再起動します。再起動時にUSBを外し、内蔵ディスクから起動してください。次の画面で、この端末だけで完了するか、アカウントに連携するかを選べます。', 'Installation completed. Continue to restart, remove the USB, and boot the internal disk. Next, choose local setup or account linking.'), '0', '0']);
  run('systemctl', ['reboot']);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(error => { console.error(`\nInstallation stopped: ${error.message}\nDo not repeat an erase if installation failed after formatting. Use Alt+F2 for recovery and logs.`); try {
      const ja = process.env.MURAKUMO_UI_LANG === 'ja';
      dialog(['--msgbox', ja ? `インストールを停止しました。\n${error.message}\n消去後に失敗した場合、消去を繰り返さないでください。Alt+F2で保守画面へ移動できます。` : `Installation stopped: ${error.message}\nDo not repeat an erase after formatting. Alt+F2 opens maintenance.`, '0', '0']);
    } catch {}
    process.exitCode = 1; });
}
