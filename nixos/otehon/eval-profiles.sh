#!/bin/sh
# Evaluate every Awai Otehon profile, so a profile that no longer evaluates fails CI.
# It instantiates each profile's image derivation (nix-instantiate): option types, assertions,
# missing files and fixed hashes are checked, but nothing is built and nothing is booted.
# usage: eval-profiles.sh [repo-root]   Exit codes: 0 all evaluated, 1 a profile failed or
# a profile file is not listed here, 3 the check could not run.
set -u
root=${1:-.}
dir="$root/nixos/otehon"
command -v nix-instantiate >/dev/null || { echo "NOT_RUN no nix-instantiate"; exit 3; }
[ -f "$dir/default.nix" ] || { echo "NOT_RUN no $dir/default.nix"; exit 3; }

# Profiles: files default.nix can build. "profile" or "profile@arch".
profiles="vm vm@x86_64 base base-no-switch base-open-port
desktop desktop-login desktop-manimani desktop-media desktop-media-gui desktop-media-silent desktop-no-zenoh
backup-check gpu-check gpu-generate-check update-check update-check-good update-check-bad
disk-6600h netboot-6600h netboot-install-6600h"
# Modules that other profiles import and that are not built on their own.
modules="default common base-module update gpu media backup hardware-6600h"

status=0
listed=" $modules "
for p in $profiles; do listed="$listed${p%@*} "; done
for f in "$dir"/*.nix; do
  name=${f##*/}
  name=${name%.nix}
  case "$listed" in
    *" $name "*) ;;
    *) echo "OTEHON_EVAL_UNLISTED $name.nix: add it to profiles or modules in eval-profiles.sh"; status=1 ;;
  esac
done

for p in $profiles; do
  name=${p%@*}
  if [ "$name" = "$p" ]; then set -- --argstr profile "$name"; else set -- --argstr profile "$name" --argstr arch "${p#*@}"; fi
  if drv=$(nix-instantiate "$dir/default.nix" "$@" 2>"${TMPDIR:-/tmp}/otehon-eval.err"); then
    echo "OTEHON_EVAL_OK $p $drv"
  else
    echo "OTEHON_EVAL_FAIL $p"
    tail -n 20 "${TMPDIR:-/tmp}/otehon-eval.err"
    status=1
  fi
done
rm -f "${TMPDIR:-/tmp}/otehon-eval.err"
exit $status
