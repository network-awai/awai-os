#!/bin/bash
# One installer VM at a size: runvm.sh WIDTH HEIGHT [ISO]. Run in ~/awai-x-20261124/e2e on the VM host (macOS, Homebrew QEMU).
# Fresh blank 128 GiB NVMe qcow2 (install target) and a non-empty 8 GiB NVMe that must be refused; no real disk is ever attached.
# VGA_DEV=virtio-vga for widths that are not a multiple of 8 (1366): the std VGA's screendump is skewed there.
# Check `pgrep qemu-system-x86_64` first: one VM at a time.
export PATH=/opt/homebrew/bin:$PATH
cd ~/awai-x-20261124/e2e || exit 1
W=${1:-1280}; H=${2:-720}; ISO=${3:-new.iso}
pgrep qemu-system-x86_64 >/dev/null && { echo "a VM is already running"; exit 1; }
rm -f blank.qcow2 vars.fd qmp.sock serial.log
qemu-img create -q -f qcow2 blank.qcow2 128G
[ -f used.raw ] || { qemu-img create -q -f raw used.raw 8G; sgdisk -n 1:2048:+1G -t 1:8300 -c 1:keepme used.raw >/dev/null 2>&1 || python3 -I - <<'PY'
f=open('used.raw','r+b'); f.seek(510); f.write(b'\x55\xaa'); f.seek(446); f.write(bytes([0,0,2,0,0x83,0,0,0])+(2048).to_bytes(4,'little')+(2097152).to_bytes(4,'little')); f.close()
PY
  shasum -a 256 used.raw > used.sha256; }
cp /opt/homebrew/share/qemu/edk2-i386-vars.fd vars.fd
nohup nice -n 5 qemu-system-x86_64 -machine q35 -accel tcg,thread=multi,tb-size=1024 -cpu max -smp 4 -m 14336 \
 -drive if=pflash,format=raw,readonly=on,file=/opt/homebrew/share/qemu/edk2-x86_64-code.fd -drive if=pflash,format=raw,file=vars.fd \
 -device qemu-xhci -drive id=usb0,if=none,format=raw,readonly=on,file=$ISO -device usb-storage,drive=usb0,bootindex=0,removable=on \
 -drive id=n0,if=none,format=qcow2,file=blank.qcow2,detect-zeroes=unmap,discard=unmap -device nvme,drive=n0,serial=AWAIBLANK01 \
 -drive id=n1,if=none,format=raw,file=used.raw -device nvme,drive=n1,serial=AWAIUSED01 \
 -vga none -device ${VGA_DEV:-VGA},edid=on,xres=$W,yres=$H -display none -nic none -device usb-kbd -device usb-tablet -rtc base=utc \
 -qmp unix:qmp.sock,server=on,wait=off -serial file:serial.log -pidfile vm.pid > qemu.log 2>&1 &
sleep 4; cat vm.pid; cat qemu.log
