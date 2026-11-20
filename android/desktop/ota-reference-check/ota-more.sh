#!/bin/bash
# AWAI-3064 prep: further OTA checks on the A/B reference device under KVM, each from a fresh v1 disk.
#  T6 incremental v1->v2;  T7 update interrupted by killing the VM, then run again;  T8 new slot cannot boot -> fallback.
set -uo pipefail
D=/root/awai-3064-ota; E=$D/ev; S=127.0.0.1:5565; R=$E/more-results.txt; cd $D; : > $R
wb(){ sleep 15; local n=0; until (adb connect $S >/dev/null 2>&1; timeout 8 adb -s $S shell getprop sys.boot_completed 2>&1 | grep -q "^1") || [ $n -ge 40 ]; do n=$((n+1)); sleep 8; adb disconnect $S >/dev/null 2>&1; done; sleep 20; }
st(){ timeout 20 adb -s $S shell 'echo slot=$(getprop ro.boot.slot_suffix) incr=$(getprop ro.build.version.incremental) $(grep -E "active_slot|slot_._is_bootable|slot_._is_successful|slot_._retry" /mnt/vendor/persist/grubenv_abootctrl | sed s/abootctrl_//g | tr "\n" " ") snap=$(snapshotctl dump 2>&1 | grep -i "update state" | head -1 | sed "s/.*: //")' 2>&1 | tr -d '\r'; }
fresh(){ ./ota-kvm.sh stop >/dev/null; ./ota-kvm.sh prepare >/dev/null 2>&1; ./ota-kvm.sh start >/dev/null 2>&1; wb; }
rec(){ echo "$1|$2" | tee -a $R; }
# ---- T6
fresh; rec T6_before "$(st)"
timeout 300 python3 update_device.py -s $S --file ota-v1-to-v2-incremental.zip > $E/t6-incremental.log 2>&1
rec T6_apply "$(grep -a onPayloadApplicationComplete $E/t6-incremental.log | tail -1 | sed 's/.*onPayload/onPayload/')"
adb -s $S reboot; wb; rec T6_after_reboot "$(st)"
# ---- T7
fresh; rec T7_before "$(st)"
(timeout 400 python3 update_device.py -s $S --file ota-v2-full.zip > $E/t7-interrupted-1.log 2>&1 &)
n=0; until grep -a -q "DOWNLOADING (3), 0\.[4-9]" $E/t7-interrupted-1.log 2>/dev/null || [ $n -ge 150 ]; do n=$((n+1)); sleep 1; done
rec T7_progress_at_kill "$(grep -a -o 'DOWNLOADING (3), [0-9.]*' $E/t7-interrupted-1.log | tail -1)"
kill -9 $(cat work/qemu.pid); sleep 3; pkill -f "update_device.py" ; sleep 1
./ota-kvm.sh start >/dev/null 2>&1; wb; rec T7_after_kill_boot "$(st)"
adb -s $S logcat -c
timeout 400 python3 update_device.py -s $S --file ota-v2-full.zip > $E/t7-interrupted-2.log 2>&1
rec T7_second_run "$(grep -a onPayloadApplicationComplete $E/t7-interrupted-2.log | tail -1 | sed 's/.*onPayload/onPayload/')|first_progress=$(grep -a -o 'DOWNLOADING (3), [0-9.]*' $E/t7-interrupted-2.log | sed -n 2p)"
adb -s $S logcat -d -s update_engine | grep -i -E "resum|checkpoint|Starting a new update" | head -5 | cut -c1-220 > $E/t7-resume-logcat.txt
adb -s $S reboot; wb; rec T7_after_reboot "$(st)"
# ---- T8
fresh; rec T8_before "$(st)"
timeout 400 python3 update_device.py -s $S --file ota-v2-full.zip > $E/t8-apply.log 2>&1
rec T8_apply "$(grep -a onPayloadApplicationComplete $E/t8-apply.log | tail -1 | sed 's/.*onPayload/onPayload/')"
rec T8_after_apply "$(st)"
adb -s $S shell 'ls -l /dev/block/by-name/boot_b; dd if=/dev/zero of=/dev/block/by-name/boot_b bs=1M count=64 2>&1 | tail -1; sync' > $E/t8-break-boot_b.txt 2>&1
adb -s $S reboot; wb; rec T8_after_reboot "$(st)"
sleep 30; rec T8_later "$(st)"
adb -s $S logcat -d -s update_engine | grep -i -E "cancel|rollback|slot|merge" | tail -6 | cut -c1-220 > $E/t8-logcat.txt
echo DONE >> $R
