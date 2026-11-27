#!/usr/bin/env bash
# Plain JVM regression tests for HostActivity/OnlinePins allowlist parsing and limits (AWAI-3729).
# Needs a JDK (javac, java); runs Catalog integration check as well when android.jar is installed.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
src="$root/android/shared/src/network/awai/platform"

javac --release 8 -Xlint:-options -encoding UTF-8 -d "$out" \
  "$src/Integrity.java" "$src/OnlinePins.java" "$root/android/tests/jvm-pins/OnlinePinsTest.java"
java -cp "$out" OnlinePinsTest "$root"

# When the Android SDK jar is available locally, also verify against Catalog.java and LatestPointer.java.
sdk="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"
jar=""
for candidate in "$sdk/platforms/android-37.0/android.jar" "$sdk/platforms/android-36/android.jar"; do
  if [ -f "$candidate" ]; then jar="$candidate"; break; fi
done
if [ -n "$jar" ]; then
  cat_out="$out/catalog"
  mkdir -p "$cat_out"
  javac --release 8 -Xlint:-options -encoding UTF-8 -cp "$jar" -d "$cat_out" \
    "$src/Integrity.java" "$src/KeyList.java" "$src/StoreTrust.java" \
    "$src/OnlinePins.java" "$src/LatestPointer.java" "$src/Catalog.java" \
    "$root/android/tests/jvm-pins/CatalogOnlinePinsCheck.java"
  java -cp "$cat_out:$jar" CatalogOnlinePinsCheck "$root"
fi
