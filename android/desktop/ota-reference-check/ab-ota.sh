#!/bin/bash
# AWAI-3064 prep (2026-11-19): after the A/B reference build (v1), build v2 and generate OTA packages.
# Packages are signed with the AOSP test key that the unsigned v1 disk image trusts (otacerts = testkey),
# plus one package signed with a throwaway key that the device must refuse.
set -uo pipefail
B=/root/build; L=$B/logs; A=$B/ab; R=$L/ab-ota-20261119.txt; mkdir -p $A
until grep -q "AB_OK\|AB_FAILED\|BREAKFAST_FAILED" $L/ab-build2-20261119.log; do sleep 30; done
grep -q AB_OK $L/ab-build2-20261119.log || { echo "STOP v1 build failed" >> $R; echo DONE >> $R; exit 0; }
export PATH=$B/bin:/root/.cargo/bin:$PATH USE_CCACHE=1 CCACHE_EXEC=/usr/bin/ccache CCACHE_DIR=$B/ccache ROOMSERVICE_DRYRUN=true
cd $B/src; source build/envsetup.sh >/dev/null; breakfast virtio_x86_64 userdebug >/dev/null
P=out/target/product/virtio_x86_64; TF=$P/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip
cp -f $TF $A/v1-target_files.zip
ls -l $P/*.img $P/*.iso 2>/dev/null > $A/v1-images.txt
for f in $P/disk-vda.img $P/lineage-*-vda.img $P/*vda*.img; do [ -f "$f" ] && cp --sparse=always -f "$f" $A/v1-$(basename $f); done 2>/dev/null
echo "v1|$(sha256sum $A/v1-target_files.zip | cut -c1-64)|$(unzip -p $A/v1-target_files.zip SYSTEM/build.prop | grep -E 'ro.build.date.utc|ro.build.version.incremental' | tr '\n' ' ')" >> $R
ls -l $A >> $R
# v2: same source, new build number and date
s=$(date +%s)
BUILD_NUMBER=awai-ota-test-v2 BUILD_DATETIME=$(date +%s) m -j16 target-files-package > $L/ab-build-v2-20261119.log 2>&1; rc=$?
echo "v2_build|rc=$rc|$(( $(date +%s)-s ))s|$(grep -a '^#### ' $L/ab-build-v2-20261119.log | tail -1)" >> $R
[ $rc -eq 0 ] || { echo "STOP v2 build failed" >> $R; echo DONE >> $R; exit 0; }
cp -f $TF $A/v2-target_files.zip
echo "v2|$(sha256sum $A/v2-target_files.zip | cut -c1-64)|$(unzip -p $A/v2-target_files.zip SYSTEM/build.prop | grep -E 'ro.build.date.utc|ro.build.version.incremental' | tr '\n' ' ')" >> $R
export PATH=$PWD/out/host/linux-x86/bin:$B/src/prebuilts/jdk/jdk21/linux-x86/bin:$PATH
TK=build/make/target/product/security/testkey
ota(){ local n=$1; shift; local s=$(date +%s); ota_from_target_files "$@" > $L/ab-ota-$n.log 2>&1; local rc=$?
  echo "ota_$n|rc=$rc|$(( $(date +%s)-s ))s|$(ls -l ${@: -1} 2>/dev/null | awk '{print $5}')|$(sha256sum ${@: -1} 2>/dev/null | cut -c1-64)|$(tail -1 $L/ab-ota-$n.log | cut -c1-200)" >> $R; }
ota v2_full        -k $TK                      $A/v2-target_files.zip $A/ota-v2-full.zip
ota v2_incremental -k $TK -i $A/v1-target_files.zip $A/v2-target_files.zip $A/ota-v1-to-v2-incremental.zip
ota v2_wrongkey    -k $B/awai-test-keys/otakey $A/v2-target_files.zip $A/ota-v2-full-WRONGKEY.zip
ota v1_full        -k $TK                      $A/v1-target_files.zip $A/ota-v1-full-older.zip
cp -f system/update_engine/scripts/update_device.py $A/ 2>/dev/null; cp -rf system/update_engine/scripts/update_payload $A/ 2>/dev/null
ls -l $A >> $R
echo DONE >> $R
