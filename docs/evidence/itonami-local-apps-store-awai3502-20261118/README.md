# Itonami local apps in the bundled Store (AWAI-3502, 2026-11-18)

28 Tauri v3 itonami apps were built as Android APKs and listed in the bundled Store through `android/local-apps.json` and `build.py --local-apps-dir`. Each app keeps all its data on the device and makes no external request.

## Build
- **APKs**: one per app repo, from `scripts/android-apk.sh` (16 apps) or `app/scripts/android-apk.sh` (12 apps whose logic is the repo's own `.cljk`, compiled with ClojureScript). All are debug builds signed with the local Android debug identity.
- **Checks each APK passed before listing** (`build.py`):
  - package `network.itonami.<suffix>`;
  - the single development signer;
  - no permission other than AndroidX's non-exported receiver permission (no `INTERNET`);
  - at most 40 MiB.
- **Each APK is also aligned for 16 KB pages**: `zipalign -c -P 16` was checked separately, not by `build.py`.
- **Sizes**: about 19.5 MB per APK, 28 in total.
- **Store build**: `python3 android/build.py --version 1 --skip-cljs --local-apps-dir <28 APKs>`. The catalog has 30 apps: Yotei, Torihiki and the 28. `store-v1.apk` SHA-256 `4a06bafae105fc1f6d6daac2d418cc50416d2705196187912250986f745d5ce7`. The APKs are not committed.

## Emulator run
AVD `Awai_Itonami_AWAI3502` (API 35 default arm64 image, no Google Play). The emulator was created for this task.

1. `store-01-open.jpg`: the Store lists the new apps.
2. `store-02-detail.jpg`: Abaki's detail page shows the on-device presentation (端末内で使える).
3. `store-03-disclosure.jpg`: the disclosure before adding the app says 外部への送信なし and that the app has no network permission.
4. Android first asked to allow installs from this Store. On this test emulator, that permission was granted with `adb shell appops set network.awai.store REQUEST_INSTALL_PACKAGES allow`.
5. `store-05-confirm.jpg`: the Store's native confirmation shows the SHA-256 `a9e3f7b6…3136`, which equals the Abaki APK that was built.
6. `store-06-installer.jpg`: Android's own install dialog. After INSTALL, `pm list packages` shows `network.itonami.abaki`.
7. `abaki-02-run.jpg`: the installed Abaki runs its ClojureScript domain. "CI を計算する" returns `:ci 60` (30 + 30), as expected.
8. `launch-28-apps.jpg` and `launch.log`: all 28 APKs were installed with `adb install` and launched. Each opened its own MainActivity and rendered its page. Mold Allergy rendered on a second launch with a longer wait; the first capture was taken while the host was under heavy build load.

## Instrumentation
For this run the Store was rebuilt with `--itonami-apk store/distribution/dev-20261116/itonami.apk --local-apps-dir <28 APKs>`. The existing instrumentation requires `network.itonami.app` in the catalog, which is why the Itonami APK was added. The tests were built with `android/build-tests.py --version 1`.

`am instrument -w network.awai.tests/.StoreInstrumentation` printed: "Awai Android store integrity: 74 assertions passed" (`instrumentation.log`). This includes, for each of the 28 apps:
- the asset name and the 40 MiB budget fixed in `Catalog.java`;
- the APK bytes after the package, signer and version check (`verifiedApk`).

It also checks that an unlisted `network.itonami.*` id is refused.

## Not verified
- A physical device.
- A signed release, key rotation, or an online catalog revision with APK pins (`android/online-pins.dev.json` is unchanged).
