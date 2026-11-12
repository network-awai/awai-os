#!/bin/sh
# Host-side, read-only Android inventory. No reboot, root, install or fastboot.
# Select one already-authorized device explicitly; never print its serial.
set -u
if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo 'usage: collect-p0.sh <adb-serial> (serial is not included in the report)' >&2
  exit 2
fi
command -v adb >/dev/null 2>&1 || { echo 'NOT_RUN adb unavailable' >&2; exit 3; }
state=$(adb -s "$1" get-state 2>/dev/null) || {
  echo 'NOT_RUN selected device unavailable or unauthorized' >&2
  exit 3
}
[ "$state" = device ] || { echo 'NOT_RUN selected device is not in Android device state' >&2; exit 3; }
printf 'OTEHON_MOBILE_P0_V1\nobserved_at_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
status=0
# Fixed allowlist: no full getprop, serial, IMEI, account, IP, SSID or logs.
for prop in \
  ro.product.manufacturer ro.product.model ro.product.device ro.product.board \
  ro.board.platform ro.product.cpu.abi ro.build.version.release \
  ro.build.version.security_patch ro.build.display.id \
  ro.boot.flash.locked ro.boot.vbmeta.device_state ro.boot.verifiedbootstate \
  sys.oem_unlock_allowed ro.oem_unlock_supported gsm.sim.state \
  ro.treble.enabled ro.build.ab_update ro.boot.dynamic_partitions ro.boot.slot_suffix
do
  if value=$(adb -s "$1" shell getprop "$prop" 2>/dev/null); then
    value=$(printf '%s' "$value" | LC_ALL=C tr -d '\000-\037\177')
    [ -n "$value" ] || value=unknown
  else
    value=unknown
    status=1
  fi
  printf '%s=%s\n' "$prop" "$value"
done
printf 'collection_status=%s\n' "$status"
# A completed collection is an observation, never permission to unlock or flash.
exit "$status"
