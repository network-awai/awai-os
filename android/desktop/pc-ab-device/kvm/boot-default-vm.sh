#!/usr/bin/env bash
# AWAI-3563: boot a copy of an Awai PC install image to GRUB in an isolated VM and read back which
# entry it started by default.
#
#   boot-default-vm.sh <install image> <case> <output dir> [patch]
#
# case:  virtio     virtio-vga (the VM path): the stock first entry must start
#        amd        ati-vga (PCI 1002, class 0300) and no virtio GPU: the Radeon entry must start
#        amd-saved  as amd, with grubenv grub_android_default=android (an entry the user picked)
#        amd-stock  as amd, for an image without the patch (negative control): the stock entry starts
#
# The image is copied (a clone where the filesystem supports it) and never written. With a patch, its
# added lines are appended to the copy's ESP grub.cfg, which is what the patched device grub-boot.cfg
# adds to the end of the assembled file. The VM has no network. It uses KVM when /dev/kvm is usable
# and TCG otherwise. An ati-vga VM cannot run the amdgpu driver, so the check ends at the entry choice:
# the entry saves its own id in grubenv before it loads the kernel.
set -euo pipefail
image=${1:?install image}; case=${2:?virtio, amd or amd-saved}; out=${3:?output dir}; patch=${4:-}
here=$(cd "$(dirname "$0")/.." && pwd)
seconds=${AWAI_VM_SECONDS:-150}
[[ $case =~ ^(virtio|amd|amd-saved|amd-stock)$ ]] || { echo "unknown case $case" >&2; exit 2; }
[[ $case != amd-stock || -z $patch ]] || { echo "amd-stock runs without a patch" >&2; exit 2; }
mkdir -p "$out"
[[ ! -e $out/disk.img ]] || { echo "$out/disk.img exists" >&2; exit 2; }

cp -c "$image" "$out/disk.img" 2>/dev/null || cp --reflink=auto --sparse=always "$image" "$out/disk.img"
offset() { # <partition name>
    python3 - "$out/disk.img" "$1" <<'PY'
import struct, sys
f = open(sys.argv[1], "rb"); f.seek(512); h = f.read(92)
lba, n, size = struct.unpack("<QII", h[72:88]); f.seek(lba * 512); t = f.read(n * size)
for i in range(n):
    e = t[i * size:(i + 1) * size]
    if e[56:128].decode("utf-16le").rstrip("\0") == sys.argv[2]:
        print(struct.unpack("<Q", e[32:40])[0] * 512); break
else:
    sys.exit(f"no {sys.argv[2]} partition")
PY
}
esp="$out/disk.img@@$(offset EFI)"
persist="$out/disk.img@@$(offset persist)"

mcopy -n -i "$esp" ::/boot/grub/grub.cfg "$out/grub-original.cfg"
cp "$out/grub-original.cfg" "$out/grub.cfg"
if [[ -n $patch ]]; then
    grep '^+' "$patch" | grep -v '^+++' | sed 's/^+//' >> "$out/grub.cfg"
    mcopy -o -i "$esp" "$out/grub.cfg" ::/boot/grub/grub.cfg
fi
mcopy -n -i "$persist" ::/grubenv "$out/grubenv-before"
if [[ $case == amd-saved ]]; then
    python3 - "$out/grubenv-before" "$out/grubenv-saved" <<'PY'
import sys
b = open(sys.argv[1], "rb").read()
assert len(b) == 1024 and b"\ngrub_android_default=0\n" in b
b = b.replace(b"\ngrub_android_default=0\n", b"\ngrub_android_default=android\n")
body = b.rstrip(b"#")
open(sys.argv[2], "wb").write(body + b"#" * (1024 - len(body)))
PY
    mcopy -o -i "$persist" "$out/grubenv-saved" ::/grubenv
fi
python3 "$here/boot-default.py" cfg "$out/grub.cfg" > "$out/cfg-check.json" || true

first() { for f in "$@"; do [[ -f $f ]] && { echo "$f"; return; }; done; echo "no OVMF file among $*" >&2; exit 2; }
code=${AWAI_OVMF_CODE:-$(first /opt/homebrew/share/qemu/edk2-x86_64-code.fd /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_CODE.fd)}
vars=${AWAI_OVMF_VARS:-$(first /opt/homebrew/share/qemu/edk2-i386-vars.fd /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/OVMF/OVMF_VARS.fd)}
cp "$vars" "$out/vars.fd"
accel=tcg; [[ -r /dev/kvm && -w /dev/kvm ]] && accel=kvm
gpu=virtio-vga; [[ $case == virtio ]] || gpu=ati-vga
printf 'case=%s accel=%s gpu=%s seconds=%s patch=%s\n' "$case" "$accel" "$gpu" "$seconds" "${patch##*/}" > "$out/run.env"
set +e
timeout "$seconds" qemu-system-x86_64 -machine q35 -accel "$accel" -cpu max -smp 2 -m 2048 \
    -drive if=pflash,format=raw,readonly=on,file="$code" -drive if=pflash,format=raw,file="$out/vars.fd" \
    -drive file="$out/disk.img",if=none,id=d0,format=raw -device nvme,drive=d0,serial=awai0 \
    -device "$gpu" -display none -nic none -serial file:"$out/serial.log" -monitor none
set -e
mcopy -n -i "$persist" ::/grubenv "$out/grubenv-after"
python3 "$here/boot-default.py" env "$out/grubenv-after" > "$out/grubenv-after.json"
saved=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("grub_android_default",""))' "$out/grubenv-after.json")
info=$(LC_ALL=C tr -d '\r' < "$out/serial.log" | LC_ALL=C sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' |
    LC_ALL=C grep -a -o 'INFO: awai_gpu [a-z_]*=[0-9a-f]* [a-z_]*=[0-9a-f]* default=[^ ]*' | head -1 || true)
case $case in
    virtio) want=android ;;
    amd) want="advancedoptions-virtio_x86_64>android-awai-pc-amd-mesa" ;;
    amd-saved|amd-stock) want=android ;;
esac
ok=false; [[ $saved == "$want" ]] && ok=true
python3 - "$out/result.json" "$case" "$accel" "$gpu" "$saved" "$want" "$ok" "$info" <<'PY'
import json, sys
keys = ("case", "accel", "gpu", "savedDefault", "expectedSavedDefault", "ok", "grubInfo")
record = dict(zip(keys, sys.argv[2:]))
record["ok"] = record["ok"] == "true"
json.dump(record, open(sys.argv[1], "w"), indent=2)
print(json.dumps(record))
PY
rm -f "$out/disk.img" "$out/vars.fd"
[[ $ok == true ]]
