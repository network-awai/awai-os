# OTA feed origin evidence (2026-11-23)

Date of measurement: 2026-11-23 ~23:50 JST. Goal: make
`https://ota.awai.network/v1/pc/pilot/...` a real, publishable OTA feed
origin for the Awai PC pilot, without R2.

## 1. What serves ota.awai.network today

Commands run locally on 2026-11-23 (outputs quoted verbatim):

```sh
$ dig +short ota.awai.network
172.67.190.213
104.21.10.202

$ curl -sS -D- -o /tmp/ota-body.html https://ota.awai.network/v1/pc/pilot/test/builds.json
HTTP/2 404
date: Mon, 23 Nov 2026 14:55:02 GMT
content-type: text/html
server: cloudflare
cf-cache-status: DYNAMIC
cf-ray: a5f10336cc55c8eb-NRT
(27150 bytes, generic Cloudflare "Not Found" page)

$ openssl s_client / x509 (ota.awai.network)
subject= /CN=742a3c71.sni.cloudflaressl.com
issuer= /C=US/O=Google Trust Services/CN=WE1
SAN: DNS:742a3c71.sni.cloudflaressl.com, DNS:ota.awai.network
```

Conclusion: the hostname is Cloudflare-proxied with a wildcard-proxy
certificate, and every probed path answers the same 27150-byte generic
Cloudflare Not Found page. **No OTA endpoint exists; no
`/v1/pc/pilot/` route serves anything.** Whether the record points at a
Pages project or a Worker is not determinable from the outside without
account access.

Unknowns, and what would answer them:

- Pages project vs Worker route for `ota.awai.network`: needs the
  Cloudflare dashboard Pages/Workers list for the account holding the
  `awai.network` zone, or `wrangler pages project list` /
  `wrangler tail`/`wrangler routes list` with owner credentials.
  `wrangler` is not installed in this environment (`command not found`).
- Whether the `awai-os-ota` R2 bucket the old README named ever existed:
  also needs the owner account's R2 list. Irrelevant now — the design
  below does not use it.

## 2. Design chosen (new code in `deploy/ota-feed/`)

- A plain-JS Cloudflare Worker (`src/worker.js`, no build step, no
  dependencies) routed as `custom_domain: ota.awai.network`
  (`wrangler.jsonc`, **no object-store binding of any kind**).
- Index: `GET/HEAD /v1/pc/pilot/{device}/{incr}/builds.json` returns the
  stored offer as `application/json` with `Cache-Control: no-store`;
  unpublished and withdrawn paths answer `[]`. Indexes are generated
  into `src/indexes.js` + audit mirror `indexes/indexes.json` by
  `scripts/publish-index.py`, which reuses `updater-feed.py make-index`
  (verification logic is not forked). Publishing = git-reviewed write +
  `wrangler deploy`.
- Payload: `/v1/pc/pilot/blobs/<sha256>.zip` indexes the OTA bytes by
  SHA-256 and streams them through the yataverse protocol
  (`https://yataverse.com/ipfs/<CIDv1(raw,sha2-256)>`; the CID is derived
  in code, so no map is maintained). Client `Range` is forwarded and
  `206`/`Content-Range` pass through; cache is
  `public, max-age=31536000, immutable` with the SHA-256 as etag.
  Un-ingested bytes answer `404` (`ota-payload-unavailable`), never `500`.
- Everything outside `/v1/pc/pilot/` answers a plain JSON `404`, so no
  SPA fallback HTML can ever be served from this origin.

## 3. Local verification (2026-11-23; Actions disabled, so local totals)

```sh
$ cd deploy/ota-feed && node --test test/*.test.js
tests 14 / pass 14 / fail 0   (206 passthrough, CID golden vectors,
index no-store, [] withdrawal, 404s, no r2_buckets in wrangler.jsonc)

$ node test/local-check.mjs   (real loopback HTTP, fixture gateway)
PASS index application/json / PASS index cache-control no-store
PASS ranged GET answers 206 / PASS Content-Range bytes 4-9/28
PASS withdrawal returns [] / PASS non-/v1/pc/pilot/ refused 404
LOCAL CHECK OK

$ (PORT=8787 node serve.mjs &) ; curl -sS -D- http://127.0.0.1:8787/v1/pc/pilot/virtio_x86_64/123/builds.json
HTTP/1.1 200 OK
cache-control: no-store
content-type: application/json
[]
$ curl -sS http://127.0.0.1:8787/health
{"error":"not-found"}

$ PYTHONDONTWRITEBYTECODE=1 python3.11 -m unittest discover -s android/desktop/pc-ab-device -p 'test_*.py'
OK   (24 baseline, incl. test_updater_feed.py; system python3 is 3.9 and
cannot run these — use python3.11+ per run-python-test.sh)

$ python3.11 scripts/publish-index.py <fixture.zip> --device virtio_x86_64 --incr 200 \
    --release-type DEV --version 24.0 --root <scratch>
wrote indexes/indexes.json + src/indexes.js (offer with digest-qualified
url .../v1/pc/pilot/blobs/09e3b508617e8d7a597d8475d8d23b928a4de82881f851f166f8c65b49a749b6.zip)
yataverse CID: afkreiaj4o2qqyl6rv5fs7meoxmneo4srjg6qkeb7bi7czxyyznutj2jwy
$ publish-index.py --withdraw --device virtio_x86_64 --incr 200
→ "virtio_x86_64/200": []

$ wrangler --version → command not found
```

Not run: `wrangler dev` (wrangler absent), live payload fetch against
yataverse for a real OTA (no OTA bytes exist yet; a probe against an
unknown test CID returned 504 — expected until ingestion), deploy to
production (needs owner confirmation).

## 4. What is blocked on the owner

1. **Payload ingestion.** The Worker serves bytes from
   `https://yataverse.com/ipfs/<CID>`; no ingestion tooling was found in
   this repo and none is invented here. Until the bytes are added to the
   yataverse network, production payload GETs answer 404.
2. **Production deploy.** `wrangler deploy -c deploy/ota-feed/wrangler.jsonc`
   (attaches the Worker to `ota.awai.network`) plus owner confirmation.
   Config is ready in this branch.
3. The README's stale "R2 bucket `awai-os-ota`" text is replaced in this
   branch by a pointer to this Worker. Fleet-wide R2 usage is owned by
   the separate fleet-inventory task (#477 owner policy, see
   `distribution/` which still uses its own object-store binding);
   it is untouched here.
