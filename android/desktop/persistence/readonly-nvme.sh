#!/awai/busybox sh
# Early-boot audit only: expose a single NVMe namespace and prohibit host writes.
set -eu
B=/awai/busybox
fail() { echo "AWAI_NVME_AUDIT_REFUSED $1"; exit 1; }
min=${1:-468750000}
max=${2:-527343750}
case "$min:$max" in *[!0-9:]*|:*) fail invalid-size-bound;; esac
for module in nvme-keyring nvme-auth nvme-core nvme; do
 name=$(echo "$module" | "$B" tr - _)
 if [ ! -d "/sys/module/$name" ]; then "$B" insmod "/awai/$module.ko" || fail module-load; fi
done
count=0
for i in $("$B" seq 1 100); do
 count=0
 for disk in /sys/block/nvme*n*; do [ -d "$disk" ] && count=$((count+1)); done
 [ "$count" -gt 0 ] && break
 "$B" sleep 0.1
done
[ "$count" -eq 1 ] || fail namespace-count
for disk in /sys/block/nvme*n*; do
 name=${disk##*/}
 sectors=$("$B" cat "$disk/size")
 [ "$sectors" -ge "$min" ] && [ "$sectors" -le "$max" ] || fail unexpected-capacity
 for device in "/dev/$name" /dev/"$name"p*; do
  [ -b "$device" ] || continue
  "$B" blockdev --setro "$device" || fail protect-device
  [ "$("$B" blockdev --getro "$device")" = 1 ] || fail device-not-readonly
 done
 [ "$("$B" blockdev --getro "/dev/$name")" = 1 ] || fail namespace-not-protected
 echo "AWAI_NVME_READONLY $name $sectors"
done
