#!/usr/bin/env bash
# AWAI-4089 (G2): pick a Python >= 3.11 interpreter and run a unittest target.
# Requirement: pc-ab-device (24 tests) uses hashlib.file_digest (3.11+),
# so Python 3.9 is not acceptable. Candidates, in order:
#   python3 python3.13 python3.12 python3.11
# The first candidate reporting a version >= 3.11 is used, and the chosen
# interpreter with its exact version is printed before exec, so CI logs show
# what actually ran. No candidate >= 3.11: exit 1 with a clear message,
# instead of letting AttributeError surface later.
#
# Usage: scripts/ci/python-suite.sh <unittest discover args...>
set -euo pipefail
umask 077

# shellcheck disable=SC2206
candidates=(python3 python3.13 python3.12 python3.11)

pick() {
  local cand version major minor
  for cand in "${candidates[@]}"; do
    command -v "$cand" >/dev/null 2>&1 || continue
    version=$("$cand" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' 2>/dev/null) || continue
    IFS=. read -r major minor _ <<< "$version"
    if (( major > 3 || (major == 3 && minor >= 11) )); then
      printf '%s %s\n' "$cand" "$version"
      return 0
    fi
  done
  return 1
}

if ! picked=$(pick); then
  echo "AWAI_PYTHON_SUITE_REFUSES: no Python >= 3.11 found (tried: ${candidates[*]}); pc-ab-device tests need hashlib.file_digest (>=3.11)." >&2
  exit 1
fi
read -r interp version <<< "$picked"
printf 'AWAI_PYTHON_SUITE interpreter=%s version=%s\n' "$("$interp" -c 'import sys; print(sys.executable)')" "$version"
exec "$interp" -B -m unittest "$@"
