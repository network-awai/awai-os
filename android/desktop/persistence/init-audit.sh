#!/awai/busybox sh
# Separate RAM audit boot. No filesystem formatter, installer, partition editor or key import.
B=/awai/busybox
$B mount -t proc proc /proc
$B mount -t sysfs sysfs /sys
$B mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
fail() { echo "AWAI_AUDIT_BOOT_REFUSED $1"; exec "$B" sh; }
for required in androidboot.mount_system=imgs_ram androidboot.mount_firmware=img_ram androidboot.mount_userdata=tmpfs; do
 case " $($B cat /proc/cmdline) " in *" $required "*) :;; *) fail invalid-mode;; esac
done
echo /awai/firmware > /sys/module/firmware_class/parameters/path || fail firmware-path
for module in mii phy_package realtek e1000 r8169; do "$B" insmod "/awai/$module.ko" || fail nic-module; done
[ "$("$B" cat /sys/class/net/eth0/address)" = '0c:47:a9:60:9d:34' ] || fail wrong-target
"$B" sh /awai/readonly-nvme.sh || fail nvme-protection
for disk in /sys/block/*; do
 case "${disk##*/}" in sd*|mmcblk*|vd*) fail other-local-disk;; esac
done
"$B" insmod /lib/modules/nbd.ko || fail nbd-module
"$B" ip link set eth0 up || fail link
"$B" ip addr add 10.77.0.2/24 dev eth0 || fail address
"$B" ip route add default via 10.77.0.1 || fail route
"$B" timeout 20 "$B" nbd-client -b 512 -N awai2992 10.77.0.1 10829 /dev/nbd0 || fail nbd-connect
[ "$("$B" blockdev --getro /dev/nbd0)" = 1 ] || fail writable-system-export
echo AWAI_READONLY_AUDIT_CONNECTED
echo /mnt/vendor/firmware/ > /sys/module/firmware_class/parameters/path || fail restore-firmware-path
"$B" umount /sys || fail unmount-sys
"$B" umount /proc || fail unmount-proc
exec /system/bin/generic_init
