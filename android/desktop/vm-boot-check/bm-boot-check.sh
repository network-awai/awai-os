#!/bin/bash
# AWAI-3540: boot check of the source-built Awai OS (LineageOS Generic_x86_64) Live ISO on a KVM host.
# Boots the same path as the Desktop netboot route (kernel + netboot initrd + ISO over read-only NBD
# awai2992 at 10.77.0.1:10829) under QEMU/KVM, lifts Android trade-in mode over the serial console,
# then checks over adb and saves a screenshot.
#   bm-boot-check.sh DIR GPU   (DIR holds kernel, initrd, live.iso, cmdline.txt; GPU = virgl | std)
# Writes DIR/run-<UTC>/result.json, serial.log, screen.png.
set -uo pipefail
D=$(cd "${1:?dir}" && pwd); GPU=${2:-virgl}; R=$D/run-$(date -u +%Y%m%dT%H%M%SZ)-$GPU; mkdir -p $R
ADB=127.0.0.1:5557; start=$(date +%s)
log(){ echo "$(date -u +%T) $*" | tee -a $R/steps.log; }
pkill -f "qemu-nbd.*10829" ; pkill -f "qemu-system-x86_64.*$D" ; sleep 1
qemu-nbd --read-only --persistent --shared=8 --export-name awai2992 --format=raw --bind=127.0.0.1 --port=10829 --fork --pid-file=$R/nbd.pid $D/live.iso
case $GPU in
  virgl) DISP="-device virtio-vga-gl -display egl-headless,rendernode=/dev/dri/renderD128" ;;
  *)     DISP="-device virtio-vga -display none" ;;
esac
qemu-system-x86_64 -machine q35,accel=kvm -cpu host -smp 8 -m 8192 \
  -kernel $D/kernel -initrd $D/initrd -append "$(cat $D/cmdline.txt)" \
  -netdev user,id=n0,net=10.77.0.0/24,host=10.77.0.1,dhcpstart=10.77.0.2,hostfwd=tcp:127.0.0.1:5557-10.77.0.2:5555 \
  -device e1000,netdev=n0 $DISP -vnc 127.0.0.1:2 \
  -chardev socket,id=s0,path=$R/serial.sock,server=on,wait=off,logfile=$R/serial.log -serial chardev:s0 \
  -qmp unix:$R/qmp.sock,server,nowait -daemonize -pidfile $R/qemu.pid || { log "qemu failed to start"; exit 1; }
log "qemu started ($GPU)"
con(){ python3 - "$R/serial.sock" "$1" "${2:-30}" <<'PY'
import socket,sys,time,re
s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); s.settimeout(1); cmd=sys.argv[2]; to=float(sys.argv[3])
def rd(t):
    o=b''; e=time.time()+t
    while time.time()<e:
        try:
            d=s.recv(65536)
            if not d: break
            o+=d
        except socket.timeout: pass
    return o
rd(1); m='__AWAI_%d__'%int(time.time()*1000); s.sendall(('stty -echo; '+cmd+'; echo '+m+'\n').encode())
o=b''; e=time.time()+to
while time.time()<e and o.decode('utf8','replace').count(m)<2 and not re.search((m+r'\r?\n').encode(),o.split(b'echo '+m.encode())[-1]): o+=rd(1)
t=re.sub(r'\x1b\[[0-9;=?]*[A-Za-z]','',o.decode('utf8','replace')).replace('\r','')
t=t.split('echo '+m)[-1]; print(t.split(m)[0].strip())
PY
}
t=0; until strings $R/serial.log 2>/dev/null | grep -q "sys.boot_completed=1" || [ $t -ge 900 ]; do sleep 5; t=$((t+5)); done
boot_s=$(( $(date +%s)-start )); log "boot_completed seen in serial log after ${boot_s}s (or timeout)"
sleep 10
# Trade-in mode keeps adb to `tradeinmode` until setup completes; mark the device provisioned (VM only).
[ -f ~/.android/adbkey.pub ] || adb start-server >/dev/null 2>&1
KEY=$(cat ~/.android/adbkey.pub)
# VM only: authorise this host's adb key (the Desktop would show a confirmation dialog instead).
con "nsenter -t \$(pidof system_server) -m -- cmd settings put global device_provisioned 1; nsenter -t \$(pidof system_server) -m -- cmd settings put secure user_setup_complete 1; mkdir -p /data/misc/adb; echo '$KEY' > /data/misc/adb/adb_keys; chown system:shell /data/misc/adb/adb_keys; chmod 640 /data/misc/adb/adb_keys; restorecon /data/misc/adb/adb_keys; setprop ctl.restart adbd" 40 >> $R/steps.log
sleep 8; adb disconnect $ADB >/dev/null 2>&1; timeout 15 adb connect $ADB >/dev/null 2>&1
A="timeout 30 adb -s $ADB"
adb_id=$($A shell id 2>&1 | tr -d '\r'); log "adb shell id: $adb_id"
props=$($A shell 'echo "{\"boot_completed\":\"$(getprop sys.boot_completed)\",\"fingerprint\":\"$(getprop ro.build.fingerprint)\",\"kernel\":\"$(uname -r)\",\"selinux\":\"$(getenforce)\",\"surfaceflinger\":\"$(getprop init.svc.surfaceflinger)\",\"egl\":\"$(getprop ro.hardware.egl)\",\"gralloc\":\"$(getprop ro.hardware.gralloc)\",\"focus\":\"$(dumpsys window | grep -m1 mFocusedApp | sed "s/.*ActivityRecord{[^ ]* [^ ]* //; s/ .*//")\"}"' 2>&1 | tr -d '\r')
$A exec-out screencap -p > $R/screen.png 2>/dev/null
python3 - "$R" "$GPU" "$boot_s" "$adb_id" "$props" <<'PY'
import json,sys,os,struct
r,gpu,boot,adb_id,props=sys.argv[1:]
try: p=json.loads(props)
except Exception: p={'raw':props}
png=os.path.join(r,'screen.png'); size=os.path.getsize(png) if os.path.exists(png) else 0
nonblack=None
try:
    import zlib
    b=open(png,'rb').read(); w,h=struct.unpack('>II',b[16:24])
    idat=b''; i=8
    while i<len(b):
        n=struct.unpack('>I',b[i:i+4])[0]; t=b[i+4:i+8]
        if t==b'IDAT': idat+=b[i+8:i+8+n]
        i+=12+n
    raw=zlib.decompress(idat); nonblack=sum(1 for x in raw[::97] if x not in (0,255))>50
except Exception: pass
res={'schema':'awai.bm-boot-check.v1','gpu':gpu,'bootSecondsUpperBound':int(boot),'adbShell':adb_id,'props':p,'screenPngBytes':size,'screenHasContent':nonblack}
json.dump(res,open(os.path.join(r,'result.json'),'w'),indent=2); print(json.dumps(res,indent=1))
PY
