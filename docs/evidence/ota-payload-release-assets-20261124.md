# Awai PC OTA payload transport measurements, 2026-11-24

## GitHub release assets

The coordinator measured Range on this Mac at 00:11 UTC. The commands below
repeated the public reads. The temporary query is redacted from the Location
header because it contains signed download parameters. The coordinator observed
an expiry about one hour after issuance.

```console
$ gh release view awai-os-0.6.0-preview.1 --json assets --jq '.assets[] | [.name,.size] | @tsv'
awai-os-0.6.0-x86_64-preview.img.zst.part-aa   1800000000
awai-os-0.6.0-x86_64-preview.img.zst.part-ab   1800000000
awai-os-0.6.0-x86_64-preview.img.zst.part-ac   721015896
RAW-SHA256.txt   86
README.txt   1365
SHA256SUMS   339

$ gh release view itonami-store-dev-r109 --json assets --jq '.assets[] | [.name,.size] | @tsv'
Itonami-Store-v14-r109.apk   81082385
SHA256SUMS.txt   93

$ ASSET=https://github.com/network-awai/awai-os/releases/download/awai-os-0.6.0-preview.1/awai-os-0.6.0-x86_64-preview.img.zst.part-aa
$ curl -fsSL --range 0-99 --dump-header - --output /dev/null "$ASSET" |
> awk 'tolower($0) ~ /^location:/ {sub(/\?.*/, "?[redacted]"); print; next} tolower($0) ~ /^(http\/|content-range:|accept-ranges:|content-length:|etag:)/'
HTTP/2 302
location: https://release-assets.githubusercontent.com/github-production-release-asset/1388742653/777f3447-d43e-4552-a349-f3efba6a764b?[redacted]
content-length: 0
HTTP/2 206
etag: "0x8DF3CC0B6DB4A22"
accept-ranges: bytes
content-range: bytes 0-99/1800000000
content-length: 100
```

The 4,321,015,896 bytes across the three parts are about 4.02 GiB. This
measurement establishes range delivery of a 1.8 GB object. The object was
an installer image part. A/B UpdateEngine requires a single ZIP per offer.

## GitHub raw

Selected response headers from the commit-pinned APK. The full GET was hashed
independently.

```console
$ RAW=https://raw.githubusercontent.com/network-awai/awai-os/0dc2ae2f034be9853f01ff5de2f7e2543e805d98/store/distribution/dev-20261120-r106/itonami.apk
$ curl -fsSI "$RAW"
HTTP/2 200
cache-control: max-age=300
content-type: application/octet-stream
etag: "6b2acabfefe2699ec13f340ee541875b2a9992e0a301b9bee47c750e088d28cb"
content-length: 55456456

$ curl -fsS --range 0-99 --dump-header - --output /dev/null "$RAW"
HTTP/2 206
content-range: bytes 0-99/55456456
content-length: 100

$ curl -fsS "$RAW" | shasum -a 256
b1a5f7f73a0bc37dfdf924e92889136670feac1772ce02e8ddc4b76e87771dab  -
```

The ETag and body SHA-256 differ. GitHub warns above 50 MiB and blocks regular
Git blobs above 100 MiB. The publisher uses received bytes to verify the hash
from the signed manifest. [GitHub file size limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

## Yataverse

The coordinator supplied selected results from the Mac. Commands use
placeholders for the original test filenames and CAR CID. No writes were
repeated in this worktree.

```console
$ yataverse put <16-MiB-single-raw-block>
HTTP 200, verified: true, storage receipt returned

$ yataverse put <32-MiB-single-raw-block>
yataverse: put-too-large: HTTP 413

$ yataverse car-put <CAR-containing-2-MiB-small2m.bin>
verified: true, blocks: 10

$ curl -sS --dump-header - --output /dev/null https://yataverse.com/ipfs/<dir-root>
HTTP 200
content-type: application/vnd.ipld.raw
62 bytes

$ curl -sS --dump-header - --output /dev/null https://yataverse.com/ipfs/<dir-root>/small2m.bin
HTTP 404
```

Rechecked small-block Range with a public CID.

```console
$ curl -fsS --range 0-9 --dump-header - --output /dev/null https://yataverse.com/ipfs/bafkreihdqs6os5okbpn3yioraw7hzxfk7dds3y42wpoj5lqkpuolkcmyqm
HTTP/2 206
content-length: 10
content-range: bytes 0-9/55
accept-ranges: bytes
cache-control: public, max-age=31536000, immutable
```

The directory-root response contained the DAG block. The gateway file-path
request could not recover the UnixFS file. Combined with the 32 MiB PUT's
HTTP 413, this rules out serving larger OTA ZIPs via the measured gateway.

## Local verification

- Worker contract and manifest tests passed 10 of 10 on Node.js.
- Publisher tests passed 7 of 7 on Python 3.11. The redirect fixture preserves
  Range across the host change. The hash-mismatch fixture supplies an ETag
  equal to the expected hash and still rejects the differing bytes.
- PC A/B device Python tests passed 24 of 24. The JVM policy fixture passed
  23 URL and digest assertions. The pinned Updater source accepted
  `configure-release` twice and passed `git diff --check`.
- A JVM loopback smoke test of the patched Updater range fetcher with
  OkHttp 4.12.0 followed a stub 302 from `localhost` to `127.0.0.1`.
  The second request kept the Range header and used a stub signed query.
  The fetcher returned the three bytes from the stub 206.
- The publisher's range and full-body hash readback also passed against the
  public 81,082,385-byte release APK. The local index origin returned HTTP 200
  with `application/json`, `no-store`, and `[]`. The former blob route returned
  HTTP 404.

The Worker was not deployed. Qualification of a signed A/B OTA from the
deployed feed through apply and reboot on a PC remains open.
