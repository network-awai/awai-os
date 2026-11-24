#!/awai/busybox sh
# The initrd pins the target and image. Only a verified RAM copy can be written.
B=/awai/busybox
pinned_profile=1
pinned_sectors=500118192
stage=/awai-install-image
write_started=false
status() {
 echo "AWAI_BOOT_STAGE $1"
 echo "<6>AWAI_BOOT_STAGE $1" > /dev/kmsg
 if [ -d /awai-status ]; then echo "$1" > /awai-status/index.html; fi
}
fail() {
 if [ "$write_started" = true ]; then
  status "PARTIALLY WRITTEN $1 (disk contents unverified)"
 else
  status "REFUSED $1 (disk untouched)"
 fi
 exec "$B" sh 3>&- 4<&-
}

"$B" mount -t proc proc /proc || fail mount-proc
"$B" mount -t sysfs sysfs /sys || fail mount-sys
"$B" mount -t devtmpfs devtmpfs /dev || fail mount-dev
exec </dev/console >/dev/console 2>&1

cmdline=$("$B" cat /proc/cmdline) || fail cmdline
case " $cmdline " in *" awai.install.profile=$pinned_profile "*) ;; *) fail invalid-mode;; esac
image_url=
image_sha=
img_bytes=
install_mode=
target_serial=
target_sectors=
[ -f /awai/install.pins ] && [ ! -L /awai/install.pins ] || fail missing-install-pins
while IFS= read -r line || [ -n "$line" ]; do
 case "$line" in
  ""|"#"*) ;;
  image_url=?*) [ -z "$image_url" ] || fail malformed-install-pins; image_url=${line#*=};;
  image_sha=?*) [ -z "$image_sha" ] || fail malformed-install-pins; image_sha=${line#*=};;
  install_mode=?*) [ -z "$install_mode" ] || fail malformed-install-pins; install_mode=${line#*=};;
  target_serial=?*) [ -z "$target_serial" ] || fail malformed-install-pins; target_serial=${line#*=};;
  target_sectors=?*) [ -z "$target_sectors" ] || fail malformed-install-pins; target_sectors=${line#*=};;
  img_bytes=?*) [ -z "$img_bytes" ] || fail malformed-install-pins; img_bytes=${line#*=};;
  *) fail malformed-install-pins;;
 esac
done < /awai/install.pins
case "$image_url" in
 http://10.77.0.1:18091/install.img) ;;
 *) fail invalid-image-url;;
esac
case "$image_sha" in *[!0-9a-f]*) fail invalid-image-sha;; esac
[ "${#image_sha}" -eq 64 ] || fail invalid-image-sha
case "$img_bytes" in ""|0*|*[!0-9]*) fail invalid-img-bytes;; esac
[ "${#img_bytes}" -le 12 ] && [ "$((img_bytes % 512))" -eq 0 ] || fail invalid-img-bytes
image_sectors=$((img_bytes / 512))

existing_root_uuid=9476f840-c703-4d5b-af77-41ea3c7986fb
existing_state_uuid=68bf9494-e41b-4ab6-ae28-3ade4cdce29d

# Require the exact filesystem UUID field, not PARTUUID or a substring.
has_uuid() {
 info=$("$B" blkid "/dev/$1") || return 1
 case " $info " in *\ UUID=\""$2"\"\ *) return 0;; *) return 1;; esac
}

disk_serial() {
 raw_serial=$("$B" cat "$1/device/serial" 2>/dev/null) || return 1
 # NVMe identify data can pad serials with trailing spaces.
 while [ "${raw_serial% }" != "$raw_serial" ]; do raw_serial=${raw_serial% }; done
 printf '%s\n' "$raw_serial"
}

identify_second_disk() {
 existing=
 target=
 for disk in /sys/block/*; do
  [ -d "$disk" ] || continue
  name=${disk##*/}
  case "$name" in
   nvme*n*)
    if [ -f "$disk/${name}p2/partition" ] && [ -f "$disk/${name}p3/partition" ] &&
       has_uuid "${name}p2" "$existing_root_uuid" &&
       has_uuid "${name}p3" "$existing_state_uuid"; then
     [ -z "$existing" ] || fail ambiguous-existing-nvme
     existing=$name
    fi;;
  esac
  serial=$(disk_serial "$disk") || continue
  if [ "$serial" = "$target_serial" ]; then
   [ -z "$target" ] || fail duplicate-target-serial
   target=$name
  fi
 done
 [ -n "$existing" ] || fail missing-existing-nvme
 [ -n "$target" ] || fail target-serial-absent
 [ "$target" != "$existing" ] || fail target-is-existing-nvme
 existing_serial=$(disk_serial "/sys/block/$existing") || fail missing-existing-serial
 [ -n "$existing_serial" ] || fail missing-existing-serial
 [ "$target_serial" != "$existing_serial" ] || fail target-is-existing-nvme
}

