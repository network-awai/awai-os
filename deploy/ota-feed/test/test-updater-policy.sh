#!/usr/bin/env sh
set -eu

repo=$(git rev-parse --show-toplevel)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
path=app/src/main/java/org/lineageos/updater/controller/PcPackagePolicy.java
patch="$repo/android/desktop/pc-ab-device/patches/updater-pc-maintenance.patch"
test="$repo/deploy/ota-feed/test/PcPackagePolicyTest.java"

# Apply the same new source file that configure-release installs in Android.
cd "$fixture"
git init -q
git apply --include="$path" --unidiff-zero "$patch"
javac -d classes "$path" "$test"
java -cp classes org.lineageos.updater.controller.PcPackagePolicyTest
