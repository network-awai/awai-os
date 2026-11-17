#!/usr/bin/env bash
# JUN-1321: same steps as .github/workflows/sanka-vm-gate.yml, runnable by hand so the
# check does not depend on GitHub Actions. Needs Nix; the final step boots a NixOS VM and
# wants /dev/kvm (Linux host). The workflow's runner-only "Allow this job to use KVM" step
# (udev rule + sudo) is deliberately NOT here: grant KVM access on your own host.
# Usage: scripts/ci/sanka-vm-gate.sh [cases|vm ...] (default: both). `cases` needs no KVM.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
command -v nix-shell >/dev/null || { echo "nix not found (not executed)" >&2; exit 3; }
export PYTHONDONTWRITEBYTECODE=1
cases() {
  (cd dapps/sanka
   nix-shell nix/shell.nix --run 'bb --classpath src:test test/run_cases.clj'
   nix-shell nix/shell.nix --run 'PYTHONPATH=src:test basilisp run test/run_cases.lpy')
  (cd dapps/d1
   nix-shell nix/shell.nix --run 'bb --classpath src:test test/run_cases.clj'
   nix-shell nix/shell.nix --run 'PYTHONPATH=src basilisp run test/run_cases.lpy'
   nix-shell nix/shell.nix --run 'bb --classpath src:test test/reservation_test.clj'
   nix-shell nix/shell.nix --run 'PYTHONPATH=src basilisp run test/reservation_run.lpy')
  (cd dapps/reward-loop
   nix-shell nix/shell.nix --run 'bb --classpath src:test test/run_cases.clj'
   nix-shell nix/shell.nix --run 'PYTHONPATH=src basilisp run test/run_cases.lpy')
  (cd dapps/en-devnet
   nix-shell nix/shell.nix --run 'bb --classpath src:test test/run_cases.clj'
   nix-shell nix/shell.nix --run 'PYTHONPATH=src basilisp run test/run_cases.lpy')
}
vm() {
  uname -srm; nproc; ls -l /dev/kvm || echo "no /dev/kvm: the VM gate will be slow or fail"
  nix --version; nix config show system-features
  started=$(date +%s)
  nix-build dapps/sanka/nix/vm-v1.nix --out-link result
  echo "VM gate took $(( $(date +%s) - started )) seconds"
  echo "evidence: result/evidence.json result/lying.json"
}
steps=("$@"); [ ${#steps[@]} -gt 0 ] || steps=(cases vm)
for s in "${steps[@]}"; do echo "=== $s"; "$s"; done
echo "sanka-vm-gate passed: ${steps[*]}"
