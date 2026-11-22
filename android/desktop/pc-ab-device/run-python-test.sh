#!/usr/bin/env bash
set -euo pipefail

export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="${TEST_TMPDIR:?Bazel test scratch directory missing}"
suite="${TEST_SRCDIR:?Bazel runfiles directory missing}/${TEST_WORKSPACE:?Bazel workspace name missing}/android/desktop/pc-ab-device"
exec python3 "$suite/${1:?Python test filename missing}"
