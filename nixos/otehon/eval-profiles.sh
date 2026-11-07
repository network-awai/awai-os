#!/bin/sh
# Evaluate every Awai Otehon profile, so a profile that no longer evaluates fails CI.
# It instantiates each profile's image derivation (nix-instantiate): option types, assertions,
# missing files and fixed hashes are checked, but nothing is built and nothing is booted.
# usage: eval-profiles.sh [repo-root]   Exit codes: 0 all evaluated, 1 a profile failed or a
# listed name has no file, 3 the check could not run.
set -u
root=${1:-.}
dir="$root/nixos/otehon"
command -v nix-instantiate >/dev/null || { echo "NOT_RUN no nix-instantiate"; exit 3; }
[ -f "$dir/default.nix" ] || { echo "NOT_RUN no $dir/default.nix"; exit 3; }

# Every .nix file in nixos/otehon is a profile and is evaluated, except these modules, which other
# profiles import and which are not built on their own. A new module left out of this list is
# evaluated as a profile and fails, so it cannot be skipped silently.
modules="default common base-module update update-test-keys gpu media backup hardware-6600h desktop"
# desktop has no update keys, so it does not build alone: desktop-check adds the test keys.
# Release profiles that take their update keys from the builder (extraModule) are evaluated with
# the test keys instead.
keyed="disk-6600h netboot-6600h netboot-install-6600h"
# Extra evaluations of a profile: "profile@arch".
extra="vm@x86_64"

status=0
for m in $modules; do
  [ -f "$dir/$m.nix" ] || { echo "OTEHON_EVAL_STALE $m: listed in modules but $m.nix does not exist"; status=1; }
done
profiles=
for f in "$dir"/*.nix; do
  name=${f##*/}
  name=${name%.nix}
  case " $modules " in
    *" $name "*) ;;
    *) profiles="$profiles $name" ;;
  esac
done
for k in $keyed; do
  [ -f "$dir/$k.nix" ] || { echo "OTEHON_EVAL_STALE $k: listed in keyed but $k.nix does not exist"; status=1; }
done
keys="$(cd "$dir" && pwd)/update-test-keys.nix"
for p in $extra; do
  [ -f "$dir/${p%@*}.nix" ] || { echo "OTEHON_EVAL_STALE $p: listed in extra but ${p%@*}.nix does not exist"; status=1; }
done

for p in $profiles $extra; do
  name=${p%@*}
  if [ "$name" = "$p" ]; then set -- --argstr profile "$name"; else set -- --argstr profile "$name" --argstr arch "${p#*@}"; fi
  case " $keyed " in *" $name "*) set -- "$@" --argstr extraModule "$keys" ;; esac
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
