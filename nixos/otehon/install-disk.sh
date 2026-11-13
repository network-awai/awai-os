#!/usr/bin/env bash
# Writes the Otehon image to a disk the person names at this screen. There is no default target and
# no way to run it unattended: it needs the disk's serial typed, then ERASE.
# Needs IMAGE_URL, and DIGESTS: a directory with the files image, raw and bytes.
set -u
set -o pipefail

IMAGE_SHA256=$(cat "$DIGESTS/image")
RAW_SHA256=$(cat "$DIGESTS/raw")
RAW_BYTES=$(cat "$DIGESTS/bytes")

work=/run/otehon-install

disk_rows() {
  lsblk -J -d -b -o NAME,PATH,TYPE,MODEL,SIZE,SERIAL |
    jq -r '.blockdevices[] | select(.type == "disk") | [.path, (.serial // ""), (.size | tostring), (.model // "-")] | @tsv'
}

show_disks() {
  echo
  echo "Disks on this PC:"
  while IFS=$'\t' read -r path serial size model; do
    echo
    printf '  %s  %s  %s GB  serial: %s\n' "$path" "$model" "$((size / 1000000000))" "${serial:-none}"
    lsblk -n -r -p -o NAME,TYPE,SIZE,FSTYPE,LABEL,PARTLABEL "$path" |
      awk '$2 == "part" { printf "    %s %s", $1, $3; for (i = 4; i <= NF; i++) printf " %s", $i; print "" }'
  done < <(disk_rows)
  echo
}

# Prints the path, then the size, for a serial that exactly one disk has.
find_serial() {
  local wanted=$1 found="" path serial size model
  while IFS=$'\t' read -r path serial size model; do
    if [ -n "$serial" ] && [ "$serial" = "$wanted" ]; then
      [ -n "$found" ] && return 1
      found="$path $size"
    fi
  done < <(disk_rows)
  [ -n "$found" ] && echo "$found"
}

in_use() {
  local name
  [ -n "$(lsblk -n -r -o MOUNTPOINTS "$1" | tr -d '[:space:]')" ] && return 0
  while read -r name; do
    grep -q "^$name " /proc/swaps && return 0
    [ -n "$(ls -A "/sys/class/block/$(basename "$name")/holders" 2>/dev/null)" ] && return 0
  done < <(lsblk -n -r -p -o NAME "$1")
  return 1
}

discard_download() { if [ -n "$1" ]; then rm -f -- "$1"; fi; }

install_to() {
  local disk=$1 serial=$2 file=$work/image.raw.zst download="" got
  case "$IMAGE_URL" in
    file:///iso/otehon/image.raw.zst)
      file=/iso/otehon/image.raw.zst
      # Offline payload stays on the read-only ISO; do not duplicate gigabytes
      # into RAM. Verify its pinned digest before any target write as usual.
      if [ ! -f "$file" ] || [ -L "$file" ] ||
         [ "$(findmnt -n -o FSTYPE --target "$file")" != iso9660 ]; then
        echo "The offline image is not on installer media. Nothing was written."
        return 1
      fi
      case ",$(findmnt -n -o OPTIONS --target "$file")," in
        *,ro,*) ;;
        *) echo "Installer media is not read-only. Nothing was written."; return 1 ;;
      esac
      echo "Checking the offline image. Nothing is written yet."
      ;;
    file:*) echo "Unapproved offline image path. Nothing was written."; return 1 ;;
    *)
      mkdir -p "$work"
      mountpoint -q "$work" || mount -t tmpfs -o size=90% tmpfs "$work"
      download=$file
      echo "Fetching the image. Nothing is written yet."
      if ! curl -fSs --retry 5 --retry-all-errors --retry-delay 3 -o "$file" "$IMAGE_URL"; then
        echo "The image could not be fetched. Nothing was written."
        discard_download "$download"
        return 1
      fi
      ;;
  esac
  got=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$got" != "$IMAGE_SHA256" ]; then
    echo "The image digest does not match. Nothing was written."
    echo "  expected $IMAGE_SHA256"
    echo "  got      $got"
    discard_download "$download"
    return 1
  fi
  # The disk could have changed while the image was downloading.
  if [ "$(find_serial "$serial" | cut -d' ' -f1)" != "$disk" ] || in_use "$disk"; then
    echo "That disk changed. Nothing was written."
    discard_download "$download"
    return 1
  fi
  echo "Digest checked. Writing to $disk (serial $serial)."
  sgdisk --zap-all "$disk" >/dev/null 2>&1
  if ! zstd -dc "$file" | dd of="$disk" bs=4M iflag=fullblock conv=fsync status=progress; then
    echo "WRITE FAILED. $disk may not start now, and its earlier contents are damaged."
    discard_download "$download"
    return 1
  fi
  discard_download "$download"
  blockdev --flushbufs "$disk"
  echo "Checking what was written."
  got=$(head -c "$RAW_BYTES" "$disk" | sha256sum | cut -d' ' -f1)
  if [ "$got" != "$RAW_SHA256" ]; then
    echo "CHECK FAILED. What is on $disk differs from the image, so do not use it."
    return 1
  fi
  partx -a "$disk" >/dev/null 2>&1 || true
  return 0
}

echo
echo "=== Awai Otehon installer ==="
echo "This PC is running from memory. Nothing has been written."

while :; do
  show_disks
  echo "Installing ERASES the whole disk you name, and every system and file on it."
  printf 'Type the serial of the disk to erase, or press Enter to list disks again: '
  IFS= read -r serial || { sleep 5; continue; }
  [ -n "$serial" ] || continue

  target=$(find_serial "$serial") || target=""
  if [ -z "$target" ]; then
    echo "No single disk has that serial. Nothing was written."
    continue
  fi
  disk=${target% *}
  size=${target#* }
  if [ "$size" -le "$RAW_BYTES" ]; then
    echo "That disk is too small for the image of $RAW_BYTES bytes. Nothing was written."
    continue
  fi
  if in_use "$disk"; then
    echo "That disk is in use by this system. Nothing was written."
    continue
  fi

  echo
  echo "About to erase $disk:"
  lsblk -p -o NAME,MODEL,SIZE,SERIAL,FSTYPE,LABEL "$disk"
  printf 'Type ERASE to erase it, or anything else to stop: '
  IFS= read -r answer || answer=""
  if [ "$answer" != ERASE ]; then
    echo "Stopped. Nothing was written."
    continue
  fi

  # A second screen running this installer must not write at the same time.
  exec 9>/run/otehon-install.lock
  if ! flock -n 9; then
    echo "Another screen is installing. Nothing was written here."
    continue
  fi
  if install_to "$disk" "$serial"; then
    echo
    echo "INSTALLED on $disk (serial $serial)."
    echo "Restart, and choose this disk in the PC's boot menu. On first start it asks you to choose a passphrase."
    printf 'Type REBOOT to restart now: '
    IFS= read -r answer || answer=""
    [ "$answer" = REBOOT ] && systemctl reboot
  fi
  exec 9>&-
done
