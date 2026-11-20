#!/awai/busybox sh
set -eu
B=/awai/busybox
"$B" mount -t proc proc /proc
"$B" mount -t sysfs sysfs /sys
"$B" mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
hold() {
    while :; do "$B" sleep 3600; done
}
fail() { echo "AWAI_DISK_AUDIT_REFUSED $1"; hold; }
"$B" sh /awai/readonly-nvme.sh || fail guard
for device in /sys/block/*; do
    case "${device##*/}" in sd*|vd*|mmcblk*) fail other-local-disk;; esac
done
disk=/dev/nvme0n1
test "$("$B" blockdev --getss "$disk")" = 512 || fail sector-size
test "$("$B" blockdev --getro "$disk")" = 1 || fail not-read-only
sectors=$("$B" blockdev --getsz "$disk") || fail sector-count
case "$sectors" in ''|*[!0-9]*) fail sector-count;; esac
test "$sectors" = "$("$B" cat /sys/block/nvme0n1/size)" || fail sector-count
test "$sectors" -gt 67 || fail sector-count
printf '%s\n' "$sectors" > /tmp/sectors

snapshot() {
    tag=$1
    "$B" dd if="$disk" of="/tmp/$tag.head" bs=512 count=34 2>/dev/null || fail gpt-head
    "$B" dd if="$disk" of="/tmp/$tag.tail" bs=512 skip="$((sectors - 33))" count=33 2>/dev/null || fail gpt-tail
    test "$("$B" wc -c < "/tmp/$tag.head")" = 17408 || fail short-gpt-head
    test "$("$B" wc -c < "/tmp/$tag.tail")" = 16896 || fail short-gpt-tail
    "$B" sha256sum "/tmp/$tag.head" "/tmp/$tag.tail"
}
echo AWAI_GPT_START
snapshot before
for part in /sys/block/nvme0n1/nvme0n1p*; do
    test -e "$part/start" || continue
    name=${part##*/}
    test "$("$B" blockdev --getro "/dev/$name")" = 1 || fail partition-not-read-only
    printf 'AWAI_PARTITION %s %s %s\n' "$name" "$("$B" cat "$part/start")" "$("$B" cat "$part/size")"
    "$B" grep -E '^PART(N|NAME|UUID)=' "$part/uevent" || true
done
snapshot after
"$B" cmp -s /tmp/before.head /tmp/after.head || fail gpt-head-changed
"$B" cmp -s /tmp/before.tail /tmp/after.tail || fail gpt-tail-changed
echo AWAI_GPT_UNCHANGED
case " $("$B" cat /proc/cmdline) " in
    *" awai.disk_audit_report=1 "*)
        "$B" sh /awai/serve-gpt-audit.sh || fail report ;;
esac
hold
