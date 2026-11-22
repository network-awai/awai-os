#!/bin/bash
# AWAI-3064 prep: redo of three checks (disks now cache=writeback, guest flushes are honoured).
#  T8b new slot cannot boot (boot_b zeroed from the host while the VM is off) -> does GRUB fall back to slot a?
#  T7b update interrupted by kill -9 of the VM, run again; if that fails, reset and run a third time.
#  T6b incremental v1->v2 with the device log captured.
set -uo pipefail
D=/root/awai-3064-ota; E=$D/ev; S=127.0.0.1:5565; R=$E/more2-results.txt; cd $D; : > $R
wb(){ sleep 15; local n=0; until (adb connect $S >/dev/null 2>&1; timeout 8 adb -s $S shell getprop sys.boot_completed 2>&1 | grep -q "^1") || [ $n -ge ${1:-40} ]; do n=$((n+1)); sleep 8; adb disconnect $S >/dev/null 2>&1; done; sleep 20; }
st(){ timeout 20 adb -s $S shell 'echo slot=$(getprop ro.boot.slot_suffix) incr=$(getprop ro.build.version.incremental) $(grep -E "active_slot|slot_._is_bootable|slot_._is_successful|slot_._retry" /mnt/vendor/persist/grubenv_abootctrl | sed s/abootctrl_//g | tr "\n" " ") snap=$(snapshotctl dump 2>&1 | grep -i "update state" | head -1 | sed "s/.*: //")' 2>&1 | tr -d '\r'; }
fresh(){ ./ota-kvm.sh stop >/dev/null; ./ota-kvm.sh prepare >/dev/null 2>&1; ./ota-kvm.sh start >/dev/null 2>&1; wb; }
rec(){ echo "$1|$2" | tee -a $R; }
res(){ grep -a onPayloadApplicationComplete $1 | tail -1 | sed 's/.*onPayload/onPayload/'; }
# ---- T8b
fresh; rec T8b_before "$(st)"
timeout 400 python3 update_device.py -s $S --file ota-v2-full.zip > $E/t8b-apply.log 2>&1; rec T8b_apply "$(res $E/t8b-apply.log)"
rec T8b_after_apply "$(st)"
adb -s $S shell reboot -p; n=0; while kill -0 $(cat work/qemu.pid) 2>/dev/null && [ $n -lt 60 ]; do n=$((n+1)); sleep 2; done; ./ota-kvm.sh stop >/dev/null
L=$(losetup -fP --show work/vda.img); sleep 1; P=$(lsblk -lno NAME,PARTLABEL $L | awk '$2=="boot_b"{print $1}')
rec T8b_break "part=$P $(dd if=/dev/zero of=/dev/$P bs=1M count=64 conv=fsync 2>&1 | tail -1)"
mkdir -p work/mnt; PP=$(lsblk -lno NAME,LABEL $L | awk '$2=="PERSIST"{print $1}'); mount -o ro /dev/$PP work/mnt; rec T8b_grubenv_before_boot "$(grub-editenv work/mnt/grubenv_abootctrl list | sed s/abootctrl_//g | tr '\n' ' ')"; umount work/mnt
losetup -d $L; : > work/serial.log
./ota-kvm.sh start >/dev/null 2>&1; wb 45; rec T8b_after_boot "$(st)"
strings work/serial.log | grep -a -i -E "INFO: |slot|bootable" | head -12 | cut -c1-200 > $E/t8b-serial.txt
sleep 40; rec T8b_later "$(st)"
adb -s $S logcat -d -s update_engine | grep -i -E "cancel|rollback|Slot|source slot|merge" | tail -8 | cut -c1-220 > $E/t8b-logcat.txt
# ---- T7b
fresh; rec T7b_before "$(st)"
(timeout 400 python3 update_device.py -s $S --file ota-v2-full.zip > $E/t7b-1.log 2>&1 &)
n=0; until grep -a -q "DOWNLOADING (3), 0\.[4-9]" $E/t7b-1.log 2>/dev/null || [ $n -ge 200 ]; do n=$((n+1)); sleep 1; done
rec T7b_progress_at_kill "$(grep -a -o 'DOWNLOADING (3), [0-9.]*' $E/t7b-1.log | tail -1)"
kill -9 $(cat work/qemu.pid); sleep 3; pkill -f "update_device.py"; sleep 1
./ota-kvm.sh start >/dev/null 2>&1; wb; rec T7b_after_kill_boot "$(st)"
adb -s $S logcat -c
timeout 400 python3 update_device.py -s $S --file ota-v2-full.zip > $E/t7b-2.log 2>&1; rec T7b_second_run "$(res $E/t7b-2.log)"
adb -s $S logcat -d -s update_engine | grep -i -E "Resuming after|verif|hash mismatch|ERROR" | head -12 | cut -c1-240 > $E/t7b-2-logcat.txt
if ! grep -q kSuccess $E/t7b-2.log; then
  adb -s $S shell 'update_engine_client --reset_status' > /dev/null 2>&1; rec T7b_after_reset "$(st)"
  timeout 400 python3 update_device.py -s $S --file ota-v2-full.zip > $E/t7b-3.log 2>&1; rec T7b_third_run "$(res $E/t7b-3.log)"
fi
adb -s $S reboot; wb; rec T7b_after_reboot "$(st)"
# ---- T6b
fresh; adb -s $S logcat -c
timeout 300 python3 update_device.py -s $S --file ota-v1-to-v2-incremental.zip > $E/t6b-incremental.log 2>&1; rec T6b_apply "$(res $E/t6b-incremental.log)"
adb -s $S logcat -d -s update_engine | grep -E " E update_engine|hash|mismatch|source" | head -14 | cut -c1-260 > $E/t6b-logcat.txt
echo DONE >> $R
