# Awai PC pilot OTA feed origin (ota.awai.network)

`https://ota.awai.network/v1/pc/pilot/...` — a Cloudflare Worker that
serves the Updater feed for the Awai PC pilot and streams signed OTA
payloads. Plain JS, zero dependencies, no build step. **No R2.**

Upstream contract: [../android/desktop/pc-ab-device/README.md](../../android/desktop/pc-ab-device/README.md)
"Updater feed in the release build (AWAI-3064)" — feed URL
`https://ota.awai.network/v1/pc/pilot/{device}/{incr}/builds.json`, index
as `application/json` / `Cache-Control: no-store`, withdrawal as `[]`,
payloads at digest-qualified `/v1/pc/pilot/` paths answering HTTP Range.
The Updater only accepts an `ota.awai.network` https URI whose path
starts with `/v1/pc/pilot/` ([updater-pc-maintenance.patch](../../android/desktop/pc-ab-device/patches/updater-pc-maintenance.patch)).

What this Worker does today:

| Path | Answer |
| --- | --- |
| `/v1/pc/pilot/{device}/{incr}/builds.json` (well-formed) | `200` `application/json` `no-store`; `[]` when unpublished/withdrawn |
| `/v1/pc/pilot/blobs/<sha256>.zip` (also `/v1/pc/pilot/<sha256>.zip`) | streams the bytes from the yataverse gateway via the manifest; `200` whole or `206` + `Content-Range` on Range; immutable cache; upstream `ETag` passed through (else the `sha256` hex); `404`, never `500`, when the bytes are not ingested (upstream 504 is converted to 404) |

Payload storage is the yataverse protocol, manifest-driven:

| Size | Route |
| --- | --- |
| ≤ 16 MiB | single raw block: `CIDv1 = base32(0x01‖0x55‖0x12‖0x20‖sha256)` derived in code (no pin needed) |
| > 16 MiB | CAR route: the dag-pb root cannot be derived from the sha256 — the root CID + chunk map must be pinned in `MANIFEST_CID` (env var, per channel; the generated `src/manifest-cids.js` is the pre-deploy mirror). Ingestion limits: 256 blocks / 32 MiB per POST, site-pack per-file-node bound 43.5 MiB |

A real ~5.6 GB (hundreds of MB–GB class) OTA therefore takes the **CAR +
chunk-map path by default**; the raw path is an optimization for small
artifacts. The manifest is itself a block: its `MANIFEST_CID` is pinned as
an env var per channel and never synthesized from a name. When the router
needs a CID, it uses the pinned root CID; CID derivation alone never
decides a > 16 MiB payload.

Ingestion uses the `app-itonami-yataverse` CLI (`bin/yataverse.mjs`,
cacao-signed): for small files `yataverse cid <zip>` must print the same
CID that `scripts/publish-index.py` prints, then `yataverse put <zip>`
ingests the bytes (verified + receipt). Measured 2026-11-24: a real CID
answers `Range: bytes=0-9` with `HTTP/2 206 / content-range: bytes 0-9/55 /
accept-ranges: bytes` — see
[`docs/evidence/ota-feed-origin-20261124.md`](../../docs/evidence/ota-feed-origin-20261124.md).
Publishing an index means re-running `scripts/publish-index.py` (which reuses
`updater-feed.py make-index` — verification logic is not forked, not
re-implemented) and redeploying; the indexes live in this repo as
[`src/indexes.js`](src/indexes.js)
(audit mirror: [`indexes/indexes.json`](indexes/indexes.json)).

## yataverse is a distribution cache, not the only copy

yataverse receipts are `state:1 local-durable-readback / storeClass:1
edge-gateway / retentionUntil:0` — **no retention promise and no
replication proof**: bytes sit as a single B2 copy and can be GC'd.
Keep the original signed ZIP on the OTA side (git or another store) and
treat yataverse as a delivery cache; if long retention is required,
lease it separately (`R1 operator-archive`).

## Ingestion safety limits

Write rate is throttled: 60 requests / 60s, 64 MiB / 60s, WAF 10 req / 10s
per IP. A 40-way parallel burst got only 16 through. Default is **serial
`yataverse put`** (1–2 puts per build), never a parallel burst; retry with
the same request-id, never a new id.

## Cost

No cost commitment is recorded anywhere in this repo. The yataverse plane
itself carries no charge (B2 and Cloudflare are the operator's burden);
USD unit prices, free-tier absolute overage figures and GC presence are
**unknown** — treat any cost statement as unproven until measured.

## Run locally

```sh
cd deploy/ota-feed
node serve.mjs                 # http://127.0.0.1:8787 (payloads proxy to yataverse)
node --test test/*.test.js     # 20 tests, no network (fetch stubbed)
node test/local-check.mjs      # real loopback HTTP proof, incl. 206 ranges
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
2. Index it (≤ 16 MiB: single raw block; > 16 MiB: CAR route, needs
   `--root-cid` + `--chunk-map` from the packer):

   ```sh
   cd deploy/ota-feed
   python3.11 scripts/publish-index.py ../../out/update.zip \
     --device virtio_x86_64 --incr <post-build-incremental> \
     --release-type DEV --version 24.0 --sha256 <SIGNING-RECORD-SHA256> \
     [--require-streaming]
   # big files additionally:
   #   --root-cid <dag-pb root CID> --chunk-map <packer chunk-map JSON>
   ```

   The script checks the SHA-256 and the post-build-incremental, writes
   `src/indexes.js` + `indexes/indexes.json`, and prints the object path
   `https://ota.awai.network/v1/pc/pilot/blobs/<sha256>.zip` plus the
   route (derived CID, or the pinned CAR root) and the manifest pin
   JSON (it never deploys). For files over 16 MiB it refuses without
   `--root-cid`/`--chunk-map`.
3. Ingest the ZIP bytes into the yataverse network with the
   `app-itonami-yataverse` CLI (`bin/yataverse.mjs`, cacao-signed),
   **serially, 1–2 puts per build** (never a parallel burst):

   ```sh
   yataverse cid <zip>           # ≤ 16 MiB: the CID from the SHA-256; must
                                 # match the CID printed by publish-index.py
   yataverse put <zip>           # verified:true + returned CID + storage receipt
   ```

   The Worker serves `https://yataverse.com/ipfs/<CID>` and 404s until the
   bytes are ingested. Original ZIP stays on the OTA side (yataverse is
   a distribution cache only — see above).
4. Verify:

   ```sh
   curl -sS -D- https://ota.awai.network/v1/pc/pilot/<device>/<incr>/builds.json | head -30
   curl -sSI -H 'Range: bytes=0-99' https://ota.awai.network/v1/pc/pilot/blobs/<sha256>.zip | grep -iE 'HTTP|content-range'
   ```
5. Deploy (production; the only state change):

   ```sh
   wrangler deploy -c deploy/ota-feed/wrangler.jsonc
   ```

Withdrawal:

```sh
python3.11 scripts/publish-index.py --withdraw --device virtio_x86_64 --incr <incr>
# then: wrangler deploy -c deploy/ota-feed/wrangler.jsonc
```
