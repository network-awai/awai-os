#!/awai/busybox sh
# PXE installer init (erase mode fully implemented; shared refuses).
# Fixed 7735HS target, same guard style as init-persistent.sh: NIC MAC,
# boot mode on cmdline, single NVMe of the pinned size, root/LUKS UUIDs
# BEFORE erase, no other local disk, digest-pin match, typed confirmation.
# No write happens before every guard passes. Erase mode writes a full-disk
# image (GPT inside the image, made by make-tf-disk.sh + awai-pc-install.py
# plan on the operator side). Image pins (url/sha/bytes) are read from
# /awai/install.pins inside this initrd overlay; the serve manifest's
# whole-initrd digest covers them. Shared mode needs staged /awai/sgdisk
# and a GPT-splice writer; that is not implemented here and REFUSES.
# After readback the box stays in a shell: reboot it and boot the
# installed disk under firmware.
B=/awai/busybox
$B mount -t proc proc /proc
$B mount -t sysfs sysfs /sys
$B mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
status() { echo "AWAI_BOOT_STAGE $1"; echo "<6>AWAI_BOOT_STAGE $1" > /dev/kmsg; if [ -d /awai-status ]; then echo "$1" > /awai-status/index.html; fi; }
fail() { status "REFUSED $1"; exec "$B" sh; }
echo /awai/firmware > /sys/module/firmware_class/parameters/path || fail firmware-path
nic_failures=
for module in mii phy_package realtek e1000 r8169; do
 if [ ! -d "/sys/module/$module" ]; then
  "$B" insmod "/awai/$module.ko" || nic_failures="$nic_failures $module"
 fi
done
interface=eth0
for candidate in /sys/class/net/*; do
 if [ "$("$B" cat "$candidate/address")" = 0c:47:a9:60:9d:34 ]; then interface=${candidate##*/}; break; fi
done
"$B" ip link set "$interface" up || fail link
"$B" ip addr add 10.77.0.2/24 dev "$interface" || fail address
"$B" ip route add default via 10.77.0.1 || fail route
"$B" mkdir /awai-status || fail diagnostics-directory
status lan-diagnostics-ready
"$B" httpd -f -p 10.77.0.2:18092 -h /awai-status &
diagnostic_pid=$!
status pre-disk-checks
[ -z "$nic_failures" ] || fail "nic-module$nic_failures"
[ "$("$B" cat "/sys/class/net/$interface/address")" = 0c:47:a9:60:9d:34 ] || fail wrong-target
"$B" sh /awai/stream-boot-log.sh || fail boot-log-start
case " $($B cat /proc/cmdline) " in *" awai.install.profile=1 "*)
 :;; *) fail invalid-mode;; esac
for module in nvme-keyring nvme-auth nvme-core nvme; do
 name=$("$B" echo "$module" | "$B" tr - _)
 if [ ! -d "/sys/module/$name" ]; then "$B" insmod "/awai/$module.ko" || fail nvme-module; fi
done
count=0
for i in $($B seq 1 100); do
 count=0
 for disk in /sys/block/nvme*n*; do [ -d "$disk" ] && count=$((count+1)); done
 [ "$count" -gt 0 ] && break
 "$B" sleep 0.1
done
[ "$count" -eq 1 ] || fail namespace-count
target=
for disk in /sys/block/nvme*n*; do target=${disk##*/}; done
[ -n "$target" ] || fail namespace-missing
sectors=$("$B" cat "/sys/block/$target/size")
case " $($B cat /proc/cmdline) " in *" awai.install.sectors=$sectors "*)
 :;; *) fail unexpected-capacity;; esac
status target-identity
case " $($B cat /proc/cmdline) " in *" awai.install.mode=erase "*)
 mode=erase;;
 *" awai.install.mode=shared "*)
 mode=shared;;
 *) fail invalid-install-mode;; esac
# Image pins live in the overlay, digest-covered by the manifest initrd pin.
image_url=
image_sha=
img_bytes=
[ -f /awai/install.pins ] && [ ! -L /awai/install.pins ] || fail missing-install-pins
while IFS='=' read -r key value; do
 case "$key" in
  image_url) image_url=$value ;;
  image_sha) image_sha=$value ;;
  img_bytes) img_bytes=$value ;;
 esac
done < /awai/install.pins
[ -n "$image_url" ] && [ -n "$image_sha" ] && [ -n "$img_bytes" ] || fail missing-image-pins
case "$image_sha" in *[!0-9a-f]*) fail invalid-image-sha;; esac
[ "$(echo "$image_sha" | "$B" wc -c)" -eq 65 ] || fail invalid-image-sha
case "$img_bytes" in *[!0-9]*) fail invalid-img-bytes;; esac
case "$mode" in erase)
 for disk in /sys/block/*; do
  case "${disk##*/}" in sd*|mmcblk*|vd*|nbd*) fail other-local-disk;; esac
 done
 "$B" blkid "/dev/${target}p2" | "$B" grep -q 'UUID="9476f840-c703-4d5b-af77-41ea3c7986fb"' || fail wrong-root
 "$B" blkid "/dev/${target}p3" | "$B" grep -q 'UUID="68bf9494-e41b-4ab6-ae28-3ade4cdce29d"' || fail wrong-state
 ;;
 shared)
 [ -x /awai/sgdisk ] || fail missing-sgdisk
 fail shared-not-implemented
 ;;
esac
status image-verify-fetch
[ -n "$("$B" which wget 2>/dev/null)" ] || fail missing-wget
"$B" wget -q -O- "$image_url" 2>/dev/null | "$B" sha256sum > /awai-status/image-check.txt || fail image-fetch
[ "$("$B" cat /awai-status/image-check.txt)" = "$image_sha  -" ] || fail image-digest
status image-verified
echo "AWAI_INSTALL_IMAGE_VERIFIED $image_sha"
echo "To erase/write $target ($sectors sectors) from $image_url, type the full image SHA-256:"
"$B" read -r confirm || fail confirm-read
[ "$confirm" = "$image_sha" ] || fail confirm-mismatch
status install-write
"$B" wget -q -O- "$image_url" 2>/dev/null | "$B" dd of="/dev/$target" bs=512 conv=notrunc 2>/dev/null || fail image-write
"$B" sync || fail sync
status install-readback
"$B" dd if="/dev/$target" bs=512 count=$((img_bytes / 512)) 2>/dev/null | "$B" sha256sum > /awai-status/readback.txt || fail readback
[ "$("$B" cut -d' ' -f1 /awai-status/readback.txt)" = "$image_sha" ] || fail readback-digest
echo AWAI_INSTALL_COMPLETE
echo "Installed image read back OK. Reboot and boot the installed disk under firmware. Staying in shell."
exec "$B" sh
