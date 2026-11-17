#!/bin/sh
# Separate qualification VM. Never replaces or reconfigures a live desktop.
set -eu
image=${1:-}
work=${2:-}
[ -n "$image" ] && [ -n "$work" ] || { echo 'usage: sh observation-launch.sh IMAGE NEW_PRIVATE_DIRECTORY' >&2; exit 2; }
case "$image:$work" in *,*) echo 'commas in QEMU paths are refused' >&2; exit 2 ;; esac
case "$image" in /*) ;; *) exit 2 ;; esac
case "$work" in /*) ;; *) exit 2 ;; esac
[ -f "$image" ] || exit 2
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}
[ -f "$firmware" ] || exit 2
umask 077
mkdir -m 700 "$work" # refuse existing state; retain all evidence after exit
cd "$work" # Keep Unix socket addresses short even in a long task worktree.
case $(uname -s) in
  Darwin) machine=virt,accel=hvf; cpu=host ;;
  *) machine=virt,accel=tcg; cpu=cortex-a72 ;;
esac
exec qemu-system-aarch64 \
  -machine "$machine" -cpu "$cpu" -smp 1 -m 1024 -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image" \
  -nic none -display none -monitor none \
  -pidfile qemu.pid -serial file:serial.log \
  -device virtio-serial-pci \
  -chardev socket,id=observe,path=guest.sock,server=on,wait=off \
  -device virtserialport,chardev=observe,name=org.qemu.guest_agent.0
