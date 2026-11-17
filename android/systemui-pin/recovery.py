#!/usr/bin/env python3
"""Add/remove only the admitted RRO in Recovery. No format, flash, userdata or authentication writes."""
import argparse,hashlib,json,pathlib,subprocess
HERE=pathlib.Path(__file__).resolve().parent
ADB=pathlib.Path.home()/'Library/Android/sdk/platform-tools/adb'
def main():
 p=argparse.ArgumentParser();p.add_argument('--serial',required=True);p.add_argument('--apk',type=pathlib.Path,required=True);p.add_argument('--action',choices=['install','remove'],required=True);a=p.parse_args()
 pins=json.loads((HERE/'target.json').read_text());digest=hashlib.sha256(a.apk.read_bytes()).hexdigest()
 def adb(*args):return subprocess.check_output([str(ADB),'-s',a.serial,*args],text=True).strip()
 assert adb('get-state')=='recovery','Recovery ADB required'
 assert adb('shell','id','-u')=='0','Recovery root shell required'
 assert adb('shell','getprop','ro.boot.slot_suffix')=='_b','different slot; requalify first'
 assert adb('shell','test','-b','/dev/block/mapper/system_ext_b')=='','exact logical partition absent'
 adb('push',str(a.apk),'/tmp/awai-pin-2997.apk')
 # Fixed paths only. The target APK and partition are read/checked before remounting.
 script='''set -eu
M=/mnt/awai-pin-2997
D=/dev/block/mapper/system_ext_b
mkdir -p "$M"
mount -t ext4 -o ro "$D" "$M"
trap 'mount -o remount,ro "$M" 2>/dev/null || true; umount "$M" 2>/dev/null || true' EXIT
TARGET="$M/priv-app/SystemUI/SystemUI.apk"
[ "$(sha256sum "$TARGET" | cut -d ' ' -f1)" = "TARGET_SHA" ]
[ "$(sha256sum /tmp/awai-pin-2997.apk | cut -d ' ' -f1)" = "OVERLAY_SHA" ]
F="$M/overlay/AwaiPin/AwaiPinOverlay.apk"
'''.replace('TARGET_SHA',pins['systemUiSha256']).replace('OVERLAY_SHA',digest)
 if a.action=='install':
  script+='''[ ! -e "$M/overlay/AwaiPin" ]
FREE=$(df -k "$M" | tail -1 | awk '{print $4}')
[ "$FREE" -ge 8192 ]
mount -o remount,rw "$M"
mkdir "$M/overlay/AwaiPin"
chown 0:0 "$M/overlay/AwaiPin"
chmod 755 "$M/overlay/AwaiPin"
chcon u:object_r:vendor_overlay_file:s0 "$M/overlay/AwaiPin"
cp /tmp/awai-pin-2997.apk "$F"
chown 0:0 "$F"
chmod 644 "$F"
chcon u:object_r:vendor_overlay_file:s0 "$F"
'''
 else:
  script+='''[ "$(sha256sum "$F" | cut -d ' ' -f1)" = "OVERLAY_SHA" ]
mount -o remount,rw "$M"
rm "$F"
rmdir "$M/overlay/AwaiPin"
'''.replace('OVERLAY_SHA',digest)
 script+='''sync
[ "$(sha256sum "$TARGET" | cut -d ' ' -f1)" = "TARGET_SHA" ]
mount -o remount,ro "$M"
umount "$M"
trap - EXIT
printf 'AWAI_PIN_RECOVERY_OK\\n'
'''.replace('TARGET_SHA',pins['systemUiSha256'])
 result=subprocess.run([str(ADB),'-s',a.serial,'shell','sh'],input=script,text=True,check=True,capture_output=True);print(result.stdout);print(result.stderr)
if __name__=='__main__':main()
