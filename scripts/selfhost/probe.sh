#!/bin/sh
# Host-side, read-only self-hosting capability probe (AWAI-3854, P0).
# Read-only only: no reboot, root, install, enable or fastboot.
# Select one already-authorized device explicitly; never print its serial.
set -eu
if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo 'usage: probe.sh <adb-serial> (serial is not included in the report)' >&2
  exit 2
fi
command -v adb >/dev/null 2>&1 || { echo 'NOT_RUN adb unavailable' >&2; exit 3; }
state=$(adb -s "$1" get-state 2>/dev/null) || {
  echo 'NOT_RUN selected device unavailable or unauthorized' >&2
  exit 3
}
[ "$state" = device ] || { echo 'NOT_RUN selected device is not in Android device state' >&2; exit 3; }
# Strip control bytes but keep newlines: several reads are multi-line.
clean() { printf '%s' "$1" | LC_ALL=C tr -d '\000-\010\013-\037\177'; }
printf 'AWAI_SELFHOST_PROBE_V1\nobserved_at_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
status=0
# Fixed getprop allowlist: no full getprop, serial, IMEI, account, IP or SSID.
for prop in \
  ro.product.manufacturer ro.product.model ro.product.device ro.product.board \
  ro.board.platform ro.product.cpu.abi ro.build.version.sdk \
  ro.build.version.release ro.build.type
do
  if value=$(adb -s "$1" shell getprop "$prop" 2>/dev/null); then
    value=$(clean "$value")
    [ -n "$value" ] || value=unknown
  else
    value=unknown
    status=1
  fi
  printf '%s=%s\n' "$prop" "$value"
done
for cmd in 'uname -m' 'uname -r'; do
  key=$(printf '%s' "$cmd" | tr ' ' '_')
  if value=$(adb -s "$1" shell $cmd 2>/dev/null); then
    value=$(clean "$value")
    [ -n "$value" ] || value=unknown
  else
    value=unknown
    status=1
  fi
  printf '%s=%s\n' "$key" "$value"
done
# Memory: fixed file read, keep only the two totals.
if mem=$(adb -s "$1" shell cat /proc/meminfo 2>/dev/null); then
  for field in MemTotal MemAvailable; do
    value=$(printf '%s\n' "$mem" | sed -n "s/^${field}:[[:space:]]*//p" | head -n 1)
    value=$(clean "$value")
    [ -n "$value" ] || value=unknown
    printf '%s=%s\n' "$field" "$value"
  done
else
  printf 'MemTotal=unknown\nMemAvailable=unknown\n'
  status=1
fi
if dfout=$(adb -s "$1" shell df /data 2>/dev/null); then
  value=$(printf '%s\n' "$dfout" | tail -n 1)
  value=$(clean "$value")
  [ -n "$value" ] || value=unknown
  printf 'df_data=%s\n' "$value"
else
  printf 'df_data=unknown\n'
  status=1
fi
# Presence checks: output is only present/absent/unknown, never a listing.
# /dev/kvm: ls succeeds with output only when the node exists.
if out=$(adb -s "$1" shell ls /dev/kvm 2>/dev/null); then
  out=$(clean "$out")
  if [ -n "$out" ]; then echo 'dev_kvm=present'; else echo 'dev_kvm=absent'; fi
else
  echo 'dev_kvm=absent'
fi
if feats=$(adb -s "$1" shell pm list features 2>/dev/null); then
  case $(clean "$feats") in
    *virtualization_framework*) echo 'avf_feature=present' ;;
    *) echo 'avf_feature=absent' ;;
  esac
else
  echo 'avf_feature=unknown'
  status=1
fi
if pkgs=$(adb -s "$1" shell pm list packages 2>/dev/null); then
  pkglist=$(clean "$pkgs")
  for pkg in com.android.virtualization.terminal com.termux com.android.virt; do
    found=absent
    for line in $pkglist; do
      [ "$line" = "package:$pkg" ] && found=present
    done
    printf 'pkg_%s=%s\n' "$(printf '%s' "$pkg" | tr '.' '_')" "$found"
  done
else
  echo 'pkg_com_android_virtualization_terminal=unknown'
  echo 'pkg_com_termux=unknown'
  echo 'pkg_com_android_virt=unknown'
  status=1
fi
# Best-effort: /apex is often unreadable from the shell user, so a failed
# read stays unknown without failing the whole collection.
if apex=$(adb -s "$1" shell ls /apex 2>/dev/null); then
  case $(clean "$apex") in
    *com.android.virt*) echo 'apex_virt=present' ;;
    *) echo 'apex_virt=absent' ;;
  esac
else
  echo 'apex_virt=unknown'
fi
printf 'collection_status=%s\n' "$status"
# A completed collection is an observation, never proof a guest boots.
exit "$status"
