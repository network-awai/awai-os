#!/usr/bin/env bash
# Plain JVM tests for the Store's update policy, stored approval and job cancellation.
# Needs a JDK (javac, java). Not run in CI yet: Actions is disabled in this repository.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
src="$root/android/shared/src/network/awai/platform"
javac --release 8 -Xlint:-options -encoding UTF-8 -d "$out" \
  "$src/UpdatePolicy.java" "$src/UpdateApprovalRecord.java" "$src/UpdateHttpTransport.java" "$src/AutoUpdateRun.java" \
  "$root"/android/tests/jvm/*.java
java -cp "$out" UpdatePolicyTest
java -cp "$out" UpdateApprovalRecordTest
java -cp "$out" network.awai.platform.AutoUpdateRunTest
