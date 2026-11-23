# OTA feed origin — ingestion unblocked, real-CID Range measured (2026-11-24)

Date: 2026-11-24 (measurement by the coordinator on this Mac,
2026-11-24 00:04 UTC / 01:04 JST; Range + derivation re-checked here the
same day). This file adds new dated evidence; it does not rewrite
`ota-feed-origin-blockers-20261124.md` (that file keeps the historical
blocker list). Status wording below supersedes that file's §"Remaining
external blockers".

## What was measured (commands + actual output)

**Ingestion tooling.** `app-itonami-yataverse` CLI (`bin/yataverse.mjs`),
`yataverse status` → `authSource: cacao`, `writeConfigured: true`
(admin key at `~/.config/yataverse/admin.key`; identity
`did:key:z6Mkj9ZavdNeKgaAmF1YybuPjkoobt6mSzguutc6F7vVohCL` — public
identifier only; the key itself is never copied into this repo).

**Put.** `printf ... | yataverse put <file>` → `verified: true`, 55 B,
CID `bafkreihdqs6os5okbpn3yioraw7hzxfk7dds3y42wpoj5lqkpuolkcmyqm`,
storage receipt (`storeClass: 1`, `acceptedAt`, `keyId`).

**CID derivation matches.** sha256
`e384bce975ca0bdbbc21d105be7cdcaaf8c72de39ab3dc9eae0a7d1cb5099883`
→ `CIDv1 = base32(0x01 0x55 0x12 0x20 || digest)` =
`bafkreihdqs6os5okbpn3yioraw7hzxfk7dds3y42wpoj5lqkpuolkcmyqm` —
the worker's `cidFromSha256` (and `publish-index.py`) produce exactly
this value, confirmed by the CLI output. No map table needed.

**Range on the real CID.**

```sh
$ curl -sS -D- -H "Range: bytes=0-9" https://yataverse.com/ipfs/bafkreihdqs6os5okbpn3yioraw7hzxfk7dds3y42wpoj5lqkpuolkcmyqm
HTTP/2 206
content-type: application/vnd.ipld.raw
content-length: 10
content-range: bytes 0-9/55
accept-ranges: bytes
cache-control: public, max-age=31536000, immutable
x-content-type-options: nosniff
yataverse-read-source: store
server: cloudflare

$ curl -sS -D- https://yataverse.com/ipfs/bafkreihdqs6os5okbpn3yioraw7hzxfk7dds3y42wpoj5lqkpuolkcmyqm
HTTP/2 200 / content-length: 55
```

So the 206 streaming path is **verified on a real CID** (not only against
the local/stub gateway): full GET 200 / 55 B, ranged GET 206 with
`content-range: bytes 0-9/55`, `accept-ranges: bytes`.

Note for the Worker: the gateway's `content-type` is
`application/vnd.ipld.raw`; the worker's `application/zip` default for
payload objects keeps the Updater contract (bytes + Range), since the
gateway type is a transport detail. The worker's `content-type` logic
already substitutes `application/zip` when the upstream is not a ZIP type.

## Publishing (concrete commands)

1. `yataverse cid <zip>` — the CID from the SHA-256; must equal the CID
   printed by `scripts/publish-index.py` step 2.
2. `yataverse put <zip>` — ingests the bytes (`verified: true` + receipt);
   the returned CID is the resolution target of `blobs/<sha256>.zip` in
   the index.

## Status

- ingestion: **done** — `yataverse put <file>` (measured above).
- deploy権限: `wrangler deploy -c deploy/ota-feed/wrangler.jsonc` — not run;
  awaits explicit owner confirmation after PR merge.
- 実 CID の Range: **verified** (`206 / content-range: bytes 0-9/55 /`
  `accept-ranges: bytes / yataverse-read-source: store`, full GET 200/55 B).
