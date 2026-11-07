#!/bin/sh
# Run the desktop-media check under krunkit on macOS: sign-in, then speech and an image through
# the real shell (in headless Chromium, because krunkit has no display) on the GPU.
# The image is changed, so run it on a copy.
#
# usage: desktop-media-krunkit.sh <raw-image> <models-dir> <results-dir> <serial-log> [timeout-seconds]
# exit:  0 every step passed. Look at the PNGs too: a step cannot judge a picture.
#        1 a step failed, or no result before the timeout
#        3 the check could not run
set -u

image=${1:-}
models=${2:-}
results=${3:-}
log=${4:-}
timeout=${5:-1800}
memory=${OTEHON_VM_MEMORY:-16384}

[ -w "$image" ] || { echo "NOT_RUN no writable image: $image"; exit 3; }
[ -d "$models" ] || { echo "NOT_RUN no models: $models"; exit 3; }
[ -d "$results" ] || { echo "NOT_RUN no results directory: $results"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
command -v krunkit >/dev/null || { echo "NOT_RUN no krunkit"; exit 3; }
abs() { echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
image=$(abs "$image"); models=$(cd "$models" && pwd); results=$(cd "$results" && pwd); : > "$log"; log=$(abs "$log")

krunkit --cpus 8 --memory "$memory" \
  --device "virtio-blk,path=$image,format=raw" \
  --device virtio-gpu,width=1280,height=800 \
  --device "virtio-fs,sharedDir=$models,mountTag=otehon-models" \
  --device "virtio-fs,sharedDir=$results,mountTag=otehon-results" \
  --device "virtio-serial,logFilePath=$log" 2>/dev/null &
vm=$!
trap 'kill "$vm" 2>/dev/null' EXIT

start=$(date +%s)
while :; do
  result=$(grep -a -m1 'OTEHON_LOGIN_E2E result=' "$log" | tr -d '\r' | sed 's/.*OTEHON_LOGIN_E2E/OTEHON_LOGIN_E2E/')
  [ -z "$result" ] || break
  kill -0 "$vm" 2>/dev/null || { echo "FAIL krunkit exited"; exit 1; }
  [ $(( $(date +%s) - start )) -lt "$timeout" ] || { echo "FAIL timeout"; grep -a 'OTEHON_LOGIN_STEP' "$log" | tr -d '\r' | tail -4; exit 1; }
  sleep 5
done
echo "$result"
grep -a 'OTEHON_MEDIA ' "$log" | tr -d '\r' | sed 's/.*OTEHON_MEDIA/OTEHON_MEDIA/'
case "$result" in
  *"result=pass"*) exit 0 ;;
  *) grep -a 'OTEHON_LOGIN_STEP' "$log" | tr -d '\r' | tail -3; echo "FAIL"; exit 1 ;;
esac
