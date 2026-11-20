# App ownership and Awai OS integration

Product repositories own source, Android hosts, builds, tests, package
identities, and release artifacts. Awai OS owns AOSP integration, Home, app
discovery, Store catalog and signature verification. Apps can consume shared
packages at immutable revisions and verify their digests.

| App | Source and Android build |
| --- | --- |
| Drive | [app-drive/tauri](https://github.com/network-awai/app-drive/tree/main/tauri), moved from Awai OS main at `540674c` |
| Bunsho | [app-itonami-bunsho](https://github.com/network-awai/app-itonami-bunsho), Android packaging in [PR #14](https://github.com/network-awai/app-itonami-bunsho/pull/14) |
| Hyokeisan | [app-itonami-hyokeisan](https://github.com/network-awai/app-itonami-hyokeisan), Android packaging in [PR #11](https://github.com/network-awai/app-itonami-hyokeisan/pull/11) |
| Zuhyo | [app-itonami-zuhyo](https://github.com/network-awai/app-itonami-zuhyo), Android packaging in [PR #13](https://github.com/network-awai/app-itonami-zuhyo/pull/13) |
| Yotei | [app-yotei](https://github.com/network-awai/app-yotei), Android ID `network.itonami.yotei`. Os-side consumer migration is tracked in [AWAI-3559](https://linear.app/kotobalabs/issue/AWAI-3559). |
| Mail | Android app and owner are pending. [Mail Relay](https://github.com/network-awai/app-itonami-mail-relay) owns its relay service. |

The Office apps consume [app-itonami-office/android-host](https://github.com/network-awai/app-itonami-office/tree/main/android-host)
as shared build tooling. Each editor uses its own browser build receipt and
pins the host revision. Package IDs and snapshot formats are preserved.

For each remaining in-tree product app, establish the owner repo and verify
its standalone build first. Preserve the package ID, signer and storage schema
across upgrades. Awai OS consumes signed, digest-pinned APKs through its usual
distribution path. Track source migration, signed artifact publication,
Store readback and device upgrade verification separately.

Drive's [WNFS proposal](https://github.com/network-awai/app-drive/blob/main/tauri/docs/scalable-sync-design.md)
travels with the client. AwaiFS codec and storage contracts stay with their
owning repositories. The bounded owner-store path remains available while
the WNFS path is verified.

## Remaining ownership transfers

| Source | Boundary and migration check |
| --- | --- |
| `apps/yotei`, `android/yotei`, `android/build.py` | The product owns UI, migration and package release. Awai OS owns the Home agenda consumer and Store verification. Retire each in-tree build after the product's compatible signed APK passes Store readback and a same-signer update preserves the existing agenda and Home projection. The shared UI port is in [app-yotei #3](https://github.com/network-awai/app-yotei/pull/3). |
| `apps/horei`, `apps/isekai`, `apps/soudan`, `apps/x402`, `apps/data-contribution`, `apps/payment-drafts`, `apps/public-funds`, `apps/securities-drafts` | Each directory contains product code and an independent Tauri target. Confirm the owner repo and its signed artifact for each app while retaining shared Awai Shell, Awai UI and catalog verification in Awai OS. |
| `apps/itonami`, `apps/murakumo` | Preserve the Awai Shell host and the OS integration APIs. Identify the product-owned package entrypoints and confirm the native inference and IPC contracts before moving packaging. |
| apex `otehon/wnfs-cljc`, `otehon/owner-store`, `otehon/legacy-awaivol`, `otehon/macos-*` | Treat AwaiFS/WNFS SDK, legacy macOS volume lifecycle and Finder, and Drive product UI as separate ownership boundaries. Keep Awai Network protocol and retention contracts in apex. Preserve deployed AwaiVol data and service state while extracting the SDK or tooling. Check and update revision pins in [Drive](https://github.com/network-awai/app-drive), [Yataverse](https://github.com/network-awai/app-itonami-yataverse) and [Itonami](https://github.com/network-awai/app-itonami) before retiring the old source path. |
| apex `apps/civic-workspace`, `apps/node-console`, `apps/matsuri`, `apps/shakai-kaisha` | Check standalone entrypoints and consumers. Product onboarding/consoles belong with their app owners after confirming the protocol and deployment boundaries. |
