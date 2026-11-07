#!/bin/sh
# Boot the gpu-check image under krunkit on macOS and read whether Vulkan reaches a GPU.
#
# The image must be writable, and it is changed, so run the check on a copy.
#
# usage: gpu-check-krunkit.sh <raw-image> <serial-log> [timeout-seconds]
# exit:  0 a Venus device was reported
#        1 no GPU, or no report before the timeout
#        3 the check could not run
set -u

image=${1:-}
log=${2:-}
timeout=${3:-180}

[ -n "$image" ] && [ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -w "$image" ] || { echo "NOT_RUN image is not writable: $image"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
command -v krunkit >/dev/null || { echo "NOT_RUN no krunkit"; exit 3; }

: > "$log"
image=$(cd "$(dirname "$image")" && pwd)/$(basename "$image")
log=$(cd "$(dirname "$log")" && pwd)/$(basename "$log")
krunkit --cpus 4 --memory 4096 \
  --device "virtio-blk,path=$image,format=raw" \
  --device virtio-gpu,width=1280,height=800 \
  --device "virtio-serial,logFilePath=$log" &
vm=$!
trap 'kill "$vm" 2>/dev/null' EXIT

elapsed=0
while [ "$elapsed" -lt "$timeout" ]; do
  kill -0 "$vm" 2>/dev/null || { echo "FAIL krunkit exited after ${elapsed}s"; exit 1; }
  report=$(grep -a -m1 'OTEHON_BOOT_REPORT id=' "$log" | tr -d '\r')
  if [ -n "$report" ]; then
    echo "$report elapsed=${elapsed}s"
    case "$report" in
      *" venus=1 "*) exit 0 ;;
      *) echo "FAIL no Venus device"; exit 1 ;;
    esac
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
echo "FAIL no boot report in ${timeout}s"
exit 1
