#!/bin/bash
# AWAI-3064 prep: run the A/B reference device (lineage_virtio_x86_64) under KVM for the OTA check.
#   ota-kvm.sh prepare   copy v1 disk to a working disk, create userdata disk, enable insecure adb in grubenv (VM only)
#   ota-kvm.sh start | stop | status
set -uo pipefail
D=/root/awai-3064-ota; W=$D/work; mkdir -p $W; ADB=127.0.0.1:5565
case ${1:-} in
prepare)
  cp --sparse=always -f $D/v1-disk-vda.img $W/vda.img
  qemu-img create -q -f qcow2 $W/vdb.qcow2 16G
  cp -f /usr/share/OVMF/OVMF_VARS_4M.fd $W/vars.fd
  # VM only: let adb in without the on-screen confirmation, through the device's own grubenv option.
  L=$(losetup -fP --show $W/vda.img); sleep 1; P=$(lsblk -lno NAME,LABEL $L | awk '$2=="PERSIST"{print $1}')
  mkdir -p $W/mnt; mount /dev/$P $W/mnt; ls -la $W/mnt
  [ -f $W/mnt/grubenv ] || grub-editenv $W/mnt/grubenv create
  grub-editenv $W/mnt/grubenv set android_insecure_adb=1 grub_timeout=3; grub-editenv $W/mnt/grubenv list
  grub-editenv $W/mnt/grubenv_abootctrl list 2>/dev/null
  umount $W/mnt; losetup -d $L ;;
start)
  qemu-system-x86_64 -name awai3064 -machine q35,accel=kvm -cpu host -smp 6 -m 8192 \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd -drive if=pflash,format=raw,file=$W/vars.fd \
    -drive file=$W/vda.img,if=virtio,format=raw,cache=writeback -drive file=$W/vdb.qcow2,if=virtio,format=qcow2,cache=writeback \
    -netdev user,id=n0,hostfwd=tcp:127.0.0.1:5565-:5555 -device virtio-net-pci,netdev=n0 \
    -device virtio-vga -display none -vnc 127.0.0.1:5 -device virtio-keyboard-pci -device virtio-tablet-pci \
    -chardev socket,id=s0,path=$W/serial.sock,server=on,wait=off,logfile=$W/serial.log -serial chardev:s0 \
    -qmp unix:$W/qmp.sock,server,nowait -daemonize -pidfile $W/qemu.pid && echo started ;;
stop) [ -f $W/qemu.pid ] && kill $(cat $W/qemu.pid) 2>/dev/null; sleep 2; echo stopped ;;
status) [ -f $W/qemu.pid ] && kill -0 $(cat $W/qemu.pid) 2>/dev/null && echo running || echo not-running
  adb connect $ADB >/dev/null 2>&1; timeout 10 adb -s $ADB shell 'echo boot=$(getprop sys.boot_completed) slot=$(getprop ro.boot.slot_suffix) incr=$(getprop ro.build.version.incremental) date=$(getprop ro.build.date.utc) tags=$(getprop ro.build.tags)' 2>&1 ;;
shot) python3 - $W/qmp.sock $W/screen.ppm <<'PY'
import socket,sys,json,time
s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); s.recv(4096)
for c in ({"execute":"qmp_capabilities"},{"execute":"screendump","arguments":{"filename":sys.argv[2]}}):
    s.sendall(json.dumps(c).encode()); time.sleep(1); s.recv(4096)
PY
  python3 -c "
import sys
d=open('$W/screen.ppm','rb').read(); print('ppm bytes',len(d),'distinct sample',len(set(d[100::997])))" ;;
*) echo "usage: $0 prepare|start|stop|status|shot"; exit 1 ;;
esac
