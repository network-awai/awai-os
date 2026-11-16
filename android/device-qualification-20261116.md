# AWAI-2977 device qualification — 2026-11-16

Target: moto g05, LineageOS 24.0-20261112-NIGHTLY-lamu, Android 17 / SDK 37, WebView 156.0.8078.47. Device identifier and private data are excluded. Chat binding: 01a1e187-0e12-7813-b500-73aa77f2a03e.

| Acceptance | Observed evidence |
| --- | --- |
| Shared model | 4 Babashka tests / 20 assertions; 3 tests of actual compiled browser domain passed |
| APK trust | Build/signature verification and 10 on-device instrumentation assertions passed on final Store |
| Home | Actual clock, apps, settings and Store entry render; HOME role is `network.awai.home`; original launcher remains installed |
| Store acquisition | Yotei installed with installer and initiating package `network.awai.store` |
| Agenda | Created own test event through UI and observed Home provider projection |
| Update | VersionCode 1 to 2 via Store, independent native confirmation, Android update dialog; event retained |
| Cancellation | Native confirmation canceled; installed version remained 2 |
| Final version | Home/Store 0.1.2 installed; Yotei updated to versionCode 3 / 0.1.2 through Store and Android dialog |
| Reboot | Normal reboot on 0.1.1, boot_completed=1, Awai resumed; user confirmed Home; Yotei event retained. Later 0.1.2 changes were launched/tested but not rebooted again |
| Clock correction | Phone initially dated Nov 12; network time corrected to Nov 16 after reboot. Past event no longer appears as next event, but remained in Yotei |
| Text size | Actual system font_scale=2: Store and Updates wrap/scroll, navigation works; restored 1.0. Full accessibility/TalkBack qualification remains open |
| Shared browser | Chrome on macOS: signed catalog verified, enable/open bundled Yotei, create and reload persistence |
| Static export | 31 assets verified; modified client.js negative control rejected by digest |
| NixOS | Opt-in module/source only; Nix evaluation/build/boot unavailable on this host |

Final development APK digests:

- `home-v3.apk`: `44965b8bf53d9bfca26a78a11e35de6246f21c77b37f2bb6f080b4feecedeeeb` (1616754 bytes)
- `store-v3.apk`: `f7a8eb8c31534b8f68e41a4225764f6ef7ea77c8e7a3ccc35d9192a4b3856b5b` (2948222 bytes)
- `yotei-v3.apk`: `e6c8636ecd8d438802c2c05940dd0c3f2b5da58f252ac5ecc1a1251892ddc5a0` (1616754 bytes)

The final source also revalidates catalog signature/expiry for each native catalog operation instead of retaining a long-lived cached catalog. Existing expiry and signature negative controls passed. Signing is the local Android debug identity; no production release claim.

Own test event was deleted through Yotei confirmation after retention checks. Original font scale (1.0), screen timeout (60000 ms), and stay-awake setting (0) were restored. Original `com.android.launcher3/.uioverrides.QuickstepLauncher` stays installed; rollback is Android Settings → Default apps → Home app. No root, ROM/partition write, erase, relock or Google account operation was performed.

Screenshots, build reports and raw logs remain in the task worktree `.agent-output/`; they are not automatically deleted or exposed publicly. No exact-head CI checks are reported on PR 150. PR 146 dependency and this PR remain unmerged. Remote marketplace, production key lifecycle, platform native Nix/Waydroid installers and Google Play API qualification remain AWAI-2978/2979/2981/2982 follow-ups. Issue-attributed tokens/cost/active/wait time and sizing unit are unknown; no velocity or percentage is inferred.
