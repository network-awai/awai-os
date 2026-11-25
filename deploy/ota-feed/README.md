# Awai PC pilot OTA feed

`ota.awai.network/v1/pc/pilot/{device}/{incr}/builds.json` serves the mutable
index as `application/json` with `Cache-Control: no-store`. An unknown device
or installed build receives `[]`, the same response as a withdrawn offer.

GitHub release assets serve the ZIP bytes directly. The index holds the public
download URL, SHA-256, size, and A/B streaming ranges. GitHub redirects that
URL to an HTTPS CDN URL with a short-lived signed query. Keep the stable release
URL in the feed. Release tags and assets can change. Pin the bytes with the
signed manifest's SHA-256 and size. The publisher and Updater's full-download
verification compute SHA-256 from the received bytes. The GitHub ETag differs
from the actual SHA-256. During streaming, UpdateEngine verifies the A/B
payload signature and hashes from the signed payload metadata. It reads the
required ranges of the ZIP, so it cannot verify the hash of the entire ZIP.

Yataverse is suitable for blocks up to 16 MiB, including index snapshots. The
Yataverse OTA payload route is impossible for larger ZIPs. A 32 MiB raw PUT
returned HTTP 413 and a GET for a file path in an imported CAR returned 404.
[Transport measurements](../../docs/evidence/ota-payload-release-assets-20261124.md)

| ZIP size | Transport |
| --- | --- |
| Up to 100 MiB | GitHub release asset, or a commit-pinned raw URL in `network-awai/awai-os` |
| Above 100 MiB and below 2 GiB | GitHub release asset |
| 2 GiB or larger | Split installer archives into release assets under 2 GiB. For A/B OTA, use a qualifying smaller signed package, such as a delta. Updater requires one range-addressable ZIP per offer. |

