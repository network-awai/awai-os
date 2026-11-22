# Securities Drafts — debug APK, generation 20261123-9ab74d7e (AWAI-3159 c)

Record only; do not rewrite.

**Build.** The debug APK was built from awai-os main `9ab74d7e` on jacob with
`CARGO_BUILD_JOBS=4 nice -n 10 npx tauri android build --debug --apk --target aarch64`
(JDK 21, NDK 27.0.12077973, aarch64), one at a time after Payment Drafts. Before the
build: `npm test` 14/14 and the static build (20 pinned files). APK sha256
`b246bf08434302c8f8a6f793d8bb97f63cea35dbd19a1fd46f829e4929446062`, 21,798,452
bytes (`apk-sha256.txt`), versionCode `1000` (`0.1.0`), signer
`1c73b625bebc3e897b27d74e32813c12c34628288f037eed59ec6120d6f65061`
(Android Debug, development only — **no release signing**).

**Permissions.** `aapt2 dump permissions` (`permissions.txt`): the only permission is
`network.itonami.securitiesdrafts.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (AndroidX).
There is no `INTERNET`. No permission was added in this generation; the app declares
no external operation.

**Pinned as.** `network.itonami.securitiesdrafts`, asset `packages/securitiesdrafts.apk`,
40 MiB budget (`store/distribution/dev-20261123-r111/securitiesdrafts.apk`).

## Not covered this generation

- No Android VM launch, network-traffic or screen evidence was captured in this
  generation; those belong to the 20261118 `apk-vm/` run. This generation pins the
  rebuild digest so the Store entry can be published without re-measuring the app.
- Release signing, the signed catalog envelope (needs the development catalog key on
  the development Mac) and publishing `store/latest` remain follow-up.
