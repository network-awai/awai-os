#!/usr/bin/env bash
# JUN-1321: same steps as .github/workflows/android-qa-scope.yml, runnable by hand so the
# check does not depend on GitHub Actions. Needs node 22+.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mkdir -p .agent-output
node --test android/test/qa-scope.test.mjs android/test/qa-boot-route.test.mjs
node --check android/test/run-qa-device.mjs
echo "android-qa-scope check passed"
