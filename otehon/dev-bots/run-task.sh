#!/bin/zsh
# One developer-bot task, end to end, with no Claude in the loop.
#   run-task.sh <task-dir> [--no-deliver] [--from review|deliver]
# <task-dir> is an isolated clone or worktree on the task branch, holding
#   .agent-output/task.json        issue, repo, branch, title, tests, merge (auto|draft)
#   .agent-output/muse-prompt.md   the implementer's instructions (acceptance included)
# Phases: run1 implementer (Muse) -> run2 shinsa review (fresh Muse session) -> deliver.mjs (no model).
set -u
HERE=${0:A:h}
D=${1:A}; shift
DELIVER=1; FROM=implement
while (( $# )); do case $1 in --no-deliver) DELIVER=0;; --from) shift; FROM=$1;; esac; shift; done
cd "$D" || exit 2
O=.agent-output
[[ -f $O/task.json && -f $O/muse-prompt.md ]] || { echo "task.json and muse-prompt.md are required" >&2; exit 2; }
MODEL=${MUSE_MODEL:-muse-spark-1.3}
phase() { # name promptfile
  date -u +%FT%TZ > $O/$1.start
  muse usage --json > $O/$1.usage-before.json 2>/dev/null
  muse exec --json --model $MODEL --reasoning-effort ${MUSE_EFFORT:-high} --trust-workspace \
    --disable-approval --sandbox-network enabled --workspace . --prompt-file "$2" > $O/$1.jsonl 2> $O/$1.err
  echo $? > $O/$1.rc
  date -u +%FT%TZ > $O/$1.end
  muse usage --json > $O/$1.usage-after.json 2>/dev/null
}
if [[ $FROM == implement ]]; then
  phase run1 $O/muse-prompt.md
  [[ "$(cat $O/run1.rc)" == 0 ]] || { echo failed-implement > $O/pipeline.done; exit 1; }
fi
if [[ $FROM != deliver ]]; then
  rm -f $O/verdict.json
  cp $HERE/shinsa/SOUL.md $O/shinsa-prompt.md
  phase run2 $O/shinsa-prompt.md
  [[ "$(cat $O/run2.rc)" == 0 ]] || { echo failed-review > $O/pipeline.done; exit 1; }
  # A verdict with a format error gets one repair turn (format only); the gate still fails closed after it.
  PROBLEMS=$(node $HERE/check-verdict.mjs "$D")
  if [[ -n $PROBLEMS ]]; then
    { echo "Your verdict file .agent-output/verdict.json has format problems: $PROBLEMS"; echo "Rewrite only that file so it matches the shape below exactly. Do not change your decision or any other file."; echo; sed -n '/^## Output/,/^## Boundaries/p' $HERE/shinsa/SOUL.md; } > $O/verdict-repair-prompt.md
    phase run3 $O/verdict-repair-prompt.md
  fi
fi
if (( DELIVER )); then node $HERE/deliver.mjs "$D" > $O/deliver.log 2>&1; echo "deliver rc=$?" >> $O/deliver.log; fi
echo done > $O/pipeline.done