check_second_disk() {
 logical=$("$B" cat "/sys/block/$target/queue/logical_block_size") || fail target-sector-size
 [ "$logical" = 512 ] || fail target-sector-size
 sectors=$("$B" cat "/sys/block/$target/size") || fail unexpected-capacity
 case "$sectors" in ""|*[!0-9]*) fail unexpected-capacity;; esac
 [ "$sectors" -ge "$image_sectors" ] || fail target-too-small
 [ "$sectors" = "$target_sectors" ] || fail unexpected-capacity
 for partition in "/sys/block/$target"/*/partition; do
  [ ! -f "$partition" ] || fail "target is not blank; deliberately blank the second disk before retrying"
 done
}

# Compare the entire disk against a finite zero stream. This includes backup
# GPT and filesystem signatures near the end, even with no visible partitions.
check_blank_target() {
 blank_dir=/awai-install-blank
 "$B" mkdir -m 700 "$blank_dir" || fail blank-check
 "$B" mkfifo "$blank_dir/zeros" || fail blank-check
 (
  "$B" dd if=/dev/zero bs=1048576 count="$((sectors / 2048))" &&
   "$B" dd if=/dev/zero bs=512 count="$((sectors % 2048))"
 ) > "$blank_dir/zeros" &
 zero_pid=$!
 blank=true
 "$B" cmp -s - "/dev/$target" < "$blank_dir/zeros" || blank=false
 wait "$zero_pid" || blank=false
 [ "$blank" = true ] || fail "target is not blank; deliberately blank the second disk before retrying"
}

recheck_second_disk() {
 selected=$target
 identify_second_disk
 [ "$selected" = "$target" ] || fail target-changed
 current_seq=$("$B" cat "/sys/block/$target/diskseq") || fail target-diskseq
 [ "$current_seq" = "$target_seq" ] || fail target-changed
 check_second_disk
}

case "${install_mode:-erase}" in
 erase) pinned_mode=erase;;
 second)
  pinned_mode=second
  case "$target_serial" in ""|*[!a-zA-Z0-9._:+-]*) fail invalid-target-serial;; esac
  case "$target_sectors" in ""|0*|*[!0-9]*) fail invalid-target-capacity;; esac
  [ "${#target_sectors}" -le 12 ] || fail invalid-target-capacity
  pinned_sectors=$target_sectors;;
 *) fail invalid-install-mode;;
esac
case " $cmdline " in
 *" awai.install.mode=shared "*) fail shared-not-implemented;;
 *" awai.install.mode="*" awai.install.mode="*) fail invalid-install-mode;;
 *" awai.install.mode=$pinned_mode "*) ;;
 *) fail invalid-install-mode;;
esac
case " $cmdline " in
 *" awai.install.sectors=$pinned_sectors "*) ;;
 *) fail unexpected-capacity;;
esac

for name in nvme_keyring nvme_auth nvme_core nvme; do
 if [ ! -d "/sys/module/$name" ]; then
  module=${name%%_*}
  [ "$module" = "$name" ] || module="$module-${name#*_}"
  "$B" insmod "/awai/$module.ko" || fail nvme-module
 fi
done
if [ "$pinned_mode" = second ]; then
 # Let asynchronous block probes settle before checking both identities.
 "$B" sleep 10 || fail namespace-wait
 identify_second_disk
 check_second_disk
 target_seq=$("$B" cat "/sys/block/$target/diskseq") || fail target-diskseq
 case "$target_seq" in ""|*[!0-9]*) fail target-diskseq;; esac
 check_blank_target
 recheck_second_disk
else
 count=0
 i=0
 while [ "$i" -lt 100 ]; do
  count=0
  for disk in /sys/block/nvme*n*; do
   [ -d "$disk" ] || continue
   count=$((count + 1))
   target=${disk##*/}
  done
  [ "$count" -gt 0 ] && break
  i=$((i + 1))
  "$B" sleep 0.1 || fail namespace-wait
 done
 [ "$count" -eq 1 ] || fail namespace-count
 sectors=$("$B" cat "/sys/block/$target/size") || fail unexpected-capacity
 [ "$sectors" = "$pinned_sectors" ] || fail unexpected-capacity
 for disk in /sys/block/*; do
  case "${disk##*/}" in "$target"|loop*|ram*|zram*) ;; *) fail other-local-disk;; esac
 done
 has_uuid "${target}p2" "$existing_root_uuid" || fail wrong-root
 has_uuid "${target}p3" "$existing_state_uuid" || fail wrong-state
 [ "$image_sectors" -le "$pinned_sectors" ] || fail invalid-img-bytes
