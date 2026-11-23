# aiueos-updates (`distribution/`)

Read-only update transport for `aiueos-updates`. No R2: artifacts and
manifests resolve through the yataverse.com protocol only
(ADR `docs/adr/20261123-no-r2-yataverse-only.md`).

- Artifact `/{stable|canary}/<64hex>.(nar-export|iso)` (channel prefix
  optional): the hex is the SHA-256 of the content, converted to a raw CIDv1
  (`CIDv1 = base32(0x01 0x55 0x12 0x20 || sha256_digest)`) and fetched as
  `https://yataverse.com/ipfs/<cid>`, forwarding `Range` / `If-Range`.
  Upstream `206` stays `206` with its `Content-Range`; upstream `200` stays
  `200`.
- Manifest `/{stable|canary}/manifest.json`: fetched from the yataverse
  block named by `MANIFEST_CID` (`MANIFEST_CID_STABLE` /
  `MANIFEST_CID_CANARY` override the shared `MANIFEST_CID` per channel).
  Without a configured CID the route is `404`.

Methods remain `GET`/`HEAD` only (`405` otherwise), and success responses
keep `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` for
manifests and `public, max-age=31536000, immutable` for artifacts, plus
`Accept-Ranges: bytes`. Any upstream non-`200`/`206` or fetch error answers
`404`, never `500`.

## Data not migrated

No data was moved in this change: bucket creation, deletion, reads and
bulk transfer are separate tasks. An artifact or manifest that exists
only in the old R2 bucket and has not been ingested as a yataverse block
will answer `404` after this cutover. Example that will be `404` until
ingested:

- `GET https://aiueos-updates.04-feasts-minded.workers.dev/stable/8f671359a2fec6dcd88b5e5242531adaaabd1cf231d2ceea66e6fbe19449aed3.iso`
  (`<64hex>` -> `bafkreiepm4jvtix6y3onrc26kjbfggw2vk6rz4rr2lhouzxg7pqzisno2m`
  on yataverse; absent there means `404`)
- `GET https://aiueos-updates.04-feasts-minded.workers.dev/stable/manifest.json`
  (`404` until `MANIFEST_CID` points at an ingested manifest block)

Deploy itself (including setting `MANIFEST_CID`) stays with the operator;
this directory change only removes the `r2_buckets` binding and the
yataverse-direct read path. `upload-worker.mjs` (the temporary
signature-authorized publisher, already removed in production) still
references the old multipart binding and is outside this read-path change;
retiring it is a separate task.

## Tests

`node --test distribution/test/worker.test.mjs` (fetch stubbed, no network).
