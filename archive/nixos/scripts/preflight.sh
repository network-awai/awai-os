#!/bin/sh
set -eu
echo 'Boot mode:'
if [ -d /sys/firmware/efi ]; then echo UEFI; else echo BIOS-or-unknown; fi
echo 'Visible disks (read only):'
lsblk -o NAME,SIZE,MODEL,TRAN,TYPE,MOUNTPOINTS
echo 'Network interfaces:'
ip -br link
echo 'GPU devices:'
if command -v lspci >/dev/null 2>&1; then lspci | grep -iE 'vga|display|3d' || true; fi
echo 'No disk was modified.'
