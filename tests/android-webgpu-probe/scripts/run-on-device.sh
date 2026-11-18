#!/bin/sh
# Install the debug APK on one adb device, launch it, and print the probe's
# result line from logcat. Usage: scripts/run-on-device.sh <adb-serial> <apk> [out-dir]
# Installs additively (adb install -r); never uninstalls other apps.
set -eu
serial=$1 apk=$2 out=${3:-.agent-output/devices}
adb=${ADB:-adb}
pkg=network.awai.webgpuprobe
mkdir -p "$out"
tag=$(printf %s "$serial" | tr -c 'A-Za-z0-9._-' _)
"$adb" -s "$serial" install -r "$apk" >/dev/null
"$adb" -s "$serial" logcat -c
"$adb" -s "$serial" shell am force-stop "$pkg"
"$adb" -s "$serial" shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
i=0 line=
while [ $i -lt 30 ]; do
  line=$("$adb" -s "$serial" logcat -d | grep -o 'WEBGPU_PROBE_RESULT .*' | tail -1 || true)
  [ -n "$line" ] && break
  sleep 1; i=$((i + 1))
done
"$adb" -s "$serial" exec-out screencap -p > "$out/$tag.png" || true
"$adb" -s "$serial" shell 'getprop ro.build.version.release; getprop ro.build.version.sdk; getprop ro.product.model; getprop ro.product.cpu.abi; dumpsys webviewupdate | grep "Current WebView package"' > "$out/$tag.device.txt"
if [ -z "$line" ]; then echo "$serial: no result line within 30 s" >&2; exit 2; fi
printf '%s\n' "${line#WEBGPU_PROBE_RESULT }" > "$out/$tag.json"
printf '%s: %s\n' "$serial" "$(sed -n 's/.*"status":"\([a-z]*\)".*/\1/p' "$out/$tag.json" | tail -1)"