GitHub warns on regular Git files over 50 MiB and rejects those over 100 MiB.
Release assets must be under 2 GiB.
[Git file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
[Release limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

Itonami Store APK updates use a separate client. Its `AutoUpdater` expects
HTTP 200 and reads the full APK into memory, so keep dapp APKs small. The
system Updater and AOSP UpdateEngine stream A/B OS updates and require HTTP 206
for range requests.

## Publish an offer

1. In the [PC OTA release workflow](../../android/desktop/pc-ab-device/README.md#updater-feed-in-the-release-build-awai-3064),
   verify the signed ZIP and take its SHA-256 from the verification record.
   Stage the exact bytes under the digest-qualified name for the release asset.

   ```sh
   ASSET="$STAGING_DIR/$SIGNED_OTA_SHA256.zip"
   cp "$VERIFIED_OTA_ZIP" "$ASSET"
   node android/release-signing/manifest.mjs make-ota \
     "$ASSET" "$SOURCE_REVISION" "$STAGING_DIR/ota-manifest.json"
   ```

   Have the release operator sign the manifest using the existing Awai Ed25519
   release-signing workflow. Keep the manifest and detached signature with the
   release record.

2. Attach the staged ZIP to a public Awai OS release. For a new release, upload
   to a draft before it is published. Keep published payload names and bytes
   stable and publish a new asset for any new digest.

   ```sh
   gh release upload "$RELEASE_TAG" "$ASSET" --repo network-awai/awai-os
   OTA_URL="https://github.com/network-awai/awai-os/releases/download/$RELEASE_TAG/$(basename "$ASSET")"
   ```

   For the optional raw route, commit the verified ZIP with a normal Git blob
   on a branch, land the artifact PR, and retrieve the **landed** commit SHA.
   Use `https://raw.githubusercontent.com/network-awai/awai-os/<40-hex>/<path-to-zip>`
   as `OTA_URL`. The local filename must match the URL.

3. Generate the index with Python 3.11+ and Node.js. The command uses the Awai
   release public key to verify the manifest, invokes `updater-feed.py make-index`
   logic for ZIP integrity and metadata, then verifies public Range, length and
   the SHA-256 of the full public response before writing the index.

   ```sh
   python3.11 deploy/ota-feed/scripts/publish-index.py "$ASSET" \
     --artifact-url "$OTA_URL" --sha256 "$SIGNED_OTA_SHA256" \
     --manifest "$STAGING_DIR/ota-manifest.json" --manifest-signature "$OTA_MANIFEST_SIGNATURE" \
     --device virtio_x86_64 --incr "$INSTALLED_BUILD" \
     --release-type "$RELEASE_TYPE" --version "$RELEASE_VERSION"
   ```

   For a delta, add `--source-build "$INSTALLED_BUILD"`. Review and commit the
   generated JSON audit and Worker index together. To withdraw the offer,
   rerun with `--withdraw --device virtio_x86_64 --incr "$INSTALLED_BUILD"` in
   place of the publication arguments.

4. Deploy the index Worker and verify the exact device/build path.

   ```sh
   wrangler deploy -c deploy/ota-feed/wrangler.jsonc
   curl -fsS -D- "https://ota.awai.network/v1/pc/pilot/virtio_x86_64/$INSTALLED_BUILD/builds.json"
   ```

## Deploy record and rollback

Production deploy of 2026-11-24 (measured). Worker `awai-ota-feed` in
account `cloud-kotoba` (`4da88288dc30d9ee257f319d3c33ecf0`), zone
`awai.network` (`2a66cffc76aec17a25057816481c8ee2`). Worker Version ID
`263618ff-32a3-4e1d-9f4e-c1cfc587b9b2`, deployed 2026-11-24T00:05:24Z
from merge commit `f5b363beab1365ba94f531bc4116ae25e9a74113` (pull
request #484, head `1b5287cf`), wrangler 4.167.0. This was the first
deploy: the Worker did not exist before it, so there is no previous
version. The config has no `account_id`, so `CLOUDFLARE_ACCOUNT_ID`
must be set when more than one account is available.

Before the deploy, `ota.awai.network` was an R2 custom domain on bucket
`awai-os-ota` (SSL active). A custom domain cannot be attached while
the hostname already has records, so that R2 custom domain was detached
only; the R2 objects were not deleted (7 objects, 961,584,407 bytes).

Verification after the deploy:

```sh
curl -sS -D- https://ota.awai.network/v1/pc/pilot/virtio_x86_64/awai-pilot-ota-target-202611210724/builds.json
```

gave HTTP 200, `content-type: application/json`, `content-length: 2`,
`cache-control: no-store`, `x-content-type-options: nosniff`, body
`[]`. An unknown device/build path answered 200 with `[]`; `/` gave 404
`{"error":"not-found"}`; POST gave 405. The former R2 payload path
`.../v1/pc/pilot/packages/.../full.zip` gave 404 (closed). TLS from
`openssl s_client -connect ota.awai.network:443` showed `CN=awai.network`
issued by Google Trust Services WE1. `INDEXES = {}` at this revision, so
every index answers `[]`; payload bytes come from GitHub release
assets.

Rollback. For any later deploy (a previous version exists):

```sh
wrangler rollback --name awai-ota-feed
```

or `wrangler versions list --name awai-ota-feed` then
`wrangler rollback --name awai-ota-feed <VERSION_ID>`. Re-run the
verification commands above afterwards.

For this first deploy (no previous version), delete the Worker to free
the hostname and re-attach the R2 custom domain:

```sh
wrangler delete --name awai-ota-feed
```

```
POST /accounts/<account>/r2/buckets/awai-os-ota/domains/custom
{"domain":"ota.awai.network","zoneId":"2a66cffc76aec17a25057816481c8ee2","enabled":true,"minTLS":"1.2"}
```

Confirm the restore: the former payload path answers 200 with
961,474,941 bytes and the index path answers `[]` from R2. A hostname
belongs to either R2 or the Worker, never both; always detach before
attaching, and never delete R2 objects while switching.

## Local tests

```sh
node --test deploy/ota-feed/test/worker.test.js android/release-signing/manifest.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3.11 -m unittest discover -s deploy/ota-feed/test
sh deploy/ota-feed/test/test-updater-policy.sh
node deploy/ota-feed/serve.mjs
```
