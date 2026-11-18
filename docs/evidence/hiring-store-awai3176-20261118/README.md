# Hiring in the bundled Store (AWAI-3176, 2026-11-18)

Source, build, disposable-emulator and device evidence. Nothing here proves
production signing, online catalog publication, a custom ROM, a signed OTA,
encrypted recovery or Native selfhost. An APK that installs and launches is
not any of those.

## Input

- App: network-awai/app-itonami-hiring (AWAI-3175 PR #1, and PR #2 which
  drops debug symbols from the debug APK), Tauri v3 arm64 debug build of
  `632a87b`.
- `network.itonami.hiring`, versionCode 1000, versionName 0.1.0, minSdk 24,
  targetSdk 37, `application-debuggable`.
- 20,583,441 bytes, sha256
  `f8e508a05c9281b8604886cfa28c555d1955965048c07907c3bb15b3faa82444`.
- One signer, the local Android debug key (SHA-256 `2507930b…9b29`): the
  same development identity as the other Store apps.
- `aapt2 dump badging` lists no `android.permission.INTERNET`.
- Bot outputs used for the operation: the files `itonami-agent-kbb cron run`
  wrote on 2026-11-18 into the workspaces of the itonami agents
  `awai-job-seeker-ops` (AWAI-3172, cloud-itonami/itonami-agent PR #13) and
  `awai-hiring-ops` (AWAI-3173, PR #14). All fictional.

  | File | sha256 |
  | -- | -- |
  | `apply-backend-engineer.draft.edn` | `9384b6ae…5bfb9` |
  | `apply-backend-engineer.letter.txt` | `784218ab…c3a8` |
  | `blocked-auto-apply.blocked.edn` | `972b1b46…5a0b` |
  | `publish-backend-engineer.plan.edn` | `edff5d9e…469e` |
  | `publish-backend-engineer.announcement.txt` | `8b502f57…5e81` |

## Source and build

- `node --test` on each `android/tests/*.test.mjs`: 25 pass (26 after merging main with the Deai listing, AWAI-3374; `build.py` re-run on the merged tree also passed). The new domain
  test admits a 20.6 MB `packages/hiring.apk` and refuses three other asset
  names.
- `bb -cp android/contracts/src:android/contracts/test -m itonami.store.domain-test`:
  4 tests, 20 assertions, 0 failures.
- `python3 android/build.py --version 1 --itonami-apk store/distribution/dev-20261116/itonami.apk --hiring-apk <apk>`:
  passed (needs `npm ci` in `otehon/shell` for esbuild). The signed bundled
  catalog (revision 1) lists `network.itonami.hiring` 1000 / 0.1.0,
  `packages/hiring.apk`, 20,583,441 bytes, sha256 `f8e508a0…`. Store APK
  sha256 `3667f7fd…7862`.
- Negative control: the same build with
  `--hiring-apk store/distribution/dev-20261116/itonami.apk` stops with
  `hiring APK package is not network.itonami.hiring`. The build also stops if
  the APK requests INTERNET or its signer is not exactly the development
  identity (not exercised with a real APK).
- `python3 android/build-tests.py --version 1`: passed.

## Disposable emulator

`sdk_phone64_arm64` Android 15 (`AE3A.240806.019`, userdebug, test-keys), on
a new AVD `Awai_Hiring_AWAI3176` started with `-wipe-data` on port 5896.

| Step | Result | Evidence |
| -- | -- | -- |
| `StoreInstrumentation` | 14 assertions passed. These include `verifiedApk("network.itonami.hiring")`: bytes, sha256, package, versionCode and signer. | — |
| Store list | Hiring is listed as v0.1.0 · 同梱アプリ. | `store-02-list.jpg` |
| Detail | 「求職・求人の下書きを、手元で確かめる。」, 端末内で使える・送信なし, and the catalog description. | `store-04-detail.jpg` |
| Pre-add disclosure | 送る情報: 外部への送信なし. 「応募・投稿・メッセージの送信はしません。外部への送信はなく、ネットワークの権限もありません。」 | `store-05-disclosure.jpg` |
| Store integrity dialog | Shows sha256 `f8e508a0…2444` before Android's installer opens. | `store-07-integrity.jpg` |
| Android install | "Do you want to install this app?" → INSTALL. `installerPackageName=network.awai.store`, versionCode 1000, no INTERNET permission. | `store-08-installer.jpg` |
| Launch | `network.itonami.hiring/.MainActivity` resumed; the page is `http://tauri.localhost/`. | `app-01-launched.jpg` |

On this test emulator, the Store's "install unknown apps" permission was
granted with `appops` instead of through the Settings screen.

### Operation with the bot outputs (WebView DevTools on the debug build)

The five bot output files were given to the app's own file input
(`#files`, the same `change` handler a user's file choice reaches) as
`File` objects over DevTools; Android's document picker itself was not
exercised. The driver script is not part of the product.

| Step | Result | Evidence |
| -- | -- | -- |
| Load | 3 items: the job-seeker draft and the hiring plan with every check passing, and the bot's blocked record. Both bodies verified by SHA-256 against the bundles. | `app-02-loaded.jpg` |
| Approve | `apply-backend-engineer` approved; application step moved to `applied` (自分で応募した). | `app-05-approved.jpg` |
| Refuse (send back) | `publish-backend-engineer` sent back with the reason 「掲載前に給与の表記を見直す」. | `app-06-sent-back.jpg` |
| Blocked record | `blocked-auto-apply` (the bot's `status/draft-only` gate stopped an `:action :submit` request) is shown with its failed gate and has no approve control. | `app-06-sent-back.jpg` |
| Network during load, approve and refusal | DevTools `Network.requestWillBeSent`: **0 requests**. | — |
| Network probe | `fetch("https://example.com/collect", {method:"POST"})` from the page: `TypeError: この接続先・操作は宣言されていないため送信しません。`, 0 requests. The package holds no INTERNET permission. | — |

No LinkedIn or Indeed operation exists in the app (AWAI-3174); real sending
to them is **unknown / not applicable** here: no contract or credentials are
in place and none was attempted.

## Physical device

moto g05 (`ZY32MCL7RD`), `motorola/lamul_gjpn/lamul:15/VVTA35.51-153/cebf3c:user/release-keys`,
720×1604. The phone already had Awai Store and Home installed; the Store was
**not** replaced. The owner allowed using the phone while another session's
app (`network.awai.deai.dev.debug`) was in front; it was brought back to the
front afterwards and nothing of it was touched.

| Step | Result | Evidence |
| -- | -- | -- |
| Install | `adb install` of the same APK (sha256 `f8e508a0…2444`): `Success`. versionCode 1000, `installerPackageName=null` (adb, not the Store), no INTERNET permission. | — |
| Launch | `network.itonami.hiring/.MainActivity`, page `http://tauri.localhost/`. | `device-01-launched.jpg` |
| Load the bot outputs | Same five files, same way as on the emulator: 3 items, both bodies verified. | `device-02-loaded.jpg` |
| Approve | `apply-backend-engineer` approved, application step `applied`. | `device-03-approved.jpg` |
| Refuse (send back) | `publish-backend-engineer` sent back with 「掲載前に給与の表記を見直す」; the blocked record has no approve control. | `device-04-sent-back.jpg` |
| Network during load, approve and refusal | DevTools: **0 requests**. Probe `fetch("https://example.com/collect", {method:"POST"})`: refused with `TypeError`, 0 requests. | — |
| 16 KB page size warning | Android showed 「Android アプリの互換性」: `lib/arm64-v8a/libapp_itonami_hiring_lib.so` is not 16 KB aligned (LOAD segment). Dismissed with OK. The app ran normally; the APK needs a 16 KB-aligned native library before a release. | `device-05-16kb-warning.jpg` |

## Known gaps

- App content scrolls under the status and navigation bars (no insets).
- Android's document picker was not driven; files were handed to the same
  input handler over DevTools.
- The export button (download of the approved text) was not exercised on
  Android.
- Store install on the physical device (the phone's Store was not replaced;
  the app was installed with adb). Online catalog (`store/distribution`),
  release signing.
- The native library is not 16 KB page-size aligned (warning on the moto g05).
- The host was heavily loaded (load average about 66–88) by other sessions'
  emulators and builds.
