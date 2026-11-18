# awai-drive profile: registration and readback check — 2026-11-18 (AWAI-3255)

Tool: itonami-agent Otehon CLI at `kotoba-lang/itonami-agent` `06539ad` (`otehon/bin/itonami-otehon`), runner Babashka v1.12.218, on the owner's Mac. Time: 2026-11-18 00:21–00:23 UTC.

## Registered

`sh apps/drive/bot/install-profile.sh` copied the six profile files to `~/.itonami/profiles/awai-drive/`; `diff -r` against the repo shows no difference. The Hermes store has no `awai-drive`.

| Readback | Result |
|---|---|
| `profile list` | `awai-drive`, model `murakumo-local`, itonami `yes`, scheduler `itonami`. |
| `profile check awai-drive` | 0 errors, 0 warnings. |
| `profile readiness awai-drive` | `ready`. |
| `profile refresh awai-drive --dry-run` | `keep`; bundle `bafkreiajhpvrxokw2uazdkg3dcldjpouaaacaui27ptlgapkr7w2azjsem` (5 files) has no drift. |
| `tick <dir>` | Nothing due; next `readback-check` 6 hours out. |
| `status` | `awai-drive scheduler=itonami jobs=1`. The cron gateway is not running, so the job does not run on its own yet. |
| `install-profile.sh` over a changed file | Refused (exit 1) without `--force`. |

## Readback check in an isolated namespace

A separate AwaiVol daemon was started from the deployed AWAI-3110 capsule (`network-awai-apex` `280e77e`) on a freshly initialised, empty volume, port 18595, with a local directory as its remote. The live AwaiVol daemon (port 8586), its volume and B2 were not touched. In a scratch `ITONAMI_DIR` copy of the profile:

```
AWAI_DRIVE_READBACK_ORIGIN=http://127.0.0.1:18595 itonami-otehon bb run-exec <dir> readback-check --capability drive/readback-check
ran readback-check: ok
```

| Field | Value |
|---|---|
| object | `awai-drive-bot-readback/20261118t002153104z-0530eba7/probe.bin`, 4096 bytes |
| PUT | 201, 6 ms |
| GET | 200, 4 ms |
| SHA-256 match | true |
| all-zero body | false |
| `/__availability` | `cached` |
| cleanup | done (object and the two folders it created were deleted) |

Afterwards the isolated volume manifest lists no files; the probe's 4 KiB chunk stays in pack 0 until garbage collection. The daemon was stopped after the checks.

## Fail closed

| Check | Result |
|---|---|
| No `AWAI_DRIVE_READBACK_ORIGIN` | `ran readback-check: error`, script exit 2; nothing sent. |
| Origin `http://10.77.0.1:8586` (not loopback) | Error: `origin must be http://127.0.0.1:<port> (loopback only)`; nothing sent. |
| `run-plan … --capability drive/evict` | `:held`, `authority/needs-owner`, `:side-effects :none`. |
| `run-exec … --capability drive/delete` | `refused: authority/blocked`. |
| `turn-gate <dir> hello` | Plans inference only to `127.0.0.1` (`rail/ok`); no model server was started, and none was called. |
| Negative control (scratch copy): `config.yaml` pointing at `https://api.murakumo.cloud/v1` | `profile/invalid`, `rail/denied-host api.murakumo.cloud`. |

`node --test test/bot-readback.test.mjs`: 5 of 5 pass (loopback-only origin; one probe in its own namespace with full cleanup; a namespace folder it did not create is kept; a changed byte or a zero-filled read fails; an unreachable daemon is reported with `unknown` values).

## Not covered

- No readback against the live AwaiVol daemon. AWAI-3110's readback after the async-fetch deploy is still unverified on this overloaded host (load average about 125–150, swap 23 of 24 GB during this run).
- The schedule does not run: no cron gateway is running.
- No on-device model server exists at `127.0.0.1:8080`; a chat turn would fail to connect. The readback job does not need one.
- Storage-state and free-space reports (`unsynced`, eviction and prefetch proposals) are not implemented yet; this profile carries only the readback check.
- Otehon wrote `last_error: "Failed to compute next run for recurring schedule."` and `next_run_at: null` to the scratch `jobs.json` after the successful run, while `tick` computes the next run correctly. This is in itonami-agent Otehon, not in this profile.
- No did:key was derived.
