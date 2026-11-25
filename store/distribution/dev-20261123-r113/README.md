# Itonami Store development catalog r113 (AWAI-3115, item 134 follow-up)

r113 carries forward the seventeen entries of r112 unchanged (same ids, versions, operations and exact APK
digests) with revision 113, except for one superseded APK:

- `network.itonami.dougaka` (dougaka Studio — Itonami メディア制作) — `dougaka.apk` (new build, see below)

The superseded value in r112 (`store/distribution/dev-20261123-r112/`, immutable) was sha256
`88c1673360208bec2ce9295ebc641af8c0b8eb19c24338829c7df05b06827479`, 12,802,310 bytes. The new value in
r113 is sha256 `0d5a08ac015140085b88e7e76145a08d5e0fc94cc42c16fd2c0ae22006379f73`, 12,802,310 bytes
(re-measured after copying into this directory). The byte count is unchanged; only the digest changed.

Why: the dougaka consent fix was merged in `cloud-itonami/app-itonami-dougaka` as squash `ca99706cc2`
and the app was rebuilt and re-signed with the same shared release key. The consent dialog no longer
shows the inert endpoint; the modal open is deferred so the save tap no longer ANRs.

| app | package id | versionCode | bytes | sha256 |
|---|---|---|---|---|
| dougaka | network.itonami.dougaka | 1000 (0.1.0) | 12,802,310 | `0d5a08ac015140085b88e7e76145a08d5e0fc94cc42c16fd2c0ae22006379f73` |

Signing: **release-signed** (single signer, `CN=AWAI Release, O=AWAI, C=JP`, certificate SHA-256
`a90ff0c5b71570eb239356bc8bf2d97005f63c6b92924e001e065b5063a2f049`, verified with `apksigner
verify --print-certs`; arm64-v8a only, not debuggable). The catalog raw (`catalog-rev113-raw.json`) is
identical to r112's except revision 113 and dougaka's android artifact sha256 above; it is **not yet
signed** (dev catalog key absent on this host; sign on the dev Mac as in r112's README). `expiresAt` is
carried over from r112 unchanged. Nothing here is published or installed by this change.
