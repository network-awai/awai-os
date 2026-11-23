# OTA feed origin — CAR + chunk-map path for >16 MiB (2026-11-24)

Date: 2026-11-24. This file adds new dated evidence; it does not rewrite
earlier dated files. Supersedes the size assumptions in
`ota-feed-origin-20261124.md` (which covers the ≤ 16 MiB raw-block path).

## Operating constraints (from the Organizer-published measurements)

- Single raw block: **16 MiB max**. Above that, the CAR route applies:
  256 blocks / 32 MiB per POST; the dag-pb root CID cannot be reversed
  from the sha256 — the dependency was **valid across platforms** for the
  ≤ 16 MiB raw case only (`base32(0x01 0x55 0x12 0x20 ‖ sha256)` matches,
  measured 55 B artifact `bafkreihdqs6os5okbpn3yioraw7hzxfk7dds3y42wpoj5lqkpuolkcmyqm`).
- Site-pack packer per-file-node bound: 43.5 MiB.
- Contract: `504` (un-ingested) → worker `404`; upstream Range passes
  through verbatim (206 + Content-Range + Accept-Ranges + ETag); a 200
  stays a whole-body 200 — **no synthesized 206** anywhere.
- Receipts: `state:1 local-durable-readback / storeClass:1 edge-gateway /
  retentionUntil:0` — **no retention promise, no replication proof**
  (single B2 copy, GC-able). The original ZIP stays on the OTA side; yataverse
  is a distribution cache; long retention needs a separate lease
  (R1 operator-archive).
- Write throttles: 60 req / 60s, 64 MiB / 60s, WAF 10 req / 10s per IP
  (40-way burst → 16 through). Writes are serial, 1–2 puts per build,
  retries reuse the same request-id.
- Cost: yataverse plane itself uncharged (B2/Cloudflare = operator);
  USD unit prices, free-tier absolute overage, GC presence are **unknown**
  — **no cost commitment** is recorded as a fact anywhere.

## What changed in code (`deploy/ota-feed/`, PR #480)

- `src/worker.js`: resolution is manifest-driven.
  - `MANIFEST_CID` env (JSON, pinned per channel, never synthesized from a
    name) maps `sha256 -> {rootCid, chunkMap}`; a pinned entry wins.
  - Unpinned blobs use the ≤ 16 MiB raw CID derivation.
  - Upstream 504 (and any other non-200/206) → `404 ota-payload-unavailable`
    (the upstream 5xx is never passed through); a 200 upstream stays 200
    even when Range was sent (resume-safe); multi-range is forwarded verbatim.
  - Upstream IPLD content-type (`vnd.ipld.*`) is answered as `application/zip`.
  - `src/manifest-cids.js` is the generated pre-deploy mirror of the pin.
- `scripts/publish-index.py`: `--root-cid` + `--chunk-map` flags; files
  **over 16 MiB are refused without both**; chunk maps are structurally
  validated (base32 CIDs, unique, strictly increasing offsets);
  the pin JSON (`MANIFEST_CID=...`) is printed and mirrored into
  `src/manifest-cids.js`. Ingestion itself is NOT done by the script.
- `wrangler.jsonc`: `vars.MANIFEST_CID` added (empty default), still no
  `r2_buckets`.
- `README.md`: size table (≤16 MiB raw vs >16 MiB CAR + chunk map),
  cache-not-a-copy paragraph, serial-write limits, and the cost section.

## Local verification (2026-11-24; Actions disabled — local totals only)

```sh
cd deploy/ota-feed && node --check src/worker.js   # ok
node --test test/*.test.js
tests 20 / pass 20 / fail 0
  (504->404, upstream-200-as-200, manifest-pinned root fetch,
   invalid-pin fallback, IPLD type substitution, CID vectors, index, guard)

node test/local-check.mjs → LOCAL CHECK OK (8/8, unchanged)

PYTHONDONTWRITEBYTECODE=1 python3.11 -m unittest discover \
    -s android/desktop/pc-ab-device -p 'test_*.py'
Ran 24 tests — OK

publish-index.py dry-runs (fixture OTAs, scratch root — not committed):
  496 B ZIP → "route: single raw block (derived CID …)"
  17.8 MB ZIP without --root-cid/--chunk-map → rc=2
    "files over 16 MiB need --root-cid and --chunk-map (CAR route)"
  same ZIP with both → pins written, manifest-cids.js imports cleanly (1 entry)
```

Not run: `wrangler dev` (wrangler absent), live fetch through the real
gateway from this worker for a CAR root (the answer — whether a CAR route
file is readable with Range via the gateway — is being measured by the
coordinator), real OTA ingestion (no real OTA zip yet).

## Status

- ingest: **done for the small raw block** (`yataverse put`, measured
  2026-11-24; serial 1–2 puts per build from here on).
- deploy権限: `wrangler deploy -c deploy/ota-feed/wrangler.jsonc` —
  not run; awaits explicit owner confirmation after PR merge.
- 実 CID の Range: **verified for the raw route** (`206 / bytes 0-9/55`);
  CAR-route ranged read is pending the coordinator's measurement.