fi

# Probe NIC modules locally to enumerate MACs before configuring the link.
for module in mii phy_package realtek e1000 r8169; do
 if [ ! -d "/sys/module/$module" ]; then
  "$B" insmod "/awai/$module.ko" || fail nic-module
 fi
done
interface=
for candidate in /sys/class/net/*; do
 [ -d "$candidate" ] || continue
 mac=$("$B" cat "$candidate/address") || fail nic-address
 if [ "$mac" = 0c:47:a9:60:9d:34 ]; then interface=${candidate##*/}; break; fi
done
[ -n "$interface" ] || fail wrong-target

# Leave memory for the kernel and tools. Fail closed when RAM cannot hold the image.
available=$("$B" awk "\$1 == \"MemAvailable:\" { print \$2 }" /proc/meminfo) || fail memory-check
case "$available" in ""|*[!0-9]*) fail memory-check;; esac
[ "$available" -ge "$(((img_bytes + 1023) / 1024 + 262144))" ] || fail insufficient-image-ram
"$B" mkdir -m 700 "$stage" || fail image-staging-directory
"$B" mount -t tmpfs -o "size=$img_bytes,mode=0700" tmpfs "$stage" || fail image-staging-mount
image=$stage/install.img

echo /awai/firmware > /sys/module/firmware_class/parameters/path || fail firmware-path
"$B" ip link set "$interface" up || fail link
"$B" ip addr add 10.77.0.2/24 dev "$interface" || fail address
"$B" ip route add default via 10.77.0.1 || fail route
"$B" mkdir /awai-status || fail diagnostics-directory
status lan-diagnostics-ready
"$B" httpd -f -p 10.77.0.2:18092 -h /awai-status &
"$B" sh /awai/stream-boot-log.sh || fail boot-log-start

status image-verify-fetch
"$B" wget -q -O "$image" "$image_url" || fail image-fetch
size=$("$B" stat -c %s "$image") || fail image-size
[ "$size" = "$img_bytes" ] || fail image-size
"$B" mount -o remount,ro "$stage" || fail image-staging-readonly
digest=$("$B" sha256sum "$image") || fail image-hash
[ "${digest%% *}" = "$image_sha" ] || fail image-digest
status image-verified
echo "AWAI_INSTALL_IMAGE_VERIFIED $image_sha"
echo "To write $pinned_mode target $target ($sectors sectors) from $image_url, type the full image SHA-256:"
IFS= read -r confirm || fail confirm-read
[ "$confirm" = "$image_sha" ] || fail confirm-mismatch

write_and_verify() {
 # Track possible damage before dd can write to the target.
 write_started=true
 status install-write
 if [ "$pinned_mode" = second ]; then
  "$B" dd if="$image" bs=512 count="$image_sectors" conv=notrunc >&3 || fail image-write
 else
  "$B" dd if="$image" of="/dev/$target" bs=512 count="$image_sectors" conv=notrunc || fail image-write
 fi
 "$B" sync || fail sync
 status install-readback
 readback=/awai-install-readback
 "$B" mkdir -m 700 "$readback" || fail readback-directory
 fifo=$readback/data
 "$B" mkfifo "$fifo" || fail readback-fifo
 "$B" sha256sum < "$fifo" > "$readback/sha256" &
 hash_pid=$!
 read_ok=true
 # Open the FIFO first so even a failure to open the disk wakes the hash reader.
 if [ "$pinned_mode" = second ]; then
  "$B" dd bs=512 count="$image_sectors" <&4 > "$fifo" || read_ok=false
 else
  "$B" dd if="/dev/$target" bs=512 count="$image_sectors" > "$fifo" || read_ok=false
 fi
 wait "$hash_pid" || fail readback-hash
 [ "$read_ok" = true ] || fail readback
 digest=$("$B" cat "$readback/sha256") || fail readback-hash
 [ "${digest%% *}" = "$image_sha" ] || fail readback-digest
 echo AWAI_INSTALL_COMPLETE
 echo "Installed image read back OK. Reboot and boot the installed disk under firmware. Staying in shell."
}

write_second_disk() {
 # Both descriptors are already open. Verify that discovery still points to
 # the same kernel disk instance, then use only those descriptors for I/O.
 recheck_second_disk
 write_and_verify
}

if [ "$pinned_mode" = second ]; then
 write_second_disk 3<>"/dev/$target" 4<"/dev/$target" || fail open-target
else
 write_and_verify
fi
exec "$B" sh
