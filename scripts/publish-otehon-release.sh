#!/usr/bin/env bash
# AWAI-183: prepare static signed artifacts, never upload or promote a fleet.
set -euo pipefail
[ "$#" -eq 8 ] || { echo 'usage: publish-otehon-release.sh NEW_FEED SYSTEM VERSION CHANNEL COHORTS_CSV STATE_CONTRACT ARCH SIGNING_CONFIG_JSON' >&2; exit 64; }
out=$1 system=$2 version=$3 channel=$4 cohorts=$5 contract=$6 arch=$7 signing=$8
[ ! -e "$out" ] || { echo 'refuse existing feed' >&2; exit 2; }
[[ "$system" =~ ^/nix/store/[0-9abcdfghijklmnpqrsvwxyz]{32}-[A-Za-z0-9._+-]+$ ]]
[[ "$version" =~ ^[1-9][0-9]{0,14}$ ]]
[[ "$cohorts" =~ ^[a-z0-9][a-z0-9-]*(,[a-z0-9][a-z0-9-]*)*$ ]]
case "$channel" in stable|canary) ;; *) exit 2;; esac
case "$arch" in x86_64|aarch64) ;; *) exit 2;; esac
manifest_key=$(jq -er .manifestKey "$signing")
cache_key=$(jq -er .cacheKey "$signing")
[ -f "$manifest_key" ] && [ -f "$cache_key" ]
mkdir -m 700 "$out"
nix --extra-experimental-features nix-command copy --to "file://$(realpath "$out")/cache?secret-key=$(realpath "$cache_key")&compression=xz" "$system"
now=$(date +%s)
jq -n --argjson version "$version" --arg system "$system" --arg channel "$channel" --arg cohorts "$cohorts" --arg stateContract "$contract" --arg architecture "$arch" --argjson now "$now" \
 '{schema:"awai.otehon.release.v1",version:$version,system:$system,channel:$channel,cohorts:($cohorts|split(",")),stateContract:$stateContract,architecture:$architecture,issuedAt:$now,expiresAt:($now+86400)}' > "$out/manifest.json"
minisign -S -s "$manifest_key" -m "$out/manifest.json" -x "$out/manifest.json.minisig"
echo 'Prepared local feed only. Review and publish separately; signed cohort expansion is explicit promotion.'
