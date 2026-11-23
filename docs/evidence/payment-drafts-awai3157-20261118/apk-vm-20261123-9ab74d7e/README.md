# Payment Drafts — debug APK, generation 20261123-9ab74d7e (AWAI-3159 c)

Record only; do not rewrite.

**Build.** The debug APK was built from awai-os main `9ab74d7e` on jacob with
`CARGO_BUILD_JOBS=4 nice -n 10 npx tauri android build --debug --apk --target aarch64`
(JDK 21, NDK 27.0.12077973, aarch64). Before the build: `npm test` 12/12 and the static
build (20 pinned files). APK sha256
`2637069876b59e9ac8e6cfc7138e3a6a7885d3b26e3727e007e697bf9acaaa28`, 21,801,241
bytes (`apk-sha256.txt`), versionCode `1000` (`0.1.0`), signer
`1c73b625bebc3e897b27d74e32813c12c34628288f037eed59ec6120d6f65061`
(Android Debug, development only — **no release signing**).

**Permissions.** `aapt2 dump permissions` (`permissions.txt`): the only permission is
`network.itonami.paymentdrafts.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (AndroidX).
There is no `INTERNET`. No permission was added in this generation; the app declares
no external operation.

**Pinned as.** `network.itonami.paymentdrafts`, asset `packages/paymentdrafts.apk`,
40 MiB budget (`store/distribution/dev-20261123-r111/paymentdrafts.apk`).

## Not covered this generation

- No Android VM launch, network-traffic or screen evidence was captured in this
  generation; those belong to the 20261118 `apk-vm/` run. This generation pins the
  rebuild digest so the Store entry can be published without re-measuring the app.
- Release signing, the signed catalog envelope (needs the development catalog key on
  the development Mac) and publishing `store/latest` remain follow-up.
