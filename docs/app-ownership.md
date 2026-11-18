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
