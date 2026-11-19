#!/bin/bash
# AWAI-3586: S4 incremental v2->v3 on the shared disk, installed from the target-files based disk image.
set -uo pipefail
D=/root/awai-3586; E=$D/ev; S=127.0.0.1:5567; R=$E/shared-ota2-results.txt; cd $D; : > $R
U=/root/awai-3064-ota/update_device.py
while pgrep -f "shared-ota.sh" >/dev/null; do sleep 10; done
st(){ timeout 20 adb -s $S shell 'echo slot=$(getprop ro.boot.slot_suffix) incr=$(getprop ro.build.version.incremental) $(grep -E "active_slot|slot_._is_bootable|slot_._is_successful" /mnt/vendor/persist/grubenv_abootctrl | sed s/abootctrl_//g | tr "\n" " ") snap=$(snapshotctl dump 2>&1 | grep -i "update state" | head -1 | sed "s/.*: //")' 2>&1 | tr -d '\r'; }
rec(){ echo "$1|$2" | tee -a $R; }
./shared-disk-test.sh stop >/dev/null; ./shared-disk-test.sh make >/dev/null; ./shared-disk-test.sh install byname-v2-tf-disk.img > $E/s4-install.txt 2>&1
rec S4_install "$(grep -o '"existingUnchanged": [a-z]*' $E/s4-install.txt)"
./shared-disk-test.sh start >/dev/null; ./shared-disk-test.sh wait 40 >/dev/null; sleep 20; rec S4_before "$(st)"
timeout 300 python3 $U -s $S --file ota-byname-v2-to-v3-incremental.zip > $E/s4-incremental.log 2>&1
rec S4_apply "$(grep -a onPayloadApplicationComplete $E/s4-incremental.log | tail -1 | sed 's/.*onPayload/onPayload/')|$(grep -a 'Update took' $E/s4-incremental.log | sed 's/.*took //')"
adb -s $S logcat -d -s update_engine | grep -E " E update_engine" | grep -v "merge_stats\|ECC" | head -6 | cut -c1-240 > $E/s4-logcat-errors.txt
adb -s $S reboot; ./shared-disk-test.sh wait 40 >/dev/null; sleep 30; rec S4_after_reboot "$(st)"
adb -s $S shell reboot -p >/dev/null 2>&1; n=0; while kill -0 $(cat shared/qemu.pid 2>/dev/null) 2>/dev/null && [ $n -lt 60 ]; do n=$((n+1)); sleep 2; done; ./shared-disk-test.sh stop >/dev/null
rec S4_existing "$(./shared-disk-test.sh check | tail -1)"
echo DONE >> $R
