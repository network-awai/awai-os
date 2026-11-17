#!/awai/busybox sh
# Fixed engineering Desktop. Refuse missing/restored-image drift before generic_init.
B=/awai/busybox
$B mount -t proc proc /proc
$B mount -t sysfs sysfs /sys
$B mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
fail() { echo "AWAI_PERSISTENT_BOOT_REFUSED $1"; exec "$B" sh; }
for required in androidboot.android_dir=awai-android-2992 androidboot.mount_system=imgs_ram androidboot.mount_firmware=img_ram androidboot.mount_userdata=imgs; do
 case " $($B cat /proc/cmdline) " in *" $required "*) :;; *) fail invalid-mode;; esac
done
echo /awai/firmware > /sys/module/firmware_class/parameters/path || fail firmware-path
for module in mii phy_package realtek e1000 r8169; do "$B" insmod "/awai/$module.ko" || fail nic-module; done
[ "$("$B" cat /sys/class/net/eth0/address)" = 0c:47:a9:60:9d:34 ] || fail wrong-target
"$B" sh /awai/readonly-nvme.sh 500118192 500118192 || fail nvme-protection
"$B" blkid /dev/nvme0n1p2 | "$B" grep -q 'UUID="9476f840-c703-4d5b-af77-41ea3c7986fb"'  || fail wrong-root
"$B" blkid /dev/nvme0n1p3 | "$B" grep -q 'UUID="68bf9494-e41b-4ab6-ae28-3ade4cdce29d"'  || fail wrong-state
for disk in /sys/block/*; do
 case "${disk##*/}" in sd*|mmcblk*|vd*|nbd*) fail other-local-disk;; esac
done
for module in crc16 jbd2 mbcache ext4; do
 if [ ! -d "/sys/module/$module" ]; then "$B" insmod "/lib/modules/$module.ko" || fail ext4-module; fi
done
"$B" mkdir -p /awai-check
"$B" mount -t ext4 -o ro,noload /dev/nvme0n1p2 /awai-check || fail root-mount
"$B" sh /awai/verify-images.sh /awai-check/awai-android-2992 || fail image-guard
"$B" umount /awai-check || fail root-unmount
"$B" blockdev --setrw /dev/nvme0n1 || fail namespace-write
"$B" blockdev --setro /dev/nvme0n1p1 || fail esp-protection
"$B" blockdev --setro /dev/nvme0n1p3 || fail state-protection
"$B" blockdev --setrw /dev/nvme0n1p2 || fail root-write
[ "$("$B" blockdev --getro /dev/nvme0n1p1)" = 1 ] && [ "$("$B" blockdev --getro /dev/nvme0n1p3)" = 1 ] || fail protected-partitions
"$B" ip link set eth0 up || fail link
"$B" ip addr add 10.77.0.2/24 dev eth0 || fail address
"$B" ip route add default via 10.77.0.1 || fail route
echo AWAI_RESTORED_IMAGES_VERIFIED
echo /mnt/vendor/firmware/ > /sys/module/firmware_class/parameters/path || fail restore-firmware-path
"$B" umount /sys || fail unmount-sys
"$B" umount /proc || fail unmount-proc
exec /system/bin/generic_init
