#!/awai/busybox sh
# Fixed Desktop small-image migration. Protected partitions stay readonly throughout.
set -eu
set -o pipefail
B=/awai/busybox
fail() { echo "AWAI_SMALL_IMAGE_REPAIR_REFUSED $1"; exit 1; }
case " $($B cat /proc/cmdline) " in *' awai.reblock_small_images=1 '*) :;; *) fail missing-repair-mode;; esac
[ "$("$B" cat /sys/class/net/eth0/address)" = 0c:47:a9:60:9d:34 ] || fail target
[ "$("$B" cat /sys/block/nvme0n1/size)" = 500118192 ] || fail capacity
"$B" blkid /dev/nvme0n1p2 | "$B" grep -q 'UUID="9476f840-c703-4d5b-af77-41ea3c7986fb"' || fail root-uuid
protected() {
 [ "$("$B" dd if=/dev/nvme0n1 bs=512 count=34 2>/dev/null | "$B" sha256sum | "$B" cut -d ' ' -f 1)" = 554522a048eebe037880c076db79926ad78aabd529f1d4f7f8ad41ddb213be13 ] || fail gpt-head
 [ "$("$B" dd if=/dev/nvme0n1 bs=512 skip=500118159 count=33 2>/dev/null | "$B" sha256sum | "$B" cut -d ' ' -f 1)" = babb4d5dbbfdababf7221945c19d91c7dec4c063a43a480b78be2c47453ae40d ] || fail gpt-tail
 [ "$("$B" sha256sum /dev/nvme0n1p1 | "$B" cut -d ' ' -f 1)" = baaf206c0591ce0fba51017ca46abce87f734c928ed49e2b21b241c7d2f890f9 ] || fail esp
 [ "$("$B" dd if=/dev/nvme0n1p3 bs=1048576 count=4 2>/dev/null | "$B" sha256sum | "$B" cut -d ' ' -f 1)" = 76112faa3d1b1150adc972a885700c43fe1ac82dbc1b16d28630202f8065584c ] || fail encrypted-state-header
}
for part in /dev/nvme0n1 /dev/nvme0n1p1 /dev/nvme0n1p2 /dev/nvme0n1p3; do
 [ "$("$B" blockdev --getro "$part")" = 1 ] || fail initially-writable
done
protected
protect() {
 protection_failed=0
 "$B" blockdev --setro /dev/nvme0n1p2 || protection_failed=1
 "$B" blockdev --setro /dev/nvme0n1 || protection_failed=1
 [ "$protection_failed" = 0 ]
}
trap 'protect || echo AWAI_JOURNAL_PROTECTION_RESTORE_FAILED' EXIT
"$B" blockdev --setrw /dev/nvme0n1
"$B" blockdev --setro /dev/nvme0n1p1
"$B" blockdev --setro /dev/nvme0n1p3
"$B" blockdev --setrw /dev/nvme0n1p2
[ "$("$B" blockdev --getro /dev/nvme0n1p1)" = 1 ] && [ "$("$B" blockdev --getro /dev/nvme0n1p3)" = 1 ] || fail protection
[ ! -e /awai-meta-root ] || fail root-staging-exists
"$B" mkdir /awai-meta-root
"$B" mount -t ext4 -o rw,nosuid,nodev,noexec /dev/nvme0n1p2 /awai-meta-root || fail root-mount
available=$("$B" df -kP /awai-meta-root | "$B" tail -n 1 | "$B" awk '{print $4}')
[ "$available" -ge 786432 ] || fail free-space
"$B" sh /awai/migrate-small-images.sh || fail migrate
"$B" sync
"$B" umount /awai-meta-root || fail root-unmount
"$B" rmdir /awai-meta-root
protect
protected
echo AWAI_SMALL_IMAGES_REPAIRED_PROTECTED_REGIONS_UNCHANGED
