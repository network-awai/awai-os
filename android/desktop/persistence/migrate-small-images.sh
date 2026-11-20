#!/awai/busybox sh
# Caller mounts guarded OS filesystem at /awai-meta-root. Original images retained.
set -eu
set -o pipefail
B=/awai/busybox
root=/awai-meta-root/awai-android-2992
fail() { echo "AWAI_SMALL_IMAGE_MIGRATION_REFUSED $1"; exit 1; }
[ -d "$root" ] && [ ! -L "$root" ] || fail root
(cd /awai/templates; "$B" sha256sum -c templates.sha256) || fail template-digest
manifest() {
 directory=$1; prefix=$2
 (cd "$directory"; "$B" find . -xdev -type f -exec /awai/busybox sha256sum {} \; | "$B" sort) > "$prefix.contents"
 (cd "$directory"; "$B" find . -xdev -exec /awai/busybox stat -c '%F %a %u %g %N' {} \; | "$B" sort) > "$prefix.attributes"
}
for spec in metadata:67108864:9da2d63b-0833-4962-9bd7-221b7a7de2d2 cache:134217728:0cd459f0-63d4-4a98-a1d4-a4b6c9443856; do
 name=${spec%%:*}; rest=${spec#*:}; size=${rest%%:*}; uuid=${rest#*:}
 original="$root/$name.img"; work="$root/$name.1k.working"; pending="$root/$name.4k.pending"; preserved="$root/$name.1k.original"
 [ -f "$original" ] && [ ! -L "$original" ] || fail source-type
 [ "$("$B" stat -c %s "$original")" = "$size" ] || fail source-size
 "$B" blkid "$original" | "$B" grep -q "UUID=\"$uuid\"" || fail source-uuid
 shift=$("$B" od -An -tu4 -j1048 -N4 "$original" | "$B" tr -d ' \n')
 if [ "$shift" = 2 ]; then echo "AWAI_SMALL_IMAGE_ALREADY_4K $name"; continue; fi
 [ "$shift" = 0 ] || fail source-block-size
 [ ! -e "$work" ] && [ ! -e "$pending" ] && [ ! -e "$preserved" ] || fail existing-migration-state
 "$B" cp -p "$original" "$work"
 [ "$("$B" sha256sum "$original" | "$B" cut -d ' ' -f 1)" = "$("$B" sha256sum "$work" | "$B" cut -d ' ' -f 1)" ] || fail source-copy
 "$B" cp /awai/templates/"$name.4k.template" "$pending"
 "$B" chmod 600 "$work" "$pending"
 oldloop=$("$B" losetup -f); "$B" losetup "$oldloop" "$work"
 [ "$("$B" blockdev --getss "$oldloop")" = 512 ] || fail source-loop-sector
 newloop=$("$B" losetup -f); "$B" losetup "$newloop" "$pending"
 "$B" mkdir /awai-meta-old /awai-meta-new
 "$B" mount -t ext4 -o rw,nosuid,nodev,noexec "$oldloop" /awai-meta-old || fail source-mount
 "$B" mount -t ext4 -o rw,nosuid,nodev,noexec "$newloop" /awai-meta-new || fail target-mount
 unsupported=$("$B" find /awai-meta-old -xdev ! -type d ! -type f ! -type l | "$B" wc -l | "$B" tr -d ' \n')
 [ "$unsupported" = 0 ] || fail source-special-file
 "$B" cp -a /awai-meta-old/. /awai-meta-new/
 manifest /awai-meta-old /awai-source
 manifest /awai-meta-new /awai-destination
 "$B" cmp /awai-source.contents /awai-destination.contents || fail file-content
 "$B" cmp /awai-source.attributes /awai-destination.attributes || fail file-attributes
 "$B" sync
 "$B" umount /awai-meta-new
 "$B" umount /awai-meta-old
 "$B" losetup -d "$newloop"
 "$B" losetup -d "$oldloop"
 "$B" rmdir /awai-meta-old /awai-meta-new
 [ "$("$B" od -An -tu4 -j1048 -N4 "$pending" | "$B" tr -d ' \n')" = 2 ] || fail target-block-size
 [ "$("$B" stat -c %s "$pending")" = "$size" ] || fail target-size
 "$B" blkid "$pending" | "$B" grep -q "UUID=\"$uuid\"" || fail target-uuid
 # Preserve the original inode before atomically replacing the active filename.
 "$B" ln "$original" "$preserved"
 "$B" mv "$pending" "$original"
 "$B" sync
 echo "AWAI_SMALL_IMAGE_MIGRATED_4K_CONTENT_ATTRIBUTES_MATCHED $name"
done
