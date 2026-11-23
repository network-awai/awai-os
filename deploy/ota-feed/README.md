# Awai PC pilot OTA feed origin (ota.awai.network)

`https://ota.awai.network/v1/pc/pilot/...` — a Cloudflare Worker that
serves the Updater feed for the Awai PC pilot. Plain JS, zero
dependencies, no build step. **No R2.**

Upstream contract: [../android/desktop/pc-ab-device/README.md](../../android/desktop/pc-ab-device/README.md)
"Updater feed in the release build (AWAI-3064)" — feed URL
`https://ota.awai.network/v1/pc/pilot/{device}/{incr}/builds.json`, index
as `application/json` / `Cache-Control: no-store`, withdrawal as `[]`,
payloads at pinned URLs with HTTP Range. The Updater only accepts a
package URL that matches its allowlist ([updater-pc-maintenance.patch](../../android/desktop/pc-ab-device/patches/updater-pc-maintenance.patch)).

**Scope (2026-11-24): this Worker serves ONLY the mutable index.**
It never proxies payload bytes.

## Why no payload proxy (measured 2026-11-24)

- A 32 MiB raw `yataverse put` is rejected: `put-too-large: HTTP 413`
  (16 MiB succeeds).
- A 2 MiB UnixFS file ingested via `car-put` (`verified:true, blocks:10`)
  cannot be read back: the gateway returns only the 62 B dag-pb block
  at `/ipfs/<dir-root>` and `404` for `/ipfs/<dir-root>/<file>` — there
  is no chunk-map resolution path through the gateway.

So yataverse cannot distribute OTA payloads. Payloads live at the
commit-pinned `raw.githubusercontent.com` URL carried verbatim in the
index; the pinned-raw payload + Updater allowlist + publish path is
owned by a separate change (not this Worker).

## What this Worker does

| Path | Answer |
| --- | --- |
| `/v1/pc/pilot/{device}/{incr}/builds.json` (well-formed) | `200` `application/json` `no-store`; `[]` when unpublished/withdrawn |
| anything else (off-prefix or malformed) | `400` (fail-closed before any fetch — this Worker has no upstream fetch at all) |
| non-GET/HEAD | `405` |

Index entries carry the payload `sha256` and the pinned package `url`
(plus the fields `updater-feed.py make-index` generates). The Updater
and UpdateEngine verify the signed package on device; nothing here is
trusted on the way out.

Any future block fetch must convert upstream `504` (un-ingested) to
`404` — this worker performs no fetch today, so there is no 504 to
surface.

## Run locally

```sh
cd deploy/ota-feed
node serve.mjs                 # http://127.0.0.1:8787 (index only)
node --test test/*.test.js     # 10 tests, no network
node test/local-check.mjs      # real loopback HTTP proof
python3.11 -m unittest discover -s ../../android/desktop/pc-ab-device -p 'test_updater_feed.py'
```

Status of the live origin (2026-11-23, see
[`docs/evidence/ota-feed-origin-20261123.md`](../../docs/evidence/ota-feed-origin-20261123.md)):
today every path on `ota.awai.network` returns a generic Cloudflare 404
(27150-byte Not Found page) — no OTA endpoint is served. The first
`wrangler deploy` attaches this Worker to that hostname.

## Publishing (operator; needs owner confirmation)

1. Build + sign the OTA with the existing toolchain
   ([updater-feed.py](../../android/desktop/pc-ab-device/updater-feed.py)
   `verify-target-files`, `generate-ota`, `verify-ota`).
2. Index it (the pinned payload URL is carried verbatim):

   ```sh
   cd deploy/ota-feed
   python3.11 scripts/publish-index.py ../../out/update.zip \
     --device virtio_x86_64 --incr <post-build-incremental> \
     --release-type DEV --version 24.0 --sha256 <SIGNING-RECORD-SHA256> \
     --artifact-url <pinned raw payload URL> [--require-streaming]
   ```

   The script checks the SHA-256 and the post-build-incremental, writes
   `src/indexes.js` + `indexes/indexes.json`, and prints the operator
   steps (it never deploys and never publishes payload bytes — that path
   is the separate pinned-raw change).
3. Verify:

   ```sh
   curl -sS -D- https://ota.awai.network/v1/pc/pilot/<device>/<incr>/builds.json | head -30
   ```
4. Deploy (production; the only state change):

   ```sh
   wrangler deploy -c deploy/ota-feed/wrangler.jsonc
   ```

Withdrawal:

```sh
python3.11 scripts/publish-index.py --withdraw --device virtio_x86_64 --incr <incr>
# then: wrangler deploy -c deploy/ota-feed/wrangler.jsonc
```

## Storage notes

- yataverse is for **≤ 16 MiB blocks only** (index snapshots, receipts,
  manifests) — **never for payloads**. It is a distribution cache, never
  the only copy: receipts are `state:1 local-durable-readback /
  storeClass:1 edge-gateway / retentionUntil:0` — **no retention promise
  and no replication proof** (single B2 copy, GC-able). The original ZIP
  stays on the OTA side (git); if long retention is required, lease it
  separately (`R1 operator-archive`).
- Ingestion writes are serial: 60 req / 60s, 64 MiB / 60s, WAF 10 req /
  10s per IP. A 40-way parallel burst got only 16 through. Default is
  **serial `yataverse put`** (1–2 puts per build), never a parallel
  burst; retry with the same request-id.
- **Cost: no commitment recorded.** The yataverse plane itself carries
  no charge (B2 and Cloudflare are operator burden); USD unit prices,
  free-tier absolute overage and GC presence are **unknown** — treat
  any cost statement as unproven until measured.
