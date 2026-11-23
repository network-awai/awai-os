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
| `/v1/pc/pilot/blobs/<sha256>.zip` (also `/v1/pc/pilot/<sha256>.zip`) | streams the bytes from the yataverse gateway; `200` whole or `206` + `Content-Range` on Range; immutable cache + `sha256` etag; `404`, never `500`, when the bytes are not ingested |
| anything else | `404` JSON (no SPA fallback page is emitted from this origin) |

Payload storage is the yataverse protocol: `CIDv1 = base32(0x01‖0x55‖0x12‖0x20‖sha256)`
served at `https://yataverse.com/ipfs/<cid>`, derived in code from the
SHA-256 — no data map, no bucket. Publishing an index means re-running
`scripts/publish-index.py` (which reuses `updater-feed.py make-index` —
verification logic is not forked, not re-implemented) and redeploying;
the indexes live in this repo as [`src/indexes.js`](src/indexes.js)
(audit mirror: [`indexes/indexes.json`](indexes/indexes.json)).

## Run locally

```sh
cd deploy/ota-feed
node serve.mjs                 # http://127.0.0.1:8787 (payloads proxy to yataverse)
node --test test/*.test.js     # 14 tests, no network (fetch stubbed)
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
2. Index it:

   ```sh
   cd deploy/ota-feed
   python3.11 scripts/publish-index.py ../../out/update.zip \
     --device virtio_x86_64 --incr <post-build-incremental> \
     --release-type DEV --version 24.0 --sha256 <SIGNING-RECORD-SHA256> \
     [--require-streaming]
   ```

   The script checks the SHA-256 and the post-build-incremental, writes
   `src/indexes.js` + `indexes/indexes.json`, and prints the object path
   `https://ota.awai.network/v1/pc/pilot/blobs/<sha256>.zip` plus its
   yataverse CID (it never deploys).
3. Ingest the ZIP bytes into the yataverse network (the Worker serves
   `https://yataverse.com/ipfs/<CID>` and 404s until then).
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
