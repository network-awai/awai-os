export PATH=/opt/homebrew/bin:$PATH
set -e
cd ~/awai-x-20261124/e2e; export SRC=${SRC:-src3}; I=~/github/workspaces/codex/awai-usb-writer/awai-pc-usb-installer-16b6941782f2.iso
rm -f new.iso run1-disk.qcow2; rm -rf ov2
A=$(bsdtar -xOf $I awai/archive.sha256 | cut -c1-64); R=$(bsdtar -xOf $I awai/install-image.sha256 | cut -c1-64)
python3 -I - "$A" "$R" <<'PY'
import sys,importlib.util,types,os
d=os.path.expanduser('~/awai-x-20261124/e2e/'+os.environ.get('SRC','src3')+'/installer'); sys.path.insert(0,d)
s=importlib.util.spec_from_file_location('bo',d+'/build-overlay.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
os.makedirs('ov2'); m.build_overlay(types.SimpleNamespace(archive_sha256=sys.argv[1],image_sha256=sys.argv[2]),'ov2')
a=types.SimpleNamespace(stock_iso='X',out='Y',image_zst='Z'); print(m.BOOT_FILES); print(' '.join(m.xorriso_command(a,'ov2')))
open('bootmap.txt','w').write('\n'.join('-map ov2/%s /%s'%(t,t) for t,_ in m.BOOT_FILES))
PY
xorriso -indev $I -outdev new.iso -boot_image any replay -overwrite on -rm /awai/install /awai/awai-pc-install.py /awai/archive.sha256 /awai/install-image.sha256 /sysrescue.d/700-awai-installer.yaml -- -map ov2/awai /awai -map ov2/sysrescue.d/700-awai-installer.yaml /sysrescue.d/700-awai-installer.yaml $(cat bootmap.txt | tr '\n' ' ') -commit 2>&1 | tail -3
bsdtar -tvf new.iso awai | awk '{print $5,$NF}' | head -24; bsdtar -xOf new.iso boot/grub/grubsrcd.cfg | grep -E 'menuentry|timeout|linux' | head
