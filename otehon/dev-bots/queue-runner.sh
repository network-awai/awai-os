#!/usr/bin/env bash
# Work through a queue of developer-bot tasks, one at a time.
#   queue-runner.sh <queue-dir> [--once]
#
# Layout under <queue-dir>/:
#   inbox/<name>/    task.json + muse-prompt.md; ready when a file named
#                    "ready" exists in the entry (a half-copied entry is
#                    never taken)
#   running/<name>/  entry being worked on
#   done/<name>/     result.json with state "done"
#   failed/<name>/   result.json with state "failed" and a reason
#   work/<name>/     clone of the task repository (never deleted by us)
#   runner.lock      pid of the running runner (one runner per queue)
#   runner.log       one line per state change (UTC, no task content, no tokens)
#   stop             when present, the runner exits 0 after the current entry
#
# Runs under bash on macOS and on Debian (including Android userland).
# No zsh-only syntax is used.
#
# Environment:
#   DEV_BOTS_ALLOWED_OWNERS  comma-separated repo owners; empty or unset
#                            refuses to start (exit 2). No default.
#   DEV_BOTS_CLONE_BASE      prefix for "<repo>.git" (default https://github.com/).
#   DEV_BOTS_CLONE_ARGS      word-split clone flags (default --filter=blob:none).
#   DEV_BOTS_RUN_TASK        task script (default: run-task.sh next to this script).
#   DEV_BOTS_TOKEN_CMD       shell command run with bash -c (TASK_OWNER and
#                            TASK_REPO exported) whose stdout is the GH_TOKEN
#                            for the delivery phase only. Unset: delivery runs
#                            with the ambient environment.
#   DEV_BOTS_QUEUE_POLL_S    seconds between polls without --once (default 30).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

ONCE=0
QUEUE_ARG=""
for arg in "$@"; do
  case $arg in
    --once) ONCE=1;;
    -h|--help)
      echo "usage: queue-runner.sh <queue-dir> [--once]" >&2
      exit 2;;
    -*)
      echo "unknown argument: $arg" >&2
      exit 2;;
    *)
      if [ -n "$QUEUE_ARG" ]; then echo "usage: queue-runner.sh <queue-dir> [--once]" >&2; exit 2; fi
      QUEUE_ARG=$arg;;
  esac
done
if [ -z "$QUEUE_ARG" ]; then
  echo "usage: queue-runner.sh <queue-dir> [--once]" >&2
  exit 2
fi
QUEUE="$(cd "$QUEUE_ARG" 2>/dev/null && pwd)" || { echo "queue-runner: no such directory: $QUEUE_ARG" >&2; exit 2; }

if [ -z "${DEV_BOTS_ALLOWED_OWNERS:-}" ]; then
  echo "queue-runner: DEV_BOTS_ALLOWED_OWNERS is empty or unset; refusing to start" >&2
  exit 2
fi

RUN_TASK="${DEV_BOTS_RUN_TASK:-$HERE/run-task.sh}"
# Owners as a list, so an empty list is refused as well as an empty string.
mapfile -t OWNER_LIST < <(printf '%s' "$DEV_BOTS_ALLOWED_OWNERS" | tr ',' '\n')
if [ "${#OWNER_LIST[@]}" -eq 0 ]; then
  echo "queue-runner: DEV_BOTS_ALLOWED_OWNERS lists no owner; refusing to start" >&2
  exit 2
fi
OWNERS_CSV="$(IFS=,; echo "${OWNER_LIST[*]}")"
POLL_S="${DEV_BOTS_QUEUE_POLL_S:-30}"
case $POLL_S in ''|*[!0-9]*) POLL_S=30;; esac
LOCK="$QUEUE/runner.lock"
LOG="$QUEUE/runner.log"

now() { date -u +%FT%TZ; }

# A literal newline. Kept in a variable so the expansions below stay plain for bash 3.2 (macOS).
NL='
'

log_line() { # name state reason
  printf '%s %s %s %s\n' "$(now)" "$1" "$2" "$3" >> "$LOG"
}

# One runner per queue. A lock whose pid is not running is taken over.
if [ -f "$LOCK" ]; then
  OLD_PID="$(cat "$LOCK" 2>/dev/null || true)"
  case $OLD_PID in
    ''|*[!0-9]*) ;;
    *)
      if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "queue-runner: another runner (pid $OLD_PID) holds $LOCK" >&2
        exit 3
      fi;;
  esac
