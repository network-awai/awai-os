#!/awai/busybox sh
B=/awai/busybox
$B mount -t proc proc /proc
$B mount -t sysfs sysfs /sys
$B mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
set -x
for required in androidboot.mount_system=imgs_ram androidboot.mount_firmware=img_ram androidboot.mount_userdata=tmpfs; do
 case " $($B cat /proc/cmdline) " in *" $required "*) : ;; *) echo AWAI_NETBOOT_FAILED invalid-mode; exec "$B" sh;; esac
done
fail() { echo "AWAI_NETBOOT_FAILED $1"; exec "$B" sh; }
echo /awai/firmware > /sys/module/firmware_class/parameters/path || fail firmware-path
$B insmod /awai/mii.ko || fail mii-module
$B insmod /awai/phy_package.ko || fail phy-package-module
$B insmod /awai/realtek.ko || fail phy-module
$B insmod /awai/e1000.ko || fail intel-nic-module
$B insmod /awai/r8169.ko || fail realtek-nic-module
for d in /sys/block/*; do
 case "${d##*/}" in nvme*|sd*|mmcblk*|vd*) fail local-disk-visible;; esac
done
$B insmod /lib/modules/nbd.ko || fail nbd-module
$B ip link set eth0 up || fail link
$B ip addr add 10.77.0.2/24 dev eth0 || fail address
$B ip route add default via 10.77.0.1 || fail route
$B timeout 20 $B nbd-client -b 512 -N awai2992 10.77.0.1 10829 /dev/nbd0 || fail nbd-connect
$B blockdev --getro /dev/nbd0 | $B grep -qx 1 || fail writable-nbd
echo AWAI_NETBOOT_READ_ONLY_CONNECTED
echo /mnt/vendor/firmware/ > /sys/module/firmware_class/parameters/path || fail restore-firmware-path
$B umount /sys || fail unmount-sys
$B umount /proc || fail unmount-proc
exec /system/bin/generic_init
