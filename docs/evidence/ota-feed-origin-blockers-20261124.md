# OTA feed origin — final blocker list (2026-11-24)

Final evidence for the OTA feed worker (`deploy/ota-feed/`, PR #480 open,
head `d2352b97`). Measured locally 2026-11-24; Actions is disabled — local
totals only, never "checks green".

## Local totals re-run 2026-11-24

```sh
$ cd deploy/ota-feed && node --test test/*.test.js
tests 14 / pass 14 / fail 0
(206 + Content-Range passthrough, CID golden vectors for sha256("abc")/
sha256(""), index application/json + no-store, [] withdrawal, path guard,
wrangler.jsonc contains no r2_buckets — asserted by substring test)

$ node test/local-check.mjs   (real loopback HTTP)
PASS index application/json / PASS index cache-control no-store
PASS ranged GET answers 206 (Content-Range bytes 4-9/28, byte span exact)
PASS withdrawal returns [] / PASS non-/v1/pc/pilot/ path refused 404
LOCAL CHECK OK

$ PYTHONDONTWRITEBYTECODE=1 python3.11 -m unittest discover \
    -s android/desktop/pc-ab-device -p 'test_*.py'
Ran 24 tests — OK
```

CID formula implemented exactly as directed:
`CIDv1 = base32(0x01 0x55 0x12 0x20 || sha256-digest)` (raw codec, sha2-256,
32-byte digest), computed from the `blobs/<sha256>` key and fetched at
`https://yataverse.com/ipfs/<cid>`; no map table.

## Remaining external blockers (one line each)

- ingestion: OTA bytes must be added to the yataverse network by the operator (coordinator is consulting bot:Yataverse) — Worker 404s payloads (`ota-payload-unavailable`) until then; no tooling invented here.
- deploy権限: production publish is `wrangler deploy -c deploy/ota-feed/wrangler.jsonc` and awaits explicit owner confirmation after PR merge; it is not executed in this session.
- 実 CID の Range 未検証: the gateway has never been probed with a real OTA CID (probe against an unknown test CID returned 504); streamed 206 is proven only against the local/stub gateway and must be re-verified with a real CID post-ingestion.
