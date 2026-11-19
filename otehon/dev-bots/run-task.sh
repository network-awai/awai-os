#!/usr/bin/env bash
# One developer-bot task, end to end, with no Claude in the loop.
#   run-task.sh <task-dir> [--no-deliver] [--from review|deliver]
# <task-dir> is an isolated clone or worktree on the task branch, holding
#   .agent-output/task.json        issue, repo, branch, title, tests, merge (auto|draft)
#   .agent-output/muse-prompt.md   the implementer's instructions (acceptance included)
# Phases: run1 implementer (Muse) -> run2 shinsa review (fresh Muse session) -> deliver.mjs (no model).
#
# Runs under bash on macOS and on Debian (including Android userland without
# zsh, orca or Bubblewrap). No zsh-only syntax is used; this script works with
# bash 3.2 (macOS) and newer.
#
# Environment:
#   MUSE_MODEL         model for `muse exec` (default: muse-spark-1.3).
#   MUSE_EFFORT        reasoning effort (default: high).
#   MUSE_SANDBOX_ARGS  sandbox flags for `muse exec`
#                      (default: "--sandbox-network enabled").
#                      Where the sandbox is unavailable (e.g. proot on Debian),
#                      set MUSE_SANDBOX_ARGS="--disable-sandbox".
#                      Each run records its sandbox setting in
#                      .agent-output/run<N>.meta; deliver.mjs reports a run
#                      without the sandbox in the PR body and deliver.json.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ $# -lt 1 ]; then
  echo "usage: run-task.sh <task-dir> [--no-deliver] [--from review|deliver]" >&2
  exit 2
fi
D="$(cd "$1" && pwd)" || exit 2
shift
DELIVER=1; FROM=implement
while [ $# -gt 0 ]; do
  case $1 in
    --no-deliver) DELIVER=0;;
    --from)
      shift
      FROM="${1:?--from needs a value: review|deliver}"
      case $FROM in review|deliver|implement) ;; *) echo "unknown --from: $FROM" >&2; exit 2;; esac
      ;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
  shift
done
cd "$D" || exit 2
O=.agent-output
if [ ! -f "$O/task.json" ] || [ ! -f "$O/muse-prompt.md" ]; then
  echo "task.json and muse-prompt.md are required" >&2
  exit 2
fi
MODEL=${MUSE_MODEL:-muse-spark-1.3}
SANDBOX_ARGS_STR="${MUSE_SANDBOX_ARGS:---sandbox-network enabled}"
SANDBOX_DISABLED=0
case " $SANDBOX_ARGS_STR " in *" --disable-sandbox "*) SANDBOX_DISABLED=1;; esac
# The flags are word-split at the use site (deliberate, SC2086): they carry
# no quotes or globs in practice, and a plain expansion passes zero flags
# when the value word-splits to nothing, on bash 3.2 and newer (expanding
# an empty array under `set -u` errors on bash 3.2, which stock macOS
# still ships).
write_meta() { # name
  # JSON-escape backslashes and double quotes; flags carry no control characters.
  local esc=${SANDBOX_ARGS_STR//\\/\\\\}
  esc=${esc//\"/\\\"}
  local disabled=false
  if [ "$SANDBOX_DISABLED" = 1 ]; then disabled=true; fi
  {
    echo "{"
    echo "  \"shell\": \"bash\","
    echo "  \"sandbox_args\": \"$esc\","
    echo "  \"sandbox_disabled\": $disabled"
    echo "}"
  } > "$O/$1.meta"
}
phase() { # name promptfile
  date -u +%FT%TZ > "$O/$1.start"
  muse usage --json > "$O/$1.usage-before.json" 2>/dev/null
  # shellcheck disable=SC2086
  muse exec --json --model "$MODEL" --reasoning-effort "${MUSE_EFFORT:-high}" --trust-workspace \
    --disable-approval $SANDBOX_ARGS_STR --workspace . --prompt-file "$2" > "$O/$1.jsonl" 2> "$O/$1.err"
  echo $? > "$O/$1.rc"
  date -u +%FT%TZ > "$O/$1.end"
  muse usage --json > "$O/$1.usage-after.json" 2>/dev/null
  write_meta "$1"
}
if [ "$FROM" = implement ]; then
  phase run1 "$O/muse-prompt.md"
  if [ "$(cat "$O/run1.rc")" != 0 ]; then echo failed-implement > "$O/pipeline.done"; exit 1; fi
fi
if [ "$FROM" != deliver ]; then
  rm -f "$O/verdict.json"
  cp "$HERE/shinsa/SOUL.md" "$O/shinsa-prompt.md"
  phase run2 "$O/shinsa-prompt.md"
  if [ "$(cat "$O/run2.rc")" != 0 ]; then echo failed-review > "$O/pipeline.done"; exit 1; fi
  # A verdict with a format error gets one repair turn (format only); the gate still fails closed after it.
  PROBLEMS=$(node "$HERE/check-verdict.mjs" "$D")
  if [ -n "$PROBLEMS" ]; then
    { echo "Your verdict file .agent-output/verdict.json has format problems: $PROBLEMS"; echo "Rewrite only that file so it matches the shape below exactly. Do not change your decision or any other file."; echo; sed -n '/^## Output/,/^## Boundaries/p' "$HERE/shinsa/SOUL.md"; } > "$O/verdict-repair-prompt.md"
    phase run3 "$O/verdict-repair-prompt.md"
  fi
fi
if [ "$DELIVER" -eq 1 ]; then node "$HERE/deliver.mjs" "$D" > "$O/deliver.log" 2>&1; echo "deliver rc=$?" >> "$O/deliver.log"; fi
echo done > "$O/pipeline.done"
