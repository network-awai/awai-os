# Shared UI on physical Awai Android — 2026-11-17

JUN-1337. Applied the shared UI changes from PR177/182 to the existing physical Desktop (LXY MQ, AMD Ryzen7 7735HS, x86_64, API37,1920×1200). This is the current Awai-apps-on-Android test installation; no new Awai-built ROM or OTA was installed. The separate USB Moto and existing emulators were not modified.

Built real x86_64 Tauri3.0.0-alpha.6 APKs from2480f77fb10ad80b2fe8bdd13d5c9f19812c703e. Relevant app/shared-library/shell sources have an empty diff against main2cfcf9074a131b9c45a92f2afa4d842d6dab984d. Murakumo's pinned llama.cpp native JNI was compiled for x86_64; ARM translation was not used as a substitute for this build. Both app IDs and their original debug signer match the installed apps. These are local debug builds, not public signed releases.

Before updating, retained the two installed APKs privately and recorded app UID/directory metadata. Updated using only `adb install -r`; no uninstall, clear-data, keys/profile extraction, OS flash, reboot or provisioning changes. After installation, pulled both actual installed base APKs and independently recomputed SHA256/bytes: both match the built artifacts. App IDs/UIDs and root/files directory inodes were retained; existing Murakumo model remained imported. This is not a byte-for-byte backup of user data.

| App | Actual physical interaction | Screen |
| --- | --- | --- |
| Itonami | Japanese sign-in UI, shared controls; Android touch switched Asa/Hiru and restored Asa. Account login not attempted; disconnected service indicator retained. | [Itonami](evidence/jun-1337/itonami.png) |
| Murakumo | Existing model imported/unloaded; shared two-panel desktop UI. Android touch opened the system model picker and Back cancelled without importing. | [Murakumo](evidence/jun-1337/murakumo.png) |

The cancellation returns to Murakumo but displays a generic operation error. This observed UX defect is tracked in [JUN-1338](https://linear.app/kotobalabs/issue/JUN-1338); successful cancellation is not reported as error-free inference. No generation or model load was performed.

[Machine receipt](evidence/jun-1337/physical-launch.json) records installed byte identity, hardware, preservation coverage and probe limitations. Actual visible controls had the shared999px radius/52px height and no horizontal overflow; both screens were visually inspected. The final foreground app is Itonami Sign In. Owner authentication, internal account views, model execution and persistent reboot remain separate acceptance. Unique raw diagnostics and APK rollback copies are retained in the task worktree; only these curated non-sensitive screens/receipt are public.
