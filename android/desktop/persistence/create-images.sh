#!/system/bin/sh
# Fixed audited Desktop only. Formats NEW regular image files, never a block device.
set -eu
[ "$(cat /sys/class/net/eth0/address)" = 0c:47:a9:60:9d:34 ]
[ "$(cat /sys/block/nvme0n1/size)" = 500118192 ]
blkid /dev/block/nvme0n1p2 | grep -q 'UUID="9476f840-c703-4d5b-af77-41ea3c7986fb"'
blkid /dev/block/nvme0n1p3 | grep -q 'TYPE="crypt_LUKS"'
mountpoint=/mnt/awai-2992-root-write
[ ! -e "$mountpoint" ]
grep -q '^/dev/block/nvme0n1p2 /mnt/awai-2992-root-audit ext4 ro,' /proc/mounts
umount /mnt/awai-2992-root-audit
blockdev --setrw /dev/block/nvme0n1
blockdev --setro /dev/block/nvme0n1p1
blockdev --setro /dev/block/nvme0n1p3
blockdev --setrw /dev/block/nvme0n1p2
[ "$(blockdev --getro /dev/block/nvme0n1p1)" = 1 ]
[ "$(blockdev --getro /dev/block/nvme0n1p3)" = 1 ]
mkdir "$mountpoint"
mount -t ext4 -o rw,nosuid,nodev,noexec /dev/block/nvme0n1p2 "$mountpoint"
available=$(df -kP "$mountpoint" | tail -n 1 | awk '{print $4}')
[ "$available" -ge 11534336 ]
root="$mountpoint/awai-android-2992"
[ ! -e "$root" ]
mkdir -m 700 "$root"
for name in system system_dlkm vendor vendor_dlkm firmware; do
 input="/mnt/vendor/generic_init/img/$name.img"
 [ -f "$input" ] && [ ! -L "$input" ]
 cp -p "$input" "$root/$name.img"
 before=$(sha256sum "$input" | cut -d ' ' -f 1)
 after=$(sha256sum "$root/$name.img" | cut -d ' ' -f 1)
 [ "$before" = "$after" ]
 echo "AWAI_SYSTEM_IMAGE_VERIFIED $name $after"
done
for spec in userdata:6442450944 metadata:67108864 cache:134217728; do
 name=${spec%%:*}; size=${spec#*:}; image="$root/$name.img"
 [ ! -e "$image" ]
 (set -C; : > "$image")
 chmod 600 "$image"
 fallocate -l "$size" "$image"
 [ -f "$image" ] && [ ! -b "$image" ] && [ ! -L "$image" ]
 mke2fs -t ext4 -F -E nodiscard,lazy_itable_init=0,lazy_journal_init=0 -L "awai-$name" "$image"
 [ "$(stat -c %s "$image")" = "$size" ]
 blkid "$image"
done
sync
echo AWAI_NEW_IMAGE_FILES_READY
