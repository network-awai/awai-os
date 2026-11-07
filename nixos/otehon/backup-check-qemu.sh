#!/bin/sh
# Check backup.nix on macOS with HVF: back up the state volume to a share, restore it on a
# new disk, refuse a wrong key, keep the share free of plaintext, and detect tampering.
# The image is not changed: every boot uses its own qcow2 overlay in the work directory.
#
# usage: backup-check-qemu.sh <backup-check.qcow2> <work-dir> [timeout-seconds-per-boot]
# exit:  0 every check passed
#        1 a check failed
#        3 the check could not run
set -u

image=${1:-}
work=${2:-}
timeout=${3:-300}
here=$(cd "$(dirname "$0")" && pwd)
fixtures=$here/fixtures
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}
# Lets a run swap the key of the restore disk, to show that the check fails then.
restore_key=${OTEHON_BACKUP_RESTORE_KEY:-$fixtures/backup/test-restic.key}

[ -n "$image" ] && [ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -n "$work" ] || { echo "NOT_RUN no work directory"; exit 3; }
[ -f "$firmware" ] || { echo "NOT_RUN no firmware: $firmware"; exit 3; }
for tool in qemu-system-aarch64 qemu-img; do
  command -v "$tool" >/dev/null || { echo "NOT_RUN no $tool"; exit 3; }
done
mkdir -p "$work" || { echo "NOT_RUN cannot create $work"; exit 3; }
work=$(cd "$work" && pwd)
image=$(cd "$(dirname "$image")" && pwd)/$(basename "$image")
share=$work/share
[ ! -e "$share" ] || { echo "NOT_RUN $share exists; use a new work directory"; exit 3; }
mkdir "$share"

key_disk() {
  "$here/base-make-key-disk.sh" "$fixtures/test-age.key" "$work/$1" "$2" || { echo "NOT_RUN key disk $1"; exit 3; }
}
# Disk a backs up. Disks b and c are new disks: fresh overlays with their own LUKS keys.
key_disk keys-a.tar "$fixtures/backup/test-restic.key"
key_disk keys-b.tar "$restore_key"
key_disk keys-c.tar "$fixtures/backup/test-wrong-restic.key"
for d in a b c; do
  qemu-img create -q -f qcow2 -b "$image" -F qcow2 "$work/disk-$d.qcow2" || { echo "NOT_RUN overlay $d"; exit 3; }
done

field() {
  printf '%s\n' "$1" | sed -n "s/.* $2=\([^ ]*\).*/\1/p"
}

need() {
  for pair in "$@"; do
    case " $found " in
      *" $pair "*) ;;
      *) echo "FAIL expected $pair: $found"; exit 1 ;;
    esac
  done
}

# boot <disk> <key-disk> <mode> sets $found to the report line.
boot() {
  log=$work/serial-$1-$3.log
  : > "$log"
  qemu-system-aarch64 -machine virt,accel=hvf -cpu host -smp 2 -m 2048 \
    -bios "$firmware" \
    -drive "if=virtio,format=qcow2,file=$work/disk-$1.qcow2" \
    -drive "if=none,id=keys,format=raw,readonly=on,file=$work/$2" \
    -device virtio-blk-pci,drive=keys,serial=otehon-key \
    -virtfs "local,path=$share,mount_tag=otehon-backup,security_model=none" \
    -fw_cfg "name=opt/otehon/mode,string=$3" \
    -nic none -display none -monitor none -serial "file:$log" &
  qemu=$!
  started=$(date +%s)
  while kill -0 "$qemu" 2>/dev/null; do
    if [ "$(( $(date +%s) - started ))" -ge "$timeout" ]; then
      kill "$qemu" 2>/dev/null
      echo "FAIL disk $1 mode $3: no poweroff in ${timeout}s"
      exit 1
    fi
    sleep 2
  done
  grep -a 'OTEHON_BACKUP_LOG' "$log" | tr -d '\r' | sed "s/^/  [$1 $3] /"
  found=$(grep -a "OTEHON_BACKUP_REPORT mode=$3 " "$log" | head -n 1 | tr -d '\r')
  [ -n "$found" ] || { grep -a 'otehon-state\|otehon-backup-key' "$log" | tail -n 5; echo "FAIL disk $1 mode $3: no report"; exit 1; }
  echo "$found"
}

# 1. Back up disk a.
boot a keys-a.tar backup
need state=1 target=1 key=1 backup=ok snapshots=1 check=ok failed=0
hash=$(field "$found" hash)
[ -n "$hash" ] && [ "$hash" != empty ] || { echo "FAIL no data hash"; exit 1; }

# 2. The share must hold a repository, and a search of it must not find the canary.
repo=$share/restic
[ -f "$repo/config" ] || { echo "FAIL no repository config on the share"; exit 1; }
packs=$(find "$repo/data" -type f | wc -l | tr -d ' ')
bytes=$(du -sk "$repo" | cut -f1)
[ "$packs" -gt 0 ] || { echo "FAIL no data packs"; exit 1; }
LC_ALL=C grep -r -a -q 'OTEHON_SHARE_PLAIN' "$share" || { echo "FAIL search did not find the plain canary"; exit 1; }
if LC_ALL=C grep -r -a -q 'OTEHON_BACKUP_CANARY' "$share"; then
  echo "FAIL backup canary is readable on the share"
  exit 1
fi
# The keys stay on the state volume and the key disk, never in the backup.
for key in "$fixtures/backup/test-restic.key" "$fixtures/test-age.key"; do
  secret=$(grep -v '^#' "$key" | head -n 1)
  [ -n "$secret" ] || { echo "NOT_RUN empty key file $key"; exit 3; }
  if LC_ALL=C grep -r -a -q -F "$secret" "$share"; then
    echo "FAIL key $(basename "$key") is readable on the share"
    exit 1
  fi
done
echo "SHARE packs=$packs size_kib=$bytes plain_canary=found backup_canary=absent keys=absent"

# 3. Restore on a new disk with the right key.
boot b keys-b.tar restore
need state=1 target=1 key=1 pre=empty restore=ok check=ok failed=0
[ "$(field "$found" hash)" = "$hash" ] || { echo "FAIL restored hash $(field "$found" hash) differs from $hash"; exit 1; }
echo "MATCH backup=$hash restored=$(field "$found" hash)"

# 4. A new disk with the wrong key must not restore.
boot c keys-c.tar restore
need state=1 key=1 pre=empty restore=fail reason=wrong-password hash=empty

# 5. Change bytes inside the largest pack, then the restored disk must detect it.
pack=$(find "$repo/data" -type f -exec ls -s {} + | sort -n | tail -n 1 | awk '{print $2}')
size=$(wc -c < "$pack" | tr -d ' ')
before=$(shasum -a 256 "$pack" | cut -c1-16)
chmod u+w "$pack"
printf 'OTEHON-TAMPERED-BYTES-0123456789' | dd of="$pack" bs=1 seek=$((size / 2)) conv=notrunc 2>/dev/null
after=$(shasum -a 256 "$pack" | cut -c1-16)
[ "$before" != "$after" ] || { echo "NOT_RUN tampering did not change the pack"; exit 3; }
echo "TAMPER pack=$(basename "$pack") size=$size offset=$((size / 2)) sha256 $before -> $after"
boot b keys-b.tar verify
need state=1 key=1 check=fail reason=integrity restore=fail
echo "PASS"
exit 0
