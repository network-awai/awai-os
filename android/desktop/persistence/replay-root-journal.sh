#!/awai/busybox sh
# Caller must guard target/other partitions and enable only the selected OS partition.
# No formatting, file creation on the OS volume, or userdata image mounting.
set -eu
set -o pipefail
B=/awai/busybox
rootdev=/dev/nvme0n1p2
fail() { echo "AWAI_ROOT_REPLAY_REFUSED $1"; exit 1; }
[ -b "$rootdev" ] || fail missing-root
"$B" blkid "$rootdev" | "$B" grep -q 'UUID="9476f840-c703-4d5b-af77-41ea3c7986fb"' || fail root-uuid
[ "$("$B" blockdev --getro "$rootdev")" = 0 ] || fail root-not-enabled
[ ! -e /awai-journal-fix ] || fail staging-exists
"$B" mkdir /awai-journal-fix
"$B" mount -t ext4 -o rw,nosuid,nodev,noexec "$rootdev" /awai-journal-fix || fail journal-mount
"$B" sync
"$B" umount /awai-journal-fix || fail journal-unmount
flags=$("$B" od -An -tu4 -j1120 -N4 "$rootdev" | "$B" tr -d ' \n')
case "$flags" in ''|*[!0-9]*) fail superblock-read;; esac
[ "$((flags & 4))" = 0 ] || fail journal-still-dirty
"$B" rmdir /awai-journal-fix
echo AWAI_ROOT_JOURNAL_CLEAN
