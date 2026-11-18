# awai-drive itonami profile (AWAI-3255)

`awai-drive/` is the bot side of the Awai Drive Tauri app in this directory's parent. It belongs to the itonami agent CLI store (`~/.itonami/profiles/`), not to Hermes (`~/.hermes/profiles/`).

The bot checks storage and reports. It does not evict, fetch or delete anything by itself: its output is a proposal, and the user approves each storage operation in the app.

| File | Role |
|---|---|
| `itonami.edn` | Manifest, schema `cloud.itonami.profile.v1`. Local placement, Murakumo rail on loopback only, `:cron? true`, authority from `yakuwari.edn`. |
| `yakuwari.edn` | Authority. `drive/readback-check` is `:autonomous`; `drive/evict` and `drive/prefetch` are `:approval-required`; `drive/delete` is `:blocked`; anything unlisted is `:blocked`. |
| `config.yaml` | Names the Murakumo rail at `http://127.0.0.1:8080/v1` so the rail gate resolves on this device. Nothing here starts a model server; the readback job never calls it. |
| `cron/jobs.json` | One job, `readback-check`, every 360 minutes, `no_agent: true` (script only, no model call). |
| `scripts/readback-check.mjs` | The readback check. |
| `SOUL.md` | Role text. |

## Readback check

The script needs `AWAI_DRIVE_READBACK_ORIGIN`, a loopback AwaiVol WebDAV origin such as `http://127.0.0.1:8586`. Without it, or with a non-loopback origin, it sends nothing and the run is recorded as an error.

With an origin it writes one 4 KiB random object at `awai-drive-bot-readback/<run-id>/probe.bin`, reads it back, compares SHA-256, flags an all-zero body, asks `/__availability` how the daemon classifies the object, and deletes only the object and the folders it created. It holds no key and reads no other path. A value it could not measure is written as `unknown`.

On a live volume each run leaves the probe's 4 KiB chunk in a pack until the volume's garbage collection runs, because AwaiVol deletes the name, not the chunk.

## Install and check

```sh
sh apps/drive/bot/install-profile.sh       # copies into ${ITONAMI_DIR:-~/.itonami}/profiles/awai-drive; refuses to overwrite a differing file
O=<itonami-agent checkout>/otehon/bin/itonami-otehon
P=~/.itonami/profiles/awai-drive
$O bb profile check awai-drive             # 0 errors, 0 warnings
$O bb profile readiness awai-drive         # ready
$O bb run-plan $P readback-check --capability drive/evict    # :held authority/needs-owner
AWAI_DRIVE_READBACK_ORIGIN=http://127.0.0.1:<port> $O bb run-exec $P readback-check --capability drive/readback-check
```

The bundle CID in `itonami.edn` covers the profile's files other than the manifest. After editing one, run `profile refresh-bundle awai-drive` in a scratch `ITONAMI_DIR` and copy the new CID back here. The 2026-11-18 readback is in [docs/bot-profile-readback-20261118.md](../docs/bot-profile-readback-20261118.md).