fi
echo "$$" > "$LOCK"
release_lock() { rm -f "$LOCK"; }
trap release_lock EXIT
# A signal ends the runner (the EXIT trap then releases the lock). Without the
# explicit exit the handler would return and the loop would go on, unlocked.
# During an entry bash runs the handler when the current command returns, so
# the entry in hand is finished first.
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$QUEUE/inbox" "$QUEUE/running" "$QUEUE/done" "$QUEUE/failed" "$QUEUE/work"

write_result() { # running-dir name state reason started ended [ignore_work]
  local dir=$1 name=$2 state=$3 reason=$4 started=$5 ended=$6 ignore_work=${7:-0}
  local deliver="$QUEUE/work/$name/.agent-output/deliver.json"
  local deliver_arg="-"
  if [ "$ignore_work" = 0 ] && [ -f "$deliver" ]; then deliver_arg="$deliver"; fi
  local pipeline="$QUEUE/work/$name/.agent-output/pipeline.done"
  local pipeline_arg="-"
  if [ "$ignore_work" = 0 ] && [ -f "$pipeline" ]; then pipeline_arg="$pipeline"; fi
  node "$HERE/queue.mjs" write-result --name "$name" \
    --task "$dir/task.json" --state "$state" --reason "$reason" \
    --started "$started" --ended "$ended" \
    --pipeline "$pipeline_arg" --deliver "$deliver_arg" \
    --out "$dir/result.json"
}

finish_entry() { # name state reason started
  local name=$1 state=$2 reason=$3 started=$4
  local dir="$QUEUE/running/$name"
  write_result "$dir" "$name" "$state" "$reason" "$started" "$(now)"
  if [ "$state" = done ]; then
    mv "$dir" "$QUEUE/done/$name"
  else
    mv "$dir" "$QUEUE/failed/$name"
  fi
  log_line "$name" "$state" "$reason"
}

