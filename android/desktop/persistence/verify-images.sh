#!/awai/busybox sh
# Read-only validation. No formatter or missing-image creation.
set -eu
B=${AWAI_VERIFY_BUSYBOX:-/awai/busybox}
fail() { echo "AWAI_IMAGE_REFUSED $1"; exit 1; }
root=${1:?Require staging root}
block_mode=${2:-compatible}
case "$block_mode" in compatible|require-4k) :;; *) fail invalid-block-mode;; esac
[ -d "$root" ] && [ ! -L "$root" ] || fail missing-install
[ "$("$B" cat "$root/restore-complete.v1")" = 'AWAI-2992 checkpoint 934334020a06b78b84a3b6ab8aac1df060b5a376bfe5ac9d1b5a6c4249f61dda verified 5 peer markers 9 encrypted files' ] || fail restore-not-verified
for spec in userdata:6442450944:9470e7ad-b343-4774-bfbb-9d3db42ce529 metadata:67108864:9da2d63b-0833-4962-9bd7-221b7a7de2d2 cache:134217728:0cd459f0-63d4-4a98-a1d4-a4b6c9443856; do
 name=${spec%%:*}; rest=${spec#*:}; size=${rest%%:*}; uuid=${rest#*:}; image="$root/$name.img"
 [ -f "$image" ] && [ ! -L "$image" ] || fail missing-image
 [ "$("$B" stat -c %s "$image")" = "$size" ] || fail image-size
 if [ "$block_mode" = require-4k ]; then
  [ "$("$B" od -An -tu4 -j1048 -N4 "$image" | "$B" tr -d ' \n')" = 2 ] || fail image-block-size
 fi
 "$B" blkid "$image" | "$B" grep -q "UUID=\"$uuid\""  || fail image-uuid
done
for spec in system:4c95555125385e1091183d4d8a8b4bdbd8c2a83b34ab56c4a180d9142588ae56 system_dlkm:1fc36abc07d3bdebec565dbbe8e2c701a8bf07c40309f0f9616c001e45d26bcb vendor:de90b3edef88f547e2eab90821764a9eee8c1f528da622284220544d6235b2ca vendor_dlkm:e2a035d1d412ffe6916b26ea50140adf12320252c4acba3a948de5e56c2eeab3 firmware:a636c0556e97f5136f0dc59ead68b64f06bd55acab355fbe79fb542f9d203e68; do
 name=${spec%%:*}; digest=${spec#*:}; image="$root/$name.img"
 [ -f "$image" ] && [ ! -L "$image" ] || fail missing-system
 [ "$("$B" sha256sum "$image" | "$B" cut -d ' ' -f 1)" = "$digest" ] || fail system-digest
done
echo AWAI_IMAGE_GUARD_VERIFIED
