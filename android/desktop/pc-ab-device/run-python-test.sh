#!/usr/bin/env bash
set -euo pipefail

export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="${TEST_TMPDIR:?Bazel test scratch directory missing}"
suite="${TEST_SRCDIR:?Bazel runfiles directory missing}/${TEST_WORKSPACE:?Bazel workspace name missing}/android/desktop/pc-ab-device"

# The suites use hashlib.file_digest (Python 3.11+). Bazel is pinned by
# .bazelversion but the host interpreter is not, so resolve one explicitly
# instead of depending on which python3 PATH happens to put first
# (AWAI-3852). Without a suitable interpreter, fail here with a clear
# message rather than an AttributeError deep inside the suite.
python=""
for candidate in python3 python3.13 python3.12 python3.11; do
  if command -v "$candidate" >/dev/null 2>&1 \
    && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
    python="$candidate"
    break
  fi
done
if [ -z "$python" ]; then
  echo "run-python-test.sh: Python >= 3.11 is required (hashlib.file_digest); no suitable python3 found in PATH" >&2
  exit 1
fi
exec "$python" "$suite/${1:?Python test filename missing}"
