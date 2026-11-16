# Yotei / Awai Shell v1 closeout — 2026-11-16

Owner selected Tauri v3 for Otehon and requested source review/merge/cleanup. The independent app lives in `apps/yotei`; common host API in `packages/awai-shell`. The explicit native engine is Wry v3 / OS WebView, not a CEF or v2 fallback. Kotoba/Amu Native remains separate.

## Verified and delivered

- Versioned local host API: capability discovery, bounded app-scoped state, Web Locks + revision conflict, corrupt-state refusal, native handshake and bounded Android agenda adapter.
- Independent static Web build and signed arm64 APK (0.2.0/code2000, `network.itonami.yotei`), no INTERNET permission. Existing compiled `.cljc` event core and exact canonical broker reused.
- Local Node checks: 9 tests pass (6 host/Yotei + 3 existing Store core). Babashka: Store4 tests/20 assertions and GMS7 tests/54 assertions pass. Scoped diff/conflict checks pass. Repository Actions is disabled; no CI result was fabricated or global setting changed.
- Chrome actual create/reload persistence and Mac Tauri v3 actual create/save/quit/relaunch persistence observed. These are separate from physical Android and NixOS acceptance.
- Draft release: https://github.com/network-awai/awai-os/releases/tag/untagged-1e00eaf46e4aec28d278 . All4 assets read back uploaded with server digests matching local bytes. It remains unpublished/development-signed.
- Artifact source binding: `b9f57842cb5d09cd628de1cf6e9f29cce5cb7891`, clean at packaging. Web SHA256 `dc4268fa585372f22d71f5b281d98562f95c2f0a6e86b509ac25cb7f4290422c`; APK SHA256 `1de800da6a95e0aba2eceb322629296ed380072e6f760ab2ce53934d678e2bc1` (21634390bytes). Signer `2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29` is the existing development identity, not a production publisher signature.

## Review / integration boundary

PR151 includes the prior offline Home/Store prerequisite. PR146 is already merged. Later online-distribution work on PR150 belongs to its active owner and is not imported or closed by this closeout. Review caught the old static Store module using an implicit Chromium profile; a narrow persistent private-profile correction is included to preserve local state. Current main was merged without rebase or force push and its unrelated dapp/design work retained. No existing phone app/data, live OS image or production route was changed.

## Resume points

- [AWAI-2990](https://linear.app/kotobalabs/issue/AWAI-2990): actual moto g05 update without reset, explicit legacy agenda import, restart/HOME projection and Store enrollment. The development APK exceeds the current20MiB catalog ceiling; release optimization or an explicit bounded limit review is required. Do not silently bypass it.
- [AWAI-2991](https://linear.app/kotobalabs/issue/AWAI-2991): actual NixOS evaluate/build/GUI/restart/closure distribution. Owner explicitly deferred it; package/module/CI-export configuration only exists now. Select an authorized builder before proceeding.
- Production publisher signing, rotation and public release remain open. Tauri choice does not itself qualify the whole Otehon OS shell.

[AWAI-2989](https://linear.app/kotobalabs/issue/AWAI-2989), [PR151](https://github.com/network-awai/awai-os/pull/151). Model/settings and attributable provider token/cost/active-wait telemetry are unknown. Remaining-unit forecast was an explicitly uncalibrated planning prior, not measured usage. Preserve local build/diagnostic evidence outside a collected worktree before removing it; never collect the active parent Store worktree or original device backups.
