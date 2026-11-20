# Torihiki devnet viewer through the online Store catalog, revision 103 (AWAI-3320, 2026-11-18)

This records an online install on a disposable emulator. It does not cover production signing, a physical device or devnet orders, so none of those are proven here.

## Pins

`android/online-pins.dev.json` points at commit `4cbc09170767e8b3a968dc94a5e01ed8017a1544` (PR #232). That commit holds the revision 103 envelope and APK pins for Yotei, Itonami, Torihiki Bot and Torihiki. The pins were merged in PR #233. Before this run, each pinned file was fetched at that commit, and its digest and byte count matched.

## Build

The Store was built on 2026-11-18 at 10:27 JST with `forest-storage run … python3 android/build.py --version 1 --online-pins android/online-pins.dev.json`, which exited 0.

The build waited until free space reached at least 46 GiB; it was 52.9 GiB when the build started. Earlier attempts had been refused by the guard's 40 GiB floor, and the guard was not bypassed.

## Disposable emulator

The emulator was `sdk_phone64_arm64` Android 15 (`AE3A.240806.019`) on a fresh AVD at port 5810. The AVD was deleted afterwards. The host was under heavy load: during boot the emulator's own system server restarted once (`DeadSystemException` at 10:42), and the Store was relaunched after that. The Store's install-unknown-apps permission was granted with `appops`.

| Step | Result | Evidence |
| -- | -- | -- |
| オンラインカタログを確認 | The canonical consent dialog showed `download-catalog` with the exact URL of the revision 103 envelope. | `r103-01-consent.jpg` |
| Allow once | The host admitted revision 103. The list showed Yotei v0.1.3, Itonami, Torihiki Bot and Torihiki v0.1.0, all marked オンライン配信. | `r103-02-list.jpg` |
| Add Torihiki | A separate consent dialog showed `download-apk-network.itonami.torihiki` and `dev-20261118-r103/torihiki.apk`. | `r103-05-apk-consent.jpg` |
| Allow once | The download (4,206,342 bytes) was staged as `files/online-torihiki.apk`. The dialog showed 「オンライン配信・検証済みキャッシュ」 and sha256 `0717795a…`. | `r103-06-verified.jpg` |
| Android install | `installerPackageName=network.awai.store`, versionCode 1. | — |
| Launch | `network.itonami.torihiki/.TorihikiActivity` resumed and showed the devnet reads and the order section. | `r103-08-launched.jpg` |

The deny path of the catalog consent was already recorded for revision 102 in `docs/evidence/torihiki-bot-online-awai3313-20261118/`. It was not repeated here.

## Known gaps

- Development debug key only. The catalog expires 30 days after 2026-11-18.
- No physical device.
- No devnet reads or orders were made from the installed app.
