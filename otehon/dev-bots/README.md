# Developer bots (Otehon)

Itonami developer bots take a Linear issue, implement it on the Muse subscription, and deliver it through
one reviewer. Tracking: AWAI-3558 (handoff from Claude sessions), AWAI-3560 (this directory).

| File | What it is |
| -- | -- |
| `acceptance-criteria.md` | When a developer-bot pull request may merge. Start here. |
| `shinsa/` | The single review profile (`cloud.itonami.profile.v2`): `SOUL.md`, capabilities, `yakuwari.edn`. |
| `gate.mjs`, `gate.test.mjs` | The mechanical merge gate (pure) and its tests: `node --test otehon/dev-bots/gate.test.mjs`. |
| `deliver.mjs` | No model. Re-runs tests outside the sandbox, applies the gate, commits, pushes, opens the PR, squash-merges when allowed, comments on Linear with measured Muse usage. One delivery at a time per host (lock). |
| `run-task.sh` | Implementer run, `shinsa` run, then `deliver.mjs`, for one task directory. |
| `queue-runner.sh`, `queue.mjs`, `queue.test.mjs` | Work through a queue of task directories one at a time: `node --test otehon/dev-bots/queue.test.mjs`. |
| `queue-sync.mjs`, `queue-sync.test.mjs` | From another host: add entries to a queue, bring its Linear records back and post them: `node --test otehon/dev-bots/queue-sync.test.mjs`. |

## State (2026-11-19)

- Runs on a host node (macOS or Debian, including Android userland) with the `muse`, `gh`, `git`, `node`
  and `bash` CLIs. `zsh` and `orca` are optional (see Environment below). Nothing here runs on
  Android yet; the Android control surface and Awai FS / Yataverse storage of briefs and results are
  later units of AWAI-3558.
- `shinsa` is a profile source and the prompt that `run-task.sh` gives the review session. It is not
  registered in the bot registry, not installed in a profile store and has no cron (AWAI-517, AWAI-3470).
  `:bundle` is absent from `itonami.edn` until the profile is bundled by the registry tooling.
- Task intake (choosing issues from Linear, claiming them) is still done by an operator session.

## Task file

```json
{"issue": "AWAI-0000", "repo": "network-awai/example", "branch": "muse/awai-0000-short-name",
 "title": "what the PR does", "merge": "auto", "tests": ["npm ci && npm test"], "test_cwd": "."}
```

`merge` is `draft` when the issue carries an owner decision. `tests` are run by `deliver.mjs`, not by a model.

## Environment

`run-task.sh` needs only `bash` (3.2+, so macOS and Debian share the same script). The rest is
chosen by environment variables; defaults keep the previous macOS behaviour.

| Variable | Default | Meaning |
| -- | -- | -- |
| `MUSE_SANDBOX_ARGS` | `--sandbox-network enabled` | Flags `run-task.sh` passes to `muse exec`. Set to `--disable-sandbox` where the sandbox is unavailable (e.g. proot on Debian). Each run records its setting in `.agent-output/run<N>.meta`; a run without the sandbox is marked there and in the PR body. |
| `DEV_BOTS_TEST_SHELL` | `/bin/zsh` when it exists, else `/bin/bash` | Shell `deliver.mjs` uses for `task.tests`. The shell is logged per test and reported in `deliver.json`. |
| `DEV_BOTS_LINEAR` | `orca` | Linear record sink. `outbox` writes comment/status JSON under `.agent-output/linear-outbox/` instead of calling `orca` (for hosts without it). The sink is reported in `deliver.json` (`linearSink`, `linearComment`, `linearOutbox`); a missing transport never changes the gate decision. |

## Draining the outbox

A run on a host without `orca` (e.g. this phone) only writes the outbox; nothing
posts it later there. From a host that has `orca`, post the pending entries with:

```sh
node otehon/dev-bots/drain-outbox.mjs <outbox-dir> [--dry-run]
```

