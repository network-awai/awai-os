#!/bin/bash
# AWAI-3586: OTA checks on the shared disk (three stand-in partitions + Awai partitions on one NVMe).
#  S1 incremental v2->v3;  S2 fresh install, full v2->v3;  S3 fresh install, full, then boot_b zeroed -> fallback.
# After each, the VM is shut down and the three stand-in partitions are compared with their sha256 before install.
set -uo pipefail
D=/root/awai-3586; E=$D/ev; mkdir -p $E; S=127.0.0.1:5567; R=$E/shared-ota-results.txt; cd $D; : > $R
U=/root/awai-3064-ota/update_device.py; T=$D/shared/nvme.img
st(){ timeout 20 adb -s $S shell 'echo slot=$(getprop ro.boot.slot_suffix) incr=$(getprop ro.build.version.incremental) $(grep -E "active_slot|slot_._is_bootable|slot_._is_successful" /mnt/vendor/persist/grubenv_abootctrl | sed s/abootctrl_//g | tr "\n" " ") snap=$(snapshotctl dump 2>&1 | grep -i "update state" | head -1 | sed "s/.*: //")' 2>&1 | tr -d '\r'; }
rec(){ echo "$1|$2" | tee -a $R; }
res(){ grep -a onPayloadApplicationComplete $1 | tail -1 | sed 's/.*onPayload/onPayload/'; }
up(){ ./shared-disk-test.sh start >/dev/null; ./shared-disk-test.sh wait 40 >/dev/null; sleep 20; }
down(){ adb -s $S shell reboot -p >/dev/null 2>&1; n=0; while kill -0 $(cat shared/qemu.pid 2>/dev/null) 2>/dev/null && [ $n -lt 60 ]; do n=$((n+1)); sleep 2; done; ./shared-disk-test.sh stop >/dev/null; }
fresh(){ ./shared-disk-test.sh stop >/dev/null; ./shared-disk-test.sh make >/dev/null; ./shared-disk-test.sh install byname-v2-disk-vda.img >/dev/null 2>&1; }
chk(){ ./shared-disk-test.sh check | tail -1; }
# S1 (the disk was installed and booted once already)
up; rec S1_before "$(st)"
timeout 300 python3 $U -s $S --file ota-byname-v2-to-v3-incremental.zip > $E/s1-incremental.log 2>&1; rec S1_apply "$(res $E/s1-incremental.log)"
adb -s $S logcat -d -s update_engine | grep -E " E update_engine" | grep -v merge_stats | head -6 | cut -c1-240 > $E/s1-logcat-errors.txt
adb -s $S reboot; ./shared-disk-test.sh wait 40 >/dev/null; sleep 30; rec S1_after_reboot "$(st)"
down; rec S1_existing "$(chk)"
# S2
fresh; up; rec S2_before "$(st)"
timeout 400 python3 $U -s $S --file ota-byname-v3-full.zip > $E/s2-full.log 2>&1; rec S2_apply "$(res $E/s2-full.log)"
adb -s $S reboot; ./shared-disk-test.sh wait 40 >/dev/null; sleep 30; rec S2_after_reboot "$(st)"
down; rec S2_existing "$(chk)"
# S3
fresh; up
timeout 400 python3 $U -s $S --file ota-byname-v3-full.zip > $E/s3-full.log 2>&1; rec S3_apply "$(res $E/s3-full.log)"
rec S3_after_apply "$(st)"; down
python3 - $T <<'PY' | tee -a $R
import subprocess,sys,re
t=sys.argv[1]; out=subprocess.run(['sgdisk','-p',t],capture_output=True,text=True).stdout
for l in out.splitlines():
    m=re.match(r'\s*(\d+)\s+(\d+)\s+(\d+)\s+.*\sboot_b\s*$',l)
    if m:
        s,e=int(m[2]),int(m[3]); f=open(t,'r+b'); f.seek(s*512); f.write(b'\0'*(64<<20)); f.close()
        print(f"S3_break|zeroed 64 MiB at partition {m[1]} (boot_b), sectors {s}-{e}")
PY
up; rec S3_after_boot "$(st)"
strings shared/serial.log | grep -a -E "ERROR: |Switching active|INFO: Booting" | head -6 | cut -c1-160 > $E/s3-serial.txt
down; rec S3_existing "$(chk)"
echo DONE >> $R
