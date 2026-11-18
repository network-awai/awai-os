# Kumade in the bundled Store (AWAI-3167, 2026-11-18) — VM part

Source, build and disposable-emulator evidence. The device part (moto g05) is
[AWAI-3453](https://linear.app/kotobalabs/issue/AWAI-3453), Jun's work. Nothing here proves
production signing, online catalog publication, a custom ROM, a signed OTA, encrypted
recovery or Native selfhost. An APK that installs and launches is not any of those.

## Input

- App: network-awai/app-itonami-kumade `c3fbb2f` (PR #26: debug APK without native debug
  symbols, `ndkVersion` pinned; on top of AWAI-3427 16 KB alignment/insets and AWAI-3166
  on-device search). Tauri v3 arm64 debug build.
- `network.itonami.kumade`, versionCode 1000, versionName 0.1.0, targetSdk 37,
  `application-debuggable`.
- 21,645,498 bytes, sha256 `14edbef1683dbf65d311fd3cabe61ebff79b019d55db696f1f89ff33073a66ef`.
- One signer, the development identity (SHA-256 `2507930b…9b29`), as the other Store apps.
- Permissions: `android.permission.INTERNET` and AndroidX's own
  `network.itonami.kumade.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, nothing else.
  INTERNET serves the app's two declared Common Crawl reads, each with each-operation consent.
- `libkumade_lib.so`: 4 LOAD segments, all `Align 0x4000`; `zipalign -c -P 16 -v 4` OK.

## Source and build

- `node --test android/tests/*.test.mjs`: 30 pass (the new domain test admits a 21 MB
  `packages/kumade.apk` and refuses three other asset names).
- `bb -cp android/contracts/src:android/contracts/test -m itonami.store.domain-test`:
  4 tests, 20 assertions, 0 failures.
- `python3 android/build.py --version 1 --itonami-apk store/distribution/dev-20261116/itonami.apk --kumade-apk <apk>`:
  passed. The signed bundled catalog (revision 1) lists `network.itonami.kumade`
  1000 / 0.1.0, `packages/kumade.apk`, 21,645,498 bytes, sha256 `14edbef1…`.
  Store APK sha256 `6848275ce22ffbdf6cbe5e8ba756b0bf29d561975c3d1c07cba7e6990abdb812`;
  tests APK sha256 `a21d5ab426bcb74a8da8c64fdb763b73d343043bc60763ce2c2c2156b440ddd7`.
- Negative control: `--kumade-apk store/distribution/dev-20261118-r104/deai.apk` stops with
  `kumade APK package is not network.itonami.kumade`. The build also stops when the signer
  is not exactly the development identity or the permissions are not exactly the two
  above (not exercised with a real APK).
- `python3 android/build-tests.py --version 1`: passed.
- Builds and the VM ran under the shared AWAI-3393 build lock (07:32–07:45 UTC).

## Disposable emulator

`sdk_phone64_arm64` Android 15 (`AE3A.240806.019`, userdebug, test-keys), AVD
`Awai_Kumade_AWAI3165` started with `-wipe-data` at 2026-11-18T07:39Z and stopped at
07:45:14Z. Taps were real `adb shell input tap` touches unless noted.

| Step | Result | Evidence |
| -- | -- | -- |
| `StoreInstrumentation` | 14 assertions passed, including `verifiedApk("network.itonami.kumade")`: bytes, sha256, package, versionCode and signer. | — |
| Store list | Kumade listed as v0.1.0 · 同梱アプリ. | `store-02-list.jpg` |
| Detail | 「公開 Web を、手元で読み解く。」, 通信は毎回確認, and the catalog description including that URL fetch and crawl are unavailable. | `store-03-detail.jpg` |
| Pre-add disclosure | 送る情報: 追加時の送信なし。使用時は Common Crawl の索引と記録への読み取り要求のみ（毎回確認）. | `store-05-disclosure.jpg` |
| Integrity dialog | sha256 `14edbef1…66ef` before Android's installer. | `store-06-integrity.jpg` |
| Android install | INSTALL at 07:42:40Z. `installerPackageName=network.awai.store`, versionCode 1000, INTERNET granted. | `store-07-installer.jpg` |
| Launch | Origin `http://tauri.localhost`. Common Crawl lookup enabled; URL fetch and Crawl disabled (capture service stopped, AWAI-367/430); index empty. | `kumade-01-launched.jpg` |
| Consent shown | Tapping "Look up captures" opened the canonical dialog: service `commoncrawl-index`, endpoint, exact `GET` path, data category `target-url`. | `kumade-02-consent-lookup.jpg` |
| Deny | Deny tapped at 07:43:27Z: the app showed `client operation was not approved`; no resource request in the following 20 s. | `kumade-03-denied.jpg` |
| Allow (search) | Allow once at 07:43:58Z: one `GET` to `index.commoncrawl.org` → 200, 10 captures of `example.com` (CC-MAIN-2026-43). | `kumade-04-captures.jpg` |
| Allow (record) | A second, separate dialog for `commoncrawl-data/fetch-record`; Allow once at 07:44:18Z: one ranged `GET` to `data.commoncrawl.org` → 206. Snapshot `sha256:25ddf2c8…` stored with `blockDigestVerified: true`, `capturedAt` 2026-10-05T11:28:41Z. | `kumade-05-consent-record.jpg` |
| Search | `documentation` typed with `adb shell input text`, Search tapped: Example Domain, from the app's own snapshot. No resource request. | `kumade-06-search.jpg` |
| Index view and bot rows | The awai-web-research bot's index persisted in AWAI-3164 (Awai file root `bafyreiheeuujthef7vidcdssi4iej7efl2fiqyiqlljntolligygs3ydl4`, read as JSON rows with network-awai/awai-format `awai-file read`) given to the import input as a `File` over DevTools: 索引 3 件（bot の行 2 件）, because the example.com row was replaced by the app's own snapshot of the same page. `web` typed and searched: the two info.cern.ch rows marked bot の索引. | `kumade-07-index-and-bot.jpg` |
| Crawl | "Crawl with consent" stays disabled; tapping it opened no dialog and sent no request. | `kumade-08-crawl-disabled.jpg` |

On this test emulator, the Store's "install unknown apps" permission was granted with
`appops`, not through the Settings screen.

## Not done or not shown

- **Bounded crawl in the app**: not possible while the capture service is stopped (owner
  decision 2026-10-28; AWAI-367 / AWAI-430). The bounded crawl was shown for the bot side in
  AWAI-3164 (Kumade's own crawl code over Common Crawl records, not the app UI).
- The bot rows were given over DevTools; Android's document picker was not used.
- **Device** (moto g05): AWAI-3453.
- Online catalog, release signing and the 16 KB-page warning on a real 16 KB system.
