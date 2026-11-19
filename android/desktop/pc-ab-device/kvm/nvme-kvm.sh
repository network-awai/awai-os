#!/bin/bash
# AWAI-3586: run the by-name build under KVM with ONE NVMe disk (no virtio disks).
#   nvme-kvm.sh prepare <disk-vda.img>   working copy + 16 GiB, userdata partition added at the end, insecure adb (VM only)
#   nvme-kvm.sh start | stop | status
set -uo pipefail
D=/root/awai-3586; W=$D/work; mkdir -p $W; S=127.0.0.1:5566
case ${1:-} in
prepare)
  cp --sparse=always -f "${2:?disk image}" $W/nvme.img
  truncate -s +16G $W/nvme.img
  sgdisk -e $W/nvme.img >/dev/null
  sgdisk --new=0:0:0 --change-name=12:userdata $W/nvme.img | tail -1
  sgdisk -p $W/nvme.img | sed -n '/^Number/,$p'
  cp -f /usr/share/OVMF/OVMF_VARS_4M.fd $W/vars.fd
  L=$(losetup -fP --show $W/nvme.img); sleep 1; P=$(lsblk -lno NAME,LABEL $L | awk '$2=="PERSIST"{print $1}')
  mkdir -p $W/mnt; mount /dev/$P $W/mnt
  [ -f $W/mnt/grubenv ] || grub-editenv $W/mnt/grubenv create
  grub-editenv $W/mnt/grubenv set android_insecure_adb=1 grub_timeout=3
  umount $W/mnt; losetup -d $L ;;
start)
  : > $W/serial.log
  qemu-system-x86_64 -name awai3586 -machine q35,accel=kvm -cpu host -smp 6 -m 8192 \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd -drive if=pflash,format=raw,file=$W/vars.fd \
    -drive file=$W/nvme.img,if=none,id=d0,format=raw,cache=writeback -device nvme,drive=d0,serial=awai3586 \
    -netdev user,id=n0,hostfwd=tcp:127.0.0.1:5566-:5555 -device virtio-net-pci,netdev=n0 \
    -device virtio-vga -display none -vnc 127.0.0.1:6 -serial file:$W/serial.log \
    -qmp unix:$W/qmp.sock,server,nowait -daemonize -pidfile $W/qemu.pid 2>/dev/null && echo started ;;
stop) [ -f $W/qemu.pid ] && kill $(cat $W/qemu.pid) 2>/dev/null; sleep 2; echo stopped ;;
wait) sleep 15; n=0; until (adb connect $S >/dev/null 2>&1; timeout 8 adb -s $S shell getprop sys.boot_completed 2>&1 | grep -q "^1") || [ $n -ge ${2:-30} ]; do n=$((n+1)); sleep 8; adb disconnect $S >/dev/null 2>&1; done; echo "polls=$n" ;;
status) adb connect $S >/dev/null 2>&1
  timeout 15 adb -s $S shell 'echo boot=$(getprop sys.boot_completed) slot=$(getprop ro.boot.slot_suffix) incr=$(getprop ro.build.version.incremental); for n in super misc persist metadata userdata boot_a boot_b vendor_boot_a vendor_boot_b; do echo "$n -> $(readlink /dev/block/by-name/$n) $(ls -Z $(readlink -f /dev/block/by-name/$n) 2>/dev/null | cut -d" " -f1)"; done; mount | grep -E " /data | /metadata | /mnt/vendor/persist " | cut -c1-90; ls /sys/block | tr "\n" " "' 2>&1 ;;
*) echo "usage: $0 prepare IMG|start|stop|wait|status"; exit 1 ;;
esac
