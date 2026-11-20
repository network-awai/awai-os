# Torihiki Bot through the online Store catalog (AWAI-3313, 2026-11-18)

This records an online install on a disposable emulator. Nothing here proves production signing, a physical device, or a bot launch.

## Pins

`android/online-pins.dev.json` points at commit `d9a2d6242b85385c81eb5bb5453cad610cebfc0e` (the merge of PR #226):

- Catalog: `store/distribution/dev-20261118/catalog-envelope.json` (revision 102), 2,749 bytes, sha256 `047d549e…`.
- APK pins:

| App | File | Bytes | sha256 |
| -- | -- | -- | -- |
| `network.itonami.yotei` | `dev-20261116/yotei.apk` | 1,621,048 | `0f5b2d0a…` |
| `network.itonami.app` | `dev-20261116/itonami.apk` | 32,644,749 | `09e92086…` |
| `network.itonami.torihiki.bot` | `dev-20261118/torihiki-bot.apk` | 29,506,324 | `797013c7…` |

Each file was fetched from raw.githubusercontent.com at that commit before the pins were written, and its digest matched.

## Build

- `build.py --version 1 --online-pins android/online-pins.dev.json`: passed.
- This Store bundles only Yotei and Torihiki. Torihiki Bot can be reached only through the online catalog.

## Disposable emulator

The emulator was `sdk_phone64_arm64` Android 15 (`AE3A.240806.019`), a fresh AVD on port 5808, deleted afterwards. The Store's install-unknown-apps permission was granted with `appops`.

| Step | Result | Evidence |
| -- | -- | -- |
| オンラインカタログを確認 | The canonical consent dialog shows `download-catalog` with the exact pinned URL. | `online-04-consent.jpg` |
| Deny | 「取得を完了できません。client operation was not approved」 appears and the catalog is unchanged. | — |
| Allow once | 「署名済みオンラインカタログを確認しました。」 The host admitted rev102. The list shows Yotei v0.1.3, Itonami v0.1.0 and Torihiki Bot v0.1.0, all marked オンライン配信. | `online-07-list.jpg` |
| Add Torihiki Bot | A separate consent dialog shows `download-apk-network.itonami.torihiki.bot` and the pinned APK path. | `online-10-apk-consent.jpg` |
| Allow once | 29,506,324 bytes downloaded and staged as `files/online-torihiki-bot.apk`. The host's `verifiedApk` passed. The dialog shows 「オンライン配信・検証済みキャッシュ」 and sha256 `797013c7…`. | `online-11-verified.jpg` |
| Android install | `installerPackageName=network.awai.store`, versionCode 1000. | — |
| Launch | `network.itonami.torihiki.bot/.MainActivity` showed the bot profile. | `online-13-launched.jpg` |

## Known gaps

- Once the online catalog is admitted, the Torihiki devnet viewer (`network.itonami.torihiki`) is no longer listed, because it is not in revision 102.
- The pinned `itonami.apk` is x86_64 only. The bot APK is arm64 only.
- Development debug key only. The catalog expires 30 days after 2026-11-18.
