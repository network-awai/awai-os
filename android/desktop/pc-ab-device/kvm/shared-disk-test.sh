#!/bin/bash
# AWAI-3586: KVM check on a disk that already has three partitions (stand-ins for the Desktop's ESP, OS and LUKS).
#   shared-disk-test.sh make                 64 GiB disk with the three stand-in partitions
#   shared-disk-test.sh install <disk-vda>   plan + apply with awai-pc-install.py, then enable insecure adb (VM only)
#   shared-disk-test.sh start|stop|wait|status|check
set -uo pipefail
D=/root/awai-3586; W=$D/shared; mkdir -p $W; T=$W/nvme.img; S=127.0.0.1:5567
case ${1:-} in
make)
  rm -f $T $W/install-record.json; truncate -s 64G $T
  sgdisk --new=1:2048:+512M --typecode=1:ef00 --change-name=1:"EFI system partition" \
         --new=2:0:+24G --typecode=2:8300 --change-name=2:"existing-os" \
         --new=3:0:+8G --typecode=3:8309 --change-name=3:"existing-luks" $T >/dev/null
  L=$(losetup -fP --show $T); sleep 1
  mkfs.vfat -n STANDINESP ${L}p1 >/dev/null; mkfs.ext4 -q -L standin-os ${L}p2
  mkdir -p $W/mnt; mount ${L}p2 $W/mnt; mkdir -p $W/mnt/awai-android-2992; head -c 64M /dev/urandom > $W/mnt/awai-android-2992/userdata.img; echo "stand-in for the existing OS partition" > $W/mnt/README; umount $W/mnt
  mount ${L}p1 $W/mnt; mkdir -p $W/mnt/EFI/existing; echo "stand-in ESP" > $W/mnt/EFI/existing/marker.txt; umount $W/mnt
  head -c 32M /dev/urandom | dd of=${L}p3 bs=1M conv=fsync status=none
  losetup -d $L; sgdisk -p $T | sed -n '/^Number/,$p' ;;
install)
  python3 $D/awai-pc-install.py plan $T "${2:?source disk image}" > $W/plan.json || { cat $W/plan.json; exit 1; }
  python3 -c "
import json;p=json.load(open('$W/plan.json'))
for n in p['new']: print(n['number'],n['name'],n['start'],n['end'],n['guid'] or '-')"
  python3 $D/awai-pc-install.py apply $T "$2" --record $W/install-record.json || exit 1
  sgdisk -p $T | sed -n '/^Number/,$p'
  cp -f /usr/share/OVMF/OVMF_VARS_4M.fd $W/vars.fd
  L=$(losetup -fP --show $T); sleep 1; P=$(lsblk -lno NAME,LABEL $L | awk '$2=="PERSIST"{print $1}')
  mount /dev/$P $W/mnt; [ -f $W/mnt/grubenv ] || grub-editenv $W/mnt/grubenv create
  grub-editenv $W/mnt/grubenv set android_insecure_adb=1 grub_timeout=3; umount $W/mnt; losetup -d $L ;;
start)
  : > $W/serial.log
  qemu-system-x86_64 -name awai3586shared -machine q35,accel=kvm -cpu host -smp 6 -m 8192 \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd -drive if=pflash,format=raw,file=$W/vars.fd \
    -drive file=$T,if=none,id=d0,format=raw,cache=writeback -device nvme,drive=d0,serial=awai3586s \
    -netdev user,id=n0,hostfwd=tcp:127.0.0.1:5567-:5555 -device virtio-net-pci,netdev=n0 \
    -device virtio-vga -display none -vnc 127.0.0.1:7 -serial file:$W/serial.log \
    -qmp unix:$W/qmp.sock,server,nowait -daemonize -pidfile $W/qemu.pid 2>/dev/null && echo started ;;
stop) [ -f $W/qemu.pid ] && kill $(cat $W/qemu.pid) 2>/dev/null; sleep 3; echo stopped ;;
wait) sleep 15; n=0; until (adb connect $S >/dev/null 2>&1; timeout 8 adb -s $S shell getprop sys.boot_completed 2>&1 | grep -q "^1") || [ $n -ge ${2:-30} ]; do n=$((n+1)); sleep 8; adb disconnect $S >/dev/null 2>&1; done; echo "polls=$n" ;;
status) adb connect $S >/dev/null 2>&1
  timeout 15 adb -s $S shell 'echo boot=$(getprop sys.boot_completed) slot=$(getprop ro.boot.slot_suffix) incr=$(getprop ro.build.version.incremental); for n in super misc persist metadata userdata boot_a boot_b vendor_boot_a vendor_boot_b; do echo "$n -> $(readlink /dev/block/by-name/$n)"; done; ls /dev/block/by-name | tr "\n" " "; echo; mount | grep -E " /data | /metadata " | cut -c1-70' 2>&1
  strings $W/serial.log | grep -a "INFO: boot_a=" | tail -1 ;;
check) # the three stand-in partitions must be byte-identical to what the install record saw before
  python3 - $T $W/install-record.json <<'PY'
import sys,json,hashlib
t,r=sys.argv[1],json.load(open(sys.argv[2])); ok=True
for p in r['existing']:
    h=hashlib.sha256(); f=open(t,'rb'); f.seek(p['start']*512); left=(p['end']-p['start']+1)*512
    while left:
        b=f.read(min(left,8<<20)); h.update(b); left-=len(b)
    same=h.hexdigest()==r['existingSha256Before'][str(p['number'])]; ok=ok and same
    print(p['number'],p['name'],'UNCHANGED' if same else 'CHANGED',h.hexdigest()[:16])
print('ALL_UNCHANGED' if ok else 'SOMETHING_CHANGED')
PY
  ;;
*) echo "usage"; exit 1 ;;
esac
