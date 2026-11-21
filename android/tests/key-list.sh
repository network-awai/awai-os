#!/usr/bin/env bash
# Plain JVM tests for the Store's signed key list (AWAI-3774). Needs a JDK (javac, java).
# Keys are generated inside the test and never written to disk. Not run in CI: Actions is disabled here.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
src="$root/android/shared/src/network/awai/platform"
javac --release 8 -Xlint:-options -encoding UTF-8 -d "$out" \
  "$src/KeyList.java" "$src/Integrity.java" "$root"/android/tests/jvm-keys/*.java
java -cp "$out" KeyListTest
