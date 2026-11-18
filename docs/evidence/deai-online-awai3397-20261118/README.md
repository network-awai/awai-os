# Deai through the online Store catalog, revision 104 (AWAI-3397, 2026-11-18)

This records an online install on a disposable emulator. It does not cover production signing or a physical device, so neither is proven here.

## Pins

`android/online-pins.dev.json` points at commit `30d2f1543aacdb585d460c0cf2dbf5ecbed4fb08` (PR #258). That commit holds the revision 104 envelope and APK pins for Yotei, Itonami, Torihiki Bot, Torihiki and Deai. The pins were merged in PR #259. Before this run, each of the six pinned files was fetched at that commit, and its digest and byte count matched.

## Build

The Store was built on 2026-11-18 at about 13:02 JST from merged main (`14b984e`) with `forest-storage run … python3 android/build.py --version 1 --online-pins android/online-pins.dev.json`, which exited 0. The Store APK requests INTERNET only in this online build.

## Disposable emulator

`sdk_phone64_arm64` Android 15 (`AE3A.240806.019`, userdebug, test-keys), AVD `Awai_Deai_AWAI3178` started with `-wipe-data` on port 5780 (host load average 36 at start, about 70 at the end). The Store's install-unknown-apps permission was granted with `appops`. The consent dialogs were answered by taps on this test emulator.

| Step | Result | Evidence |
| -- | -- | -- |
| オンラインカタログを確認 | The canonical consent dialog showed `download-catalog` with the exact URL of the revision 104 envelope, its sha256 `f7f18c4e…` and a 4,207-byte budget. | `r104-01-consent.jpg` |
| Allow once | The host admitted revision 104. The list showed Yotei v0.1.3, Itonami, Torihiki Bot, Torihiki and Deai v0.1.0, all marked オンライン配信. | `r104-02-list.jpg` |
| Add Deai | A separate consent dialog showed `download-apk-network.itonami.deai`, `dev-20261118-r104/deai.apk`, sha256 `c3452795…` and a 20,782,497-byte budget. | `r104-05-apk-consent.jpg` |
| Allow once | The download (20,782,497 bytes) was staged as `files/online-deai.apk`. The dialog showed 「オンライン配信・検証済みキャッシュ」 and the sha256. | `r104-06-verified.jpg` |
| Android install | Android's installer asked "Do you want to install this app?" and installed it. `installerPackageName=network.awai.store`, versionCode 1000. | `r104-07-installer.jpg` |
| Launch | `network.itonami.deai/.MainActivity` resumed (`am start -W` Status ok, TotalTime 4,273 ms). The screenshot 4 s later was still blank while the WebView loaded under host load, so it is not kept. The same APK bytes rendered the app in the bundled-Store run (`../deai-store-awai3374-20261118/store-10-launched.jpg`). | — |

The emulator was stopped right after the launch. The deny path of the catalog consent was recorded for revision 102 in `docs/evidence/torihiki-bot-online-awai3313-20261118/` and was not repeated here.

## Known gaps

- Development debug key only. The catalog expires 30 days after 2026-11-18 (`expiresAt` 1797566165).
- No physical device. The owner's moto g05 has its own Store build (versionCode 5), which was not replaced.
- The rendered page after the online install was not captured (see Launch above).
