#!/bin/bash
# AWAI-3064 prep (2026-11-19): build the A/B reference device lineage_virtio_x86_64 (GRUB boot control, virtual A/B)
# to exercise a signed A/B OTA in KVM. This is the upstream reference device, not the Awai PC image.
set -uo pipefail
B=/root/build; L=$B/logs; export PATH=$B/bin:/root/.cargo/bin:$PATH USE_CCACHE=1 CCACHE_EXEC=/usr/bin/ccache CCACHE_DIR=$B/ccache
export ROOMSERVICE_DRYRUN=true  # breakfast otherwise fetches lineage.dependencies and duplicates external/mainline-hw-deps
cd $B/src; source build/envsetup.sh; breakfast virtio_x86_64 userdebug || { echo "== BREAKFAST_FAILED"; exit 1; }
echo "== $(date -u +%FT%TZ) m target-files-package otatools diskimage-vda"
if m -j16 target-files-package otatools diskimage-vda; then echo "== $(date -u +%FT%TZ) AB_OK"; ls -l $OUT/obj/PACKAGING/target_files_intermediates/*.zip $OUT/*.img 2>/dev/null
else echo "== $(date -u +%FT%TZ) AB_FAILED"; cp -f out/siso_failed_commands.sh $L/ab-failed-commands-20261119.sh 2>/dev/null; fi
