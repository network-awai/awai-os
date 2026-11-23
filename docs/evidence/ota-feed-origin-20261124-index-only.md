# OTA feed origin — index-only (payload via yataverse disproven) (2026-11-24)

Date: 2026-11-24. New dated evidence; it does not rewrite earlier dated
files. This **supersedes** the payload design in
`ota-feed-origin-20261124.md` (raw CID derivation) and
`ota-feed-origin-20261124-car.md` (manifest-driven CAR route) — both of
which were invalidated by the measurement below.

## Measurement (coordinator, this Mac, 2026-11-24 00:05 UTC)

- raw 16 MiB `yataverse put` → 200 / `verified:true` (confirms the bound).
- raw 32 MiB `yataverse put` → `yataverse: put-too-large: HTTP 413`
  (the wall sits between 16 and 32 MiB).
- 2 MiB UnixFS via `car-put` → 200 / `verified:true, blocks:10` (ingest
  succeeds).
- Readback fails:
  - `GET /ipfs/<dir-root>` → 200 but `content-type: application/vnd.ipld.raw`,
    62 B (the dag-pb block itself).
  - `GET /ipfs/<dir-root>/small2m.bin` → **404**.
  - The gateway returns raw blocks only; **no file reassembly / chunk
    resolution path exists** through yataverse.
- Reference: commit-pinned `raw.githubusercontent.com` 55 MB APK →
  HEAD 200 (etag = sha256, octet-stream); `Range: bytes=0-99` → **206**.

**Conclusion:** payloads cannot be distributed via yataverse (neither
raw >16 MiB nor CAR+chunk map — the chunk map has no HTTP resolution
path; chunk-by-chunk worker assembly would also exceed Workers
subrequest limits at real OTA sizes). Decision: payloads move to the
commit-pinned raw URL path; `deploy/ota-feed/` shrinks to the mutable
index only.

## What changed in code (`deploy/ota-feed/`, PR #480)

Removed (discarded per direction):
- `src/worker.js` payload proxy (yataverse fetch, Range forwarding,
  CID derivation, MANIFEST_CID/chunk-map resolution, 504→404).
- `src/manifest-cids.js` (+ publish-script `--root-cid`/`--chunk-map`
  flags, pin writing, and `MANIFEST_CID` wrangler var).
- `wrangler.jsonc` `vars.MANIFEST_CID` entry.
- `scripts/publish-index.py` size routes and pin handling.
- Payload/manifest test suites (20 → 10 tests).

Kept (index-only):
- `GET/HEAD /v1/pc/pilot/{device}/{incr}/builds.json` → `200`, the
  stored bytes, `application/json`, `Cache-Control: no-store`; `[]` on
  withdrawal; `[]` on unpublished channels.
- Index entries carry the payload `sha256` and the pinned `url`
  (`--artifact-url` is now required; the pinned-raw format is owned by
  the separate pinned-raw change — this script never touches the
  Updater patch, and never fetches or uploads bytes).
- Off-prefix or malformed in-prefix → `400` fail-closed before any
  fetch (there is no upstream fetch; the 504→404 contract for future
  block fetches is documented in the worker header).

`docs/evidence/ota-feed-origin-20261124-car.md` and
`docs/evidence/ota-feed-origin-20261124.md` keep the yataverse
constraints that survive this change (16 MiB bound, serial-write
throttles, cache-not-the-only-copy, no cost commitment) as reference.

## Local verification (2026-11-24; Actions disabled — local totals only)

```sh
cd deploy/ota-feed && node --check src/worker.js
node --test test/*.test.js
tests 10 / pass 10 / fail 0
  (index headers/no-store, withdrawal [], unpublished [], HEAD no-body,
   blob path refused, off-prefix 400, malformed 400, 405, no r2/kv/d1
   substring test, custom-domain route)

node test/local-check.mjs → LOCAL CHECK OK (7 PASS, real loopback HTTP)

PYTHONDONTWRITEBYTECODE=1 python3.11 -m unittest discover \
    -s android/desktop/pc-ab-device -p 'test_*.py'
Ran 24 tests — OK

publish-index.py dry-runs (fixture OTAs, scratch roots — not committed):
  publish → indexes with sha256 + pinned raw URL; DA withdraw → []
  (Both exit 0; node imports the generated indexes.js.)
```

Not run: `wrangler dev` (wrangler absent), live fetch against
`ota.awai.network` after deploy (first deploy attaches the Worker),
the pinned-raw payload path itself (separate change/branch).

## Status

- payload path & Updater allowlist: owned by the separate pinned-raw
  change (codex worker) — this branch does not touch
  `android/desktop/pc-ab-device/patches/updater-pc-maintenance.patch`.
- deploy: `wrangler deploy -c deploy/ota-feed/wrangler.jsonc` — not run;
  awaits explicit owner confirmation after PR merge.