# Entries left in running/ by a dead runner are never re-run: a re-run
# could deliver twice. Their work dirs are left in place.
for rdir in "$QUEUE"/running/*/; do
  [ -d "$rdir" ] || continue
  rname="$(basename "$rdir")"
  # Stale work-dir records from the killed run are ignored: the only fact
  # recorded is that the entry was interrupted.
  write_result "$rdir" "$rname" failed interrupted "" "$(now)" 1
  mv "$rdir" "$QUEUE/failed/$rname"
  log_line "$rname" failed interrupted
done

while true; do
  # Stop after the current entry; the file itself is left alone.
  if [ -f "$QUEUE/stop" ]; then exit 0; fi

  # Next ready entry in ascending name order. An entry is ready only when
  # a file named "ready" exists in it.
  NEXT=""
  NAMES="$(cd "$QUEUE/inbox" 2>/dev/null && for d in */; do
    [ -d "$d" ] || continue
    basename "$d"
  done | LC_ALL=C sort)"
  while IFS= read -r ename; do
    [ -n "$ename" ] || continue
    if [ -f "$QUEUE/inbox/$ename/ready" ]; then NEXT=$ename; break; fi
  done <<< "$NAMES"

  if [ -z "$NEXT" ]; then
    if [ "$ONCE" = 1 ]; then exit 0; fi
    # Wait in the background so a signal is handled at once, not after the poll.
    sleep "$POLL_S" &
    SLEEP_PID=$!
    wait "$SLEEP_PID" || { kill "$SLEEP_PID" 2>/dev/null; }
    continue
  fi

  STARTED="$(now)"
  mv "$QUEUE/inbox/$NEXT" "$QUEUE/running/$NEXT"
  RDIR="$QUEUE/running/$NEXT"
  log_line "$NEXT" running started

  if VALID="$(node "$HERE/queue.mjs" validate-entry "$NEXT" \
    --task "$RDIR/task.json" --prompt "$RDIR/muse-prompt.md" \
    --owners "$OWNERS_CSV")"; then
    # "ok <issue> <repo> <branch>"; fields carry no spaces by validation.
    # shellcheck disable=SC2086
    set -- $VALID
    REPO=$3; BRANCH=$4
  else
    # "invalid <reason>" with a fixed reason code from the core; anything
    # else (no output, a crash) fails closed with a generic reason.
    REASON="${VALID#invalid }"
    if [ "$REASON" = "$VALID" ] || [ -z "$REASON" ]; then REASON=invalid; fi
    finish_entry "$NEXT" failed "$REASON" "$STARTED"
    continue
  fi
  OWNER="${REPO%%/*}"; REPONAME="${REPO#*/}"

  WDIR="$QUEUE/work/$NEXT"
  if [ -e "$WDIR" ]; then
    # Never deleted: an existing work dir is an error, not a cleanup.
    finish_entry "$NEXT" failed work-exists "$STARTED"
    continue
  fi
  CLONE_BASE="${DEV_BOTS_CLONE_BASE:-https://github.com/}"
  # Word-split deliberately (same as MUSE_SANDBOX_ARGS in run-task.sh):
  # the value carries plain flags, and an empty value passes zero flags.
  # shellcheck disable=SC2086
  git clone ${DEV_BOTS_CLONE_ARGS---filter=blob:none} \
    "${CLONE_BASE}${REPO}.git" "$WDIR" >/dev/null 2>&1 || {
    finish_entry "$NEXT" failed clone-failed "$STARTED"
    continue
  }
  git -C "$WDIR" checkout -qb "$BRANCH" &&
    git -C "$WDIR" rev-parse --verify -q HEAD >/dev/null 2>&1 || {
    finish_entry "$NEXT" failed branch-failed "$STARTED"
    continue
  }
  mkdir -p "$WDIR/.agent-output"
  cp "$RDIR/task.json" "$WDIR/.agent-output/task.json"
  cp "$RDIR/muse-prompt.md" "$WDIR/.agent-output/muse-prompt.md"

  # Implement and review with no token in the environment.
  env -u GH_TOKEN -u GITHUB_TOKEN "$RUN_TASK" "$WDIR" --no-deliver >/dev/null 2>&1
  IMPLEMENT_RC=$?
  PIPELINE=""
  if [ -f "$WDIR/.agent-output/pipeline.done" ]; then
    PIPELINE="$(tr -d '\r\n' < "$WDIR/.agent-output/pipeline.done")"
  fi
  if [ "$IMPLEMENT_RC" -ne 0 ] || [ "$PIPELINE" != done ]; then
    finish_entry "$NEXT" failed implement-failed "$STARTED"
    continue
  fi

  TOKEN=""
  if [ -n "${DEV_BOTS_TOKEN_CMD:-}" ]; then
    # The token lives in a shell variable only: never logged, never
    # written to a file, never copied into result.json. Stderr travels
    # through a pipe into queue.mjs (never a file) for a one-line detail
    # that is logged only when no token results; on success it is dropped,
    # so the success log lines are exactly as before.
    # Layout of the capture: <token command stdout> NL <detail> NL RC=<status>.
    # It is taken apart outside the substitution: bash 3.2 (macOS) cannot
    # parse a case statement inside $( ).
    TOKEN_CAPTURED="$(
      exec 3>&1
      TOKEN_INNER="$(TASK_OWNER="$OWNER" TASK_REPO="$REPONAME" bash -c "$DEV_BOTS_TOKEN_CMD" 2>&1 1>&3 3>&- | node "$HERE/queue.mjs" token-failure-detail; printf 'RC=%s' "${PIPESTATUS[0]}")"
      printf '\n%s\n' "$TOKEN_INNER"
    )"
    TOKEN_RC="${TOKEN_CAPTURED##*$NL}"
    TOKEN_REST="${TOKEN_CAPTURED%$NL*}"
    TOKEN_DETAIL="${TOKEN_REST##*$NL}"
    TOKEN="${TOKEN_REST%$NL*}"
    case $TOKEN_RC in
      RC=0) ;;
      *) TOKEN="";;
    esac
    # No detail line came back (queue.mjs did not run): what sits in that
    # position is the command's stdout, which must never be logged.
    case $TOKEN_REST in
      *"$NL"*) ;;
      *) TOKEN_DETAIL=unknown;;
    esac
    [ -n "$TOKEN_DETAIL" ] || TOKEN_DETAIL=unknown
    TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
    if [ -z "$TOKEN" ]; then
      log_line "$NEXT" token-error "$TOKEN_DETAIL"
      finish_entry "$NEXT" failed no-token "$STARTED"
      continue
    fi
  fi

  if [ -n "$TOKEN" ]; then
    GH_TOKEN="$TOKEN" "$RUN_TASK" "$WDIR" --from deliver >/dev/null 2>&1
    DELIVER_RC=$?
  else
    "$RUN_TASK" "$WDIR" --from deliver >/dev/null 2>&1
    DELIVER_RC=$?
  fi
  TOKEN=""
  if [ "$DELIVER_RC" -ne 0 ]; then
    finish_entry "$NEXT" failed deliver-failed "$STARTED"
    continue
  fi
  # A held or draft delivery decision is still done: the gate decided,
  # and deliver.decision in result.json shows it.
  finish_entry "$NEXT" done done "$STARTED"
done
