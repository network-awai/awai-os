import {targetConfiguration} from '../scripts/install-disk.mjs';
import {mkdirSync, writeFileSync, copyFileSync} from 'node:fs';
import {join} from 'node:path';
const [repo, dir] = process.argv.slice(2);
for (const mode of ['bios', 'uefi']) {
  const destination = join(dir, mode);
  mkdirSync(destination);
  writeFileSync(join(destination, 'hardware-configuration.nix'), '{ ... }: { boot.initrd.availableKernelModules = [ "virtio_pci" "virtio_blk" "nvme" ]; }\n');
  for (const name of ['node-base.nix', 'account-link.mjs', 'offline-base.nix', 'offline-uefi.nix', 'offline-bios.nix', 'console-ui.nix', 'network-setup.mjs', 'setup-ui.mjs', 'registration-ui.mjs', 'graphical-ui.js', 'graphical-dialog.mjs', 'murakumo-logo.svg', 'local-setup.mjs', 'language.mjs', 'acoustic-code.mjs', 'setup-sound.mjs', 'sound-link.html', 'voice-runtime.nix', 'voice-agent.mjs', 'voice-control.mjs', 'voice-policy.json', 'voice-tts.py', 'voice-NOTICES.txt']) copyFileSync(join(repo, 'archive/nixos', name), join(destination, name));
  writeFileSync(join(destination, 'configuration.nix'), targetConfiguration({uefi: mode === 'uefi', disk: mode === 'uefi' ? '/dev/nvme0n1' : '/dev/vda', rootUuid: '01010101-0202-0303-0404-050505050505', bootUuid: '1234-ABCD'}));
}
