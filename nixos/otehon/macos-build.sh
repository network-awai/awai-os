#!/bin/sh
# Build the Awai Otehon desktop image for macOS efficiently and export it.
#
# What it does:
#   1. build   nix-build the desktop profile inside the pinned Nix container,
#              reusing the persistent awai-otehon-nix podman volume as the
#              build cache (upstream cache + warm volume store, no rebuilds).
#   2. report  closure sizes (image) so growth is visible.
#   3. cache   copy the image closure to a local file:// binary cache dir
#              (survives podman volume pruning; trusted local use).
#   4. export  stream the raw image out compressed, expand on the Mac,
#              convert to compressed qcow2, record sha256.
#
# usage: macos-build.sh <out-dir>   (run from the repository root;
#        keep <out-dir> outside the repo, e.g. ~/.cache/otehon-desktop-<version>)
# env:   OTEHON_PROFILE (default desktop), OTEHON_NIX_IMAGE (pinned container),
#        OTEHON_CACHE_FROM (optional <other-out-dir> whose nix-cache/ +
#          result-path.txt pre-warm the volume store, so a rebuild only
#          fetches the diff),
#        SKIP_BUILD=1 (reuse <out-dir>/result-path.txt), SKIP_EXPORT=1.
# exit:  0 exported qcow2 + sha256 in <out-dir>, 1 build/export failed,
#        3 the check could not run (no podman/qemu-img).
set -u
out=${1:-}
[ -n "$out" ] || { echo "usage: macos-build.sh <out-dir>" >&2; exit 3; }
case "$out" in
  /*) ;;
  *) echo "macos-build.sh: <out-dir> must be absolute (got $out)" >&2; exit 64 ;;
esac
profile=${OTEHON_PROFILE:-desktop}
nix_image=${OTEHON_NIX_IMAGE:-docker.io/nixos/nix@sha256:7a70027ba790d3a79fa82faeac5f3dddc048f89e83b3901ca69542c340c9fb5c}
mkdir -p "$out"
command -v podman >/dev/null || { echo "NOT_RUN no podman" >&2; exit 3; }
if [ "${SKIP_EXPORT:-0}" != 1 ]; then
  command -v qemu-img >/dev/null || { echo "NOT_RUN no qemu-img" >&2; exit 3; }
fi

run_nix() {
  # /out is the out-dir mounted directly: never route bulk bytes through /w
  # (the repo checkout may sit on a slow filesystem).
  podman run --rm --security-opt label=disable \
    -v awai-otehon-nix:/nix -v "$PWD":/w -v "$out":/out -w /w \
    --env NIX_CONFIG=$'sandbox = false\nfilter-syscalls = false' \
    "$nix_image" "$@"
}

podman volume create awai-otehon-nix >/dev/null 2>&1 || true
if [ -n "${OTEHON_CACHE_FROM:-}" ]; then
  echo "--- pre-warm volume store from $OTEHON_CACHE_FROM ---"
  if [ -f "$OTEHON_CACHE_FROM/result-toplevel.txt" ] && [ -d "$OTEHON_CACHE_FROM/nix-cache" ]; then
    want=$(cat "$OTEHON_CACHE_FROM/result-toplevel.txt")
    # Local provenance (written by this pipeline from the same store), so no
    # signature check: production feeds stay signed via update-make-feed.sh.
    podman run --rm --security-opt label=disable \
      -v awai-otehon-nix:/nix -v "$OTEHON_CACHE_FROM":/from:ro \
      --env NIX_CONFIG=$'sandbox = false\nfilter-syscalls = false' \
      "$nix_image" nix copy --from file:///from/nix-cache --no-check-sigs \
      --extra-experimental-features nix-command "$want" \
      || echo "(pre-warm skipped: $want not in cache)"
  else
    echo "(pre-warm skipped: no result-toplevel.txt + nix-cache in $OTEHON_CACHE_FROM)"
  fi
fi
if [ "${SKIP_BUILD:-0}" = 1 ]; then
  img=$(cat "$out/result-path.txt")
else
  img=$(run_nix nix-build nixos/otehon/default.nix --argstr profile "$profile" --no-out-link) || exit 1
  echo "$img" > "$out/result-path.txt"
fi
echo "image store path: $img"
# Pin the live image as a GC root: a later nix-collect-garbage -d in this
# volume must not wipe it (or the toplevel it references). Never GC this
# volume without such a root: the container's own nix binaries resolve
# through this same store, and a blind GC breaks the next build with
# "nix-build not found".
run_nix nix-store --add-root /nix/var/nix/gcroots/otehon-live-image \
  --indirect --realise "$img" >/dev/null \
  || echo "(warning: could not pin GC root)" >&2

echo "--- closure size ---"
run_nix nix path-info -Sh --extra-experimental-features nix-command "$img" || exit 1

echo "--- local file cache (survives volume pruning) ---"
mkdir -p "$out/nix-cache"
# Cache the toplevel system closure, not the 12 GiB raw disk: content-addressed
# small paths are shared across versions and are exactly what the signed update
# feed ships (update.sh copies $system, not the raw image). A single giant raw
# NAR stalls file-cache writes; many small paths stream and stay differential.
toplevel=$(run_nix nix-build nixos/otehon/default.nix --argstr profile "$profile" \
  --argstr output system --no-out-link) || exit 1
echo "$toplevel" > "$out/result-toplevel.txt"
echo "toplevel store path: $toplevel"
run_nix nix path-info -Sh --extra-experimental-features nix-command "$toplevel" || exit 1
run_nix nix copy --to "file:///out/nix-cache" \
  --extra-experimental-features nix-command "$toplevel" || exit 1

if [ "${SKIP_EXPORT:-0}" = 1 ]; then exit 0; fi
if [ -f "$out/exported-from.txt" ] && [ "$(cat "$out/exported-from.txt")" = "$img" ] \
   && [ -f "$out/otehon-desktop.qcow2" ] && [ -f "$out/otehon-desktop.qcow2.sha256" ] \
   && (cd "$out" && shasum -a 256 -c otehon-desktop.qcow2.sha256 >/dev/null 2>&1); then
  echo "up to date: $out/otehon-desktop.qcow2 (exported from $img)"
  exit 0
fi
echo "--- export raw (gzip collapses zeros) ---"
raw=$(run_nix sh -c "ls '$img'/*.raw") || exit 1
[ -n "$raw" ] || { echo "no raw image in $img" >&2; exit 1; }
echo "raw image: $raw"
run_nix sh -c "gzip -c '$raw' > /out/image.raw.gz" || exit 1
ls -lh "$out/image.raw.gz"
echo "--- expand + convert compressed qcow2 ---"
gzip -d -c "$out/image.raw.gz" > "$out/image.raw" || exit 1
qemu-img convert -O qcow2 -c "$out/image.raw" "$out/otehon-desktop.qcow2" || exit 1
rm -f "$out/image.raw" "$out/image.raw.gz"
(cd "$out" && shasum -a 256 otehon-desktop.qcow2) | tee "$out/otehon-desktop.qcow2.sha256"
ls -lh "$out/otehon-desktop.qcow2"
echo "$img" > "$out/exported-from.txt"
echo "OK $out/otehon-desktop.qcow2"
