#!/bin/bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
pins="$here/../../../image-pins.json"
out=${1:?Pass an existing task output directory}
mkdir -p "$out"
out=$(cd "$out" && pwd)
fetch() {
  local repo=$1 rev=$2 sha=$3 archive=$4
  if [ ! -f "$archive" ]; then
    curl -fsSL --retry 2 "https://codeload.github.com/$repo/tar.gz/$rev" -o "$archive.partial"
    printf '%s  %s\n' "$sha" "$archive.partial" | shasum -a 256 -c
    mv "$archive.partial" "$archive"
  fi
  printf '%s  %s\n' "$sha" "$archive" | shasum -a 256 -c
}
fetch "$(jq -r .engine.repo "$pins")" "$(jq -r .engine.revision "$pins")" \
  "$(jq -r .engine.archiveSha256 "$pins")" "$out/sd.tar.gz"
fetch ggml-org/ggml "$(jq -r .engine.ggmlRevision "$pins")" \
  "$(jq -r .engine.ggmlArchiveSha256 "$pins")" "$out/ggml.tar.gz"
mkdir -p "$out/source/ggml"
tar -xzf "$out/sd.tar.gz" --strip-components=1 -C "$out/source"
tar -xzf "$out/ggml.tar.gz" --strip-components=1 -C "$out/source/ggml"
if [ "${2:-}" = "--fetch-only" ]; then exit 0; fi
cmake -S "$here" -B "$out/build" -DSD_SOURCE="$out/source" -DCMAKE_BUILD_TYPE=Release
cmake --build "$out/build" --parallel 4 --target murakumo-image
