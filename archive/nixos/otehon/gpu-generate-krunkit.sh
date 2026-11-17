#!/bin/sh
# Generate an image with Qwen-Image on the GPU under krunkit on macOS.
#
# usage: gpu-generate-krunkit.sh <raw-image> <models-dir> <results-dir> <serial-log> [timeout-seconds]
# exit:  0 the run ended. This does not prove a good image: look at each PNG.
#        1 a timeout or an early exit
#        3 the check could not run
set -u

image=${1:-}
models=${2:-}
results=${3:-}
log=${4:-}
timeout=${5:-7200}
memory=${OTEHON_VM_MEMORY:-16384}

[ -w "$image" ] || { echo "NOT_RUN no writable image: $image"; exit 3; }
[ -d "$models" ] || { echo "NOT_RUN no models: $models"; exit 3; }
[ -d "$results" ] || { echo "NOT_RUN no results directory: $results"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
command -v krunkit >/dev/null || { echo "NOT_RUN no krunkit"; exit 3; }
abs() { echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
image=$(abs "$image"); models=$(cd "$models" && pwd); results=$(cd "$results" && pwd); : > "$log"; log=$(abs "$log")
rm -f "$results"/*.png

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
  done_line=$(grep -a -m1 'OTEHON_GENERATE_DONE' "$log" | tr -d '\r')
  [ -z "$done_line" ] || break
  kill -0 "$vm" 2>/dev/null || { echo "FAIL krunkit exited"; exit 1; }
  [ $(( $(date +%s) - start )) -lt "$timeout" ] || { echo "FAIL timeout"; exit 1; }
  sleep 5
done
echo "$done_line"
sleep 5
grep -a 'OTEHON_VARIANT' "$log" | tr -d '\r' | sed -E 's/.*(OTEHON_VARIANT)/\1/'
