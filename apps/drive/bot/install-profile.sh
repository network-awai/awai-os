#!/bin/sh
# Install the awai-drive itonami profile into the itonami store (AWAI-3255).
# Copies the profile files to $ITONAMI_DIR/profiles/awai-drive (ITONAMI_DIR defaults to
# ~/.itonami). Never writes the Hermes store (~/.hermes). Refuses to overwrite a file that
# differs, unless --force is given. Run records (cron/output, jobs.json run fields) written by
# the scheduler after install count as a difference in cron/jobs.json.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
src="$here/awai-drive"
dest="${ITONAMI_DIR:-$HOME/.itonami}/profiles/awai-drive"
files="SOUL.md itonami.edn yakuwari.edn config.yaml cron/jobs.json scripts/readback-check.mjs"
force=0
[ "${1:-}" = "--force" ] && force=1

for f in $files; do
  if [ -e "$dest/$f" ] && ! cmp -s "$src/$f" "$dest/$f" && [ "$force" -ne 1 ]; then
    echo "refused: $dest/$f differs from $src/$f (use --force to replace)" >&2
    exit 1
  fi
done
mkdir -p "$dest/cron" "$dest/scripts"
for f in $files; do
  cp "$src/$f" "$dest/$f"
done
echo "installed awai-drive -> $dest"