`<outbox-dir>` is the `linear-outbox/` directory itself, e.g.
`<task>/.agent-output/linear-outbox/`. Records post oldest-first with the same
`orca linear comment add --body-file` / `orca linear status set --to` arguments
`recordLinearEntry` uses; a comment body is staged to a temporary file, so the
stored `bodyFile` path (which points at another machine) is ignored.
Each run stages body files inside a private `mkdtempSync(join(tmpdir(), "linear-outbox-"))` directory that is removed when the run ends.

Exactly once: after a successful post the record is renamed to `<name>.posted`
in the same directory, and `.posted` files are never posted again. A record
whose post fails stays in place and blocks later records of the same issue for
that run; other issues still post, and the exit is non-zero. `--dry-run` prints
`would-post` lines without calling orca or changing any file.

This command works on a local directory. `queue-sync.mjs` (below) copies the
records off a queue host and calls it.

## Queue runner

A host works through queued tasks without being started for each one:

```sh
DEV_BOTS_ALLOWED_OWNERS=network-awai \
  otehon/dev-bots/queue-runner.sh <queue-dir> [--once]
```

Layout under `<queue-dir>/`: `inbox/<name>/` holds `task.json` and
`muse-prompt.md`; the runner moves an entry to `running/<name>/`, then to
`done/<name>/` or `failed/<name>/`, writing `result.json` there. Entries are
taken in ascending `<name>` order, one at a time.

To add an entry, write `task.json` and `muse-prompt.md` into
`inbox/<name>/`, then create the empty file `ready` in it. An entry without
`ready` is never taken, so a half-copied entry waits until it is complete.
To stop the runner, create the empty file `<queue-dir>/stop`: the runner
exits 0 after the current entry and does not delete the file.

| Variable | Default | Meaning |
| -- | -- | -- |
| `DEV_BOTS_ALLOWED_OWNERS` | *(none; must be set)* | Comma-separated repo owners. Empty or unset refuses to start (exit 2). There is no default allowlist. |
| `DEV_BOTS_CLONE_BASE` | `https://github.com/` | Prefix for `<repo>.git` when cloning into `<queue-dir>/work/<name>/`. |
| `DEV_BOTS_CLONE_ARGS` | `--filter=blob:none` | Word-split clone flags. Empty means no extra flags. |
| `DEV_BOTS_RUN_TASK` | `run-task.sh` next to the script | Task script, run as `<script> <work-dir> --no-deliver` then `<script> <work-dir> --from deliver`. |
| `DEV_BOTS_TOKEN_CMD` | *(unset)* | Shell command run with `bash -c` (`TASK_OWNER` and `TASK_REPO` exported) whose stdout is the token, exported as `GH_TOKEN` for the delivery phase only. Unset: delivery runs with the ambient environment. The implement/review phase always runs with `GH_TOKEN` and `GITHUB_TOKEN` removed. |
| `DEV_BOTS_QUEUE_POLL_S` | `30` | Seconds between polls without `--once`. |

Validation happens before anything is cloned and fails closed: a bad name,
`task.json`, issue, repo, branch, prompt or owner moves the entry to
`failed/` with the reason. `result.json` records `{name, issue, repo,
branch, state, reason, started, ended, pipeline, deliver}`; `deliver` is
read from the work dir's `deliver.json` (`decision.action`, `pr`, `merged`)
when it exists. An entry is `done` only when both phases exit 0; a held or
draft delivery decision is still `done`. One runner per queue: the lock file
under the queue dir holds the pid (a second runner exits 3; a stale lock is
taken over) and is released on exit. Entries left in `running/` by a dead
runner move to `failed/` with reason `interrupted` and are never re-run.
`runner.log` gets one line per state change (UTC timestamp, name, state,
reason); the token is never written to a file, a log or `result.json`.
When the token command yields no token, the runner logs one extra
`token-error <detail>` line (the last stderr line, sanitized and capped at
160 characters, or `redacted` when it looks token-like) before
`failed no-token`; `result.json` still records `no-token`.

