#!/awai/busybox sh
# Fixed engineering Desktop. Refuse missing/restored-image drift before generic_init.
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
# Volatile operator diagnostics only: fixed direct-LAN address and static stage labels.
"$B" mkdir /awai-status || fail diagnostics-directory
status lan-diagnostics-ready
"$B" httpd -f -p 10.77.0.2:18092 -h /awai-status &
diagnostic_pid=$!
status pre-disk-checks
[ -z "$nic_failures" ] || fail "nic-module$nic_failures"
[ "$("$B" cat "/sys/class/net/$interface/address")" = 0c:47:a9:60:9d:34 ] || fail wrong-target
"$B" sh /awai/stream-boot-log.sh || fail boot-log-start
for required in androidboot.android_dir=awai-android-2992 androidboot.mount_system=imgs_ram androidboot.mount_firmware=img_ram androidboot.mount_userdata=imgs; do
 case " $($B cat /proc/cmdline) " in *" $required "*) :;; *) fail invalid-mode;; esac
done
status nvme-protection
"$B" sh /awai/readonly-nvme.sh 500118192 500118192 || fail nvme-protection
status root-uuid
"$B" blkid /dev/nvme0n1p2 | "$B" grep -q 'UUID="9476f840-c703-4d5b-af77-41ea3c7986fb"'  || fail wrong-root
status encrypted-state-uuid
"$B" blkid /dev/nvme0n1p3 | "$B" grep -q 'UUID="68bf9494-e41b-4ab6-ae28-3ade4cdce29d"'  || fail wrong-state
status other-disks
for disk in /sys/block/*; do
 case "${disk##*/}" in sd*|mmcblk*|vd*|nbd*) fail other-local-disk;; esac
done
status ext4-modules
for module in crc16 jbd2 mbcache ext4; do
 if [ ! -d "/sys/module/$module" ]; then "$B" insmod "/lib/modules/$module.ko" || fail ext4-module; fi
done
"$B" mkdir -p /awai-check
status root-mount
"$B" mount -t ext4 -o ro,noload /dev/nvme0n1p2 /awai-check || fail root-mount
status image-validation
"$B" sh /awai/verify-images.sh /awai-check/awai-android-2992 require-4k > /awai-status/image-check.txt 2>&1 || fail image-guard
"$B" umount /awai-check || fail root-unmount
status enable-owned-root-write
"$B" blockdev --setrw /dev/nvme0n1 || fail namespace-write
"$B" blockdev --setro /dev/nvme0n1p1 || fail esp-protection
"$B" blockdev --setro /dev/nvme0n1p3 || fail state-protection
"$B" blockdev --setrw /dev/nvme0n1p2 || fail root-write
[ "$("$B" blockdev --getro /dev/nvme0n1p1)" = 1 ] && [ "$("$B" blockdev --getro /dev/nvme0n1p3)" = 1 ] || fail protected-partitions
echo AWAI_RESTORED_IMAGES_VERIFIED
echo /mnt/vendor/firmware/ > /sys/module/firmware_class/parameters/path || fail restore-firmware-path
"$B" umount /sys || fail unmount-sys
"$B" umount /proc || fail unmount-proc
status generic-init-handoff
"$B" kill "$diagnostic_pid" || fail diagnostics-stop
exec /system/bin/generic_init
