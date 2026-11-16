#!/usr/bin/env bash
# AWAI-2987: reviewed Otehon evaluation only, in this dedicated offline ARM guest.
set -euo pipefail
[ "$(cat /etc/awai-ci-executor-id 2>/dev/null)" = 'AWAI-2987/isolated-arm64' ] || { echo 'wrong executor'; exit 2; }
[ "$(uname -sm)" = 'Linux aarch64' ] || { echo 'wrong execution architecture'; exit 2; }
[ "${NIX_REMOTE:-}" = daemon ] || { echo 'isolated Nix daemon required'; exit 2; }
[ "$(stat -c %u /run/awai-ci-offline/namespace)" = 0 ] && [ "$(cat /run/awai-ci-offline/namespace)" = "$(readlink /proc/self/ns/net)" ] || { echo 'offline executor namespace required'; exit 2; }
[ "$(ip -o link show | awk -F: '{gsub(/ /,"",$2);print $2}' | grep -v '^lo$' | wc -l)" -eq 0 ] || { echo 'unexpected network interface'; exit 2; }
: "${AWAI_CI_INPUT_ROOT:?explicit admitted input directory}"
: "${AWAI_CI_SOURCE_REVISION:?explicit reviewed commit}"
: "${AWAI_CI_EVIDENCE:?new evidence directory}"
case "$AWAI_CI_INPUT_ROOT" in /*) ;; *) exit 2;; esac
[ ! -e "$AWAI_CI_EVIDENCE" ] || { echo 'refuse evidence overwrite'; exit 2; }
IFS= read -r runtime < "$AWAI_CI_INPUT_ROOT/runtime-path.txt"
[[ "$runtime" =~ ^/nix/store/[a-z0-9]{32}-awai-ci-runtime$ ]] || { echo 'runtime path refused'; exit 2; }
export PATH="$runtime/bin:/nix/var/nix/profiles/default/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export AWAI_NIXPKGS_ARCHIVE="$AWAI_CI_INPUT_ROOT/nixpkgs.tar.gz"
export NPM_CONFIG_CACHE=/home/awai-ci/.npm PYTHONDONTWRITEBYTECODE=1
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$AWAI_CI_INPUT_ROOT/source"
cd "$AWAI_CI_INPUT_ROOT/source"
[ "$(git rev-parse HEAD)" = "$AWAI_CI_SOURCE_REVISION" ] || { echo 'reviewed source changed'; exit 2; }
[ -z "$(git status --porcelain --untracked-files=all -- . ':(exclude).agent-output/**')" ] || { echo 'dirty source'; exit 2; }
mkdir -m700 "$AWAI_CI_EVIDENCE"
status=0
(
  # A fresh environment binding forces actual test execution, rather than
  # accepting the successful outputs created during dependency pre-seeding.
  export AWAI_CI_EXECUTION_ID="$(basename "$AWAI_CI_EVIDENCE")"
  for file in scripts/otehon-c1/check.nix scripts/otehon-c1/replica-check.nix nixos/otehon/storage/check.nix nixos/otehon/storage/module-check.nix; do
    export AWAI_CI_TEST_FILE="$PWD/$file"
    nix-build --no-out-link --expr 'let value=import (builtins.toPath (builtins.getEnv "AWAI_CI_TEST_FILE")); drv=if builtins.isFunction value then value {} else value; in drv.overrideAttrs (_: { AWAI_CI_EXECUTION_ID=builtins.getEnv "AWAI_CI_EXECUTION_ID"; })'
  done
  bash scripts/ci-otehon-local.sh
) > "$AWAI_CI_EVIDENCE/build.log" 2>&1 || status=$?
python3 - "$status" <<'PY'
import json,os,pathlib,platform,sys
p=pathlib.Path(os.environ['AWAI_CI_EVIDENCE'])/'result.json'
p.write_text(json.dumps({'passed':sys.argv[1]=='0','exitCode':int(sys.argv[1]),'sourceRevision':os.environ['AWAI_CI_SOURCE_REVISION'],'architecture':platform.machine(),'execution':'unprivileged tests and fresh derivations, isolated Nix daemon/network namespace, loopback only','scope':'Otehon evaluation/core tests only; not x86/KVM, installer, Native or production release'}))
PY
cat "$AWAI_CI_EVIDENCE/result.json"
exit "$status"
