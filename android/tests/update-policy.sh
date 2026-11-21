#!/usr/bin/env bash
# Plain JVM tests for the Store's automatic-update policy (AWAI-3660). Needs a JDK (javac, java).
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
javac --release 8 -Xlint:-options -encoding UTF-8 -d "$out" \
  "$root/android/shared/src/network/awai/platform/UpdatePolicy.java" \
  "$root/android/tests/jvm/UpdatePolicyTest.java"
java -cp "$out" UpdatePolicyTest