What it does not do: it does not pick issues and does not restart itself
after a reboot or a killed process. Moving entries in and the Linear outbox
out is `queue-sync.mjs`.

## Feeding a queue from another host

`queue-sync.mjs` runs on the host that has `orca` (the Mac) and talks to the
queue host (the phone) in one run: push entries, collect and post records,
report.

```sh
export DEV_BOTS_REMOTE_SHELL="adb -s <serial> shell \"<userland entry> 'bash -s'\""   # or: ssh <host> bash -s
export DEV_BOTS_ALLOWED_OWNERS=network-awai
node otehon/dev-bots/queue-sync.mjs --queue <remote-queue-dir> --state <local-dir> [--dry-run] [entry-dir ...]
```

- `DEV_BOTS_REMOTE_SHELL` is run with `bash -c` and gets a bash script on its
  stdin; that is the only way the queue host is reached. It is host
  configuration: unset or empty refuses to run (exit 2). The queue host needs
  bash, coreutils and `base64`.
- An `<entry-dir>` holds `task.json` and `muse-prompt.md`; its directory name
  is the entry name. It is checked with the runner's own validation, written
  under `stage/`, then moved into `inbox/<name>/` with `ready` already in it.
  A name that exists anywhere in the remote queue, or that this `--state`
  directory already pushed, is refused.
- `--state <local-dir>` must exist. It keeps `<name>/task.json` for every
  entry pushed from here, `<name>/result.json`, and the collected records
  under `<name>/linear-outbox/`. Before the push script is sent, the intent
  is persisted as `<name>/pending.json` (task text plus the SHA-256 of
  `task.json` and `muse-prompt.md`); `task.json` is still written only on
  `PUSH <name> ok`, and the pending file is removed on `ok` or a definite
  refusal. A failed or cut push keeps `pending.json` and exits 1.
- Every run reconciles pending intents before pushing, using per-entry
  SHA-256 lines in the snapshot: matching digests recover the submission
  (`recovered <name>`), a same-name entry with different digests stays held
  (`held <name> pending-mismatch`, nothing posted), and a missing entry is
  forgotten so the caller can push again (`not-submitted <name>`).
  `--dry-run` still sends only the snapshot and never changes
  `pending.json` or `task.json`.
- Everything the queue host prints is data. Names are checked before they
  become local paths. A record is posted only when this state directory
  pushed that entry and the record's issue is the entry's issue; anything
  else is `held` and the run exits 1.
- Posted records are renamed to `*.posted` here and on the queue host. If the
  remote rename is lost, the next run repeats only the rename; it does not
  post again.
- `--dry-run` sends only the read-only snapshot script, writes nothing on the
  queue host and posts nothing (the local state directory still receives the
  collected records).
- Exit 0 when nothing was rejected, held or failed; 1 otherwise; 2 on a
  usage error. A queue with no live runner is a warning, not a failure.

## Leasing a token with retries

On a host that gets its GitHub token from a minter over a private network (the phone), one failed request
used to stop delivery after implement and review had already run. `lease-retry.mjs` wraps the lease command:

```sh
export GH_TOKEN=$(node otehon/dev-bots/lease-retry.mjs -- node kagitaba-lease.mjs lease --owner <org> --repo <repo> ...)
```

- Only a transport failure (the minter cannot be reached, or a 5xx) is retried. A refusal fails at once.
- `DEV_BOTS_LEASE_TRIES` (default 3, 1-10) and `DEV_BOTS_LEASE_WAIT_S` (default 5) bound the retries.
- `DEV_BOTS_NET_RECOVER` is an optional shell command run before each retry, for example one that reconnects
  the VPN. It is host configuration: nothing in this repository chooses or runs a recovery command by itself.
- The token is written to stdout only on success and is never logged.
