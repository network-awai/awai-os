#!/usr/bin/env bash
# Privileged controller only in this task's new disposable guest, not on a host.
set -euo pipefail
[ "$(id -u)" -eq 0 ] && [ "$(cat /etc/awai-ci-executor-id 2>/dev/null)" = 'AWAI-2987/isolated-arm64' ] || { echo 'dedicated executor required'; exit 2; }
[ "$#" -eq 3 ] || { echo 'usage: INPUT_ROOT REVIEWED_SHA NEW_EVIDENCE_DIR'; exit 2; }
export AWAI_CI_INPUT_ROOT="$1" AWAI_CI_SOURCE_REVISION="$2" AWAI_CI_EVIDENCE="$3"
export AWAI_CI_WORKER="$(cd "$(dirname "$0")" && pwd)/offline-otehon.sh"
mkdir -m755 /run/awai-ci-offline
trap 'rmdir /run/awai-ci-offline 2>/dev/null || true' EXIT
systemctl stop nix-daemon.socket nix-daemon.service
rm -f /nix/var/nix/daemon-socket/socket
unshare --net bash -s <<'JOB'
set -euo pipefail
ip link set lo up
readlink /proc/self/ns/net > /run/awai-ci-offline/namespace
chmod 444 /run/awai-ci-offline/namespace
/nix/var/nix/profiles/default/bin/nix-daemon --option substituters "" --daemon > /run/awai-ci-offline/daemon.log 2>&1 &
daemon=$!
trap 'kill "$daemon" 2>/dev/null || true; wait "$daemon" 2>/dev/null || true; rm -f /run/awai-ci-offline/namespace /run/awai-ci-offline/daemon.log' EXIT
export NIX_REMOTE=daemon
export NIX_CONFIG="substituters ="
for i in $(seq 1 100); do /nix/var/nix/profiles/default/bin/nix store ping --store daemon >/dev/null 2>&1 && break; sleep .1; done
/nix/var/nix/profiles/default/bin/nix store ping --store daemon >/dev/null
runuser -u awai-ci -- env NIX_REMOTE=daemon NIX_CONFIG="$NIX_CONFIG" AWAI_CI_INPUT_ROOT="$AWAI_CI_INPUT_ROOT" AWAI_CI_SOURCE_REVISION="$AWAI_CI_SOURCE_REVISION" AWAI_CI_EVIDENCE="$AWAI_CI_EVIDENCE" bash "$AWAI_CI_WORKER"
JOB
