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

- Runs on a host node (macOS) with the `muse`, `gh`, `git`, `node` and `orca` CLIs. Nothing here runs on
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
