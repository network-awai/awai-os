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

Exactly once: after a successful post the record is renamed to `<name>.posted`
in the same directory, and `.posted` files are never posted again. A record
whose post fails stays in place and blocks later records of the same issue for
that run; other issues still post, and the exit is non-zero. `--dry-run` prints
`would-post` lines without calling orca or changing any file.

Copying the outbox off the device (or onto the draining host) is a separate
manual step this command does not do.
