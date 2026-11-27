# Soudan — 自己整理メモツール (Self-organization consultation memo tool)

Write down a legal consultation's facts, timeline, questions, and post evidence list in your own words before meeting a lawyer you chose yourself. Everything runs on the device with zero server-side consultation storage, zero ads, and zero fees. Built for static Web (`https://soudan.itonami.app`) and Android / Awai OS via Tauri **3.0.0-alpha.6** (`tauri-runtime-wry` v3, OS WebView).

- Package ID: `network.itonami.soudan`
- Runtime profile: `restricted-wasm-v1` (canonical `kotoba-client-runtime.js` pinned in `otehon/shell/vendor/PINS.json`)
- Tracking: Soudan item #223, [AWAI-3321](https://linear.app/kotobalabs/issue/AWAI-3321), [AWAI-3236](https://linear.app/kotobalabs/issue/AWAI-3236)

> Not legal advice and not a substitute for a lawyer. Consult a lawyer for specific legal judgment.  
> 法的助言ではなく弁護士に代わるものではありません。具体的判断は弁護士へ相談してください。

## Scope & Legal 7-Barrier Model (ADR 0001 + Legal item #224)

1. **Template selection and self-organization only (ADR 0001 D1, Judicial Scrivener Act Art. 73).** Assembles user-entered text under fixed headings with a fixed legal disclaimer. Never judges infringement or legal merit, never counts remaining days, and never drafts court filings (petitions, complaints, registration filings).
2. **User-typed lawyer recipient only (ADR 0001 D9 / O1).** Holds no lawyer list and never selects, ranks, or endorses any lawyer. An optional manual paste helper parses user-pasted `bengoshi.lawyer.card.v1` JSON or Bengoshi's 7-line manual copy text (`氏名:` / `所属弁護士会:` / `登録番号:` / `事務所名:` / `連絡先:` / `資格確認状態:` / `日弁連検索:`) into the editable recipient fields (`name`, `office`, `contact`) with zero lookup and zero auto-send.
3. **2-app technical firewall.** Never auto-passes Soudan memo, other-party, or category fields into Bengoshi URLs or MCP tool arguments.
4. **7 indirect-benefit barriers.** Zero ads/PR/sponsors, zero paid SaaS/Store/Murakumo upsell links, zero payment/escrow/donations, zero paid-member or hardware gating (full Web + Android parity), zero Awai token/point/Saifu/x402 adapters, zero algorithmic lawyer selection, and zero server-side log collection or AI training on consultation inputs.
5. **No default jurisdiction (O7 open).** Only Japan (`JPN`, `consultation-memo.jpn.v1`) has a template so far.
6. **Evidence list for a lawyer (AWAI-3505 / O11).** Records user-typed URL, date-time, poster display name/ID, plus screenshot file name, size, capture time, and SHA-256 on device. Raw screenshot bytes are never persisted or transmitted. Only the 6 official user-facing routes are shown (zero Government Request Portals).

## 3-Surface Parity (`https://soudan.itonami.app`, Android, Awai OS)

All three surfaces share the same on-device multi-draft state (`itonami.soudan.state.v2`), minimized local audit log (`actor.kind: human | agent`, zero consultation text/PII), and canonical `kotoba-client-runtime.js` `each-operation` consent gate:

| Capability | Static Web (`https://soudan.itonami.app`) | Android / Awai OS (Itonami Store APK) |
| --- | --- | --- |
| Multi-draft local storage (`drafts[]`, `activeDraftId`) | Yes (`localStorage`, device-local, zero sync) | Yes (`localStorage`, `android:allowBackup="false"`) |
| Evidence hashing (filename, size, timestamp, SHA-256) | Yes (zero image bytes saved/sent) | Yes (zero image bytes saved/sent) |
| X1 Hand-off / Export (canonical `each-operation` consent) | Web Share API (`navigator.share`), `device.save` (`.txt`, `.md`, `soudan.memo.export.v1` `.json`), clipboard copy | Tauri `soudan_share` → Android `ACTION_SEND` share sheet |
| Optional manual paste (`bengoshi.lawyer.card.v1` / 7-line text) | Yes (user-pasted only) | Yes (user-pasted only) |
| Optional `murakumo.cloud` organization slot | Default OFF / fail-closed; graceful local fallback | Default OFF / fail-closed; graceful local fallback |
| App-origin network requests | **0** (100% static via `yataverse-bytes`) | **0** |

## PR #29 Semantic Operations & AWAI-4143 MCP Apps (Draft Alignment)

- Shared `noun.verb` contract in `src/semantic.js`:
  `soudan.draft.create`, `soudan.draft.select`, `soudan.draft.update`, `soudan.draft.delete` (irreversible: dry-run + explicit confirmation + audit), `soudan.evidence.add`, `soudan.evidence.remove`, `soudan.memo.assemble`, `soudan.memo.send` (X1, irreversible: dry-run + canonical consent + audit), `soudan.inference.organize`, `soudan.audit.list`.
- Machine-readable UI states (product UI / MCP Apps only; never IDE ACP): `idle` | `proposal.ready` | `governor.blocked` | `consent.required` | `audit.recorded`.
- MCP Apps embed (`src/embed.html` + `src/mcp-app.js`): `ui://soudan/app` (`text/html;profile=mcp-app`), JSON-RPC `postMessage` (`ui/initialize`, `ui/notifications/initialized`, origin + session validation), `content` + `structuredContent` text fallback always carrying the fixed legal disclaimer. Direct external X1 send and external inference are blocked inside the sandboxed iframe (`connect-src 'none'`).
- Status: **draft alignment** (formal AWAI-4143 conformance waits on spec PR + `catalog.list` POC gate).

## `murakumo.cloud` Inference Slot (Route B Honest Disclosure)

- Endpoint contract: synchronous `POST https://api.murakumo.cloud/v1/chat/completions` only. Any free-tier/external logging route is hard-rejected in code and tests.
- **Default OFF (`端末内のみ`) & fail-closed**: disabled until in-house `mishima` availability and Legal item #224 pre-launch blockers are resolved.
- **Route B honest disclosure** (`src/foreign-info.html#murakumo`, `app-descriptor.json`): names `Awai Network LLC` (US legal entity), notes Cloudflare gateway and possible Hugging Face / Modal / OpenRouter routing, states that standard API calls are not used for training/evaluation while honestly noting that fixed country-of-processing and service-wide non-retention are not guaranteed, and displays an explicit anonymization warning and MOJ 2026 §3-2(2)エ disclaimer before input and on output.
- Pre-flight governor guard blocks legal verdicts, infringement judgments, court/agency filing drafting, lawyer selection/endorsement, and monetization requests (`governor.blocked` + 6 official routes). Proposals never auto-overwrite user drafts without explicit human accept.

## Build, Verification & Packaging

```sh
(cd ../../packages/awai-ui && npm ci && npm run build)   # shared UI, once per checkout
npm ci
npm test                                                 # check-public.mjs + node --test suite
npm run build                                            # dist/: static files + release.json (< 10 MiB/file, zero symlinks)
```

### Dual-ABI Android / Awai OS APK (Itonami Store)

Requirements: JDK 21, Android SDK (API 33+ `minSdkVersion`, `compileSdk 37`), NDK `27.0.12077973`, 16 KiB ELF alignment (`-Wl,-z,max-page-size=16384` + `zipalign -P 16`), system-bar insets (`packages/awai-system-bars`), `android:allowBackup="false"`, target `< 40 MiB` (64 MiB Store ceiling).

```sh
# Dual-ABI release APK (arm64-v8a + x86_64, no --split-per-abi)
npx tauri android build --apk --target aarch64 x86_64
```

Static Web delivery (`https://soudan.itonami.app`) serves `dist/` via `yataverse-bytes` with real static files for `/`, `/foreign-info.html`, and `/embed.html` (no SPA fallback), embedded `<meta>` CSP and `no-referrer` on every HTML page, and every file strictly `< 10 MiB`.

## Pre-Launch Gates (Not Yet Qualified)

| Item | Waiting on |
| --- | --- |
| Formal operator entity details (`foreign-info.html`) | Legal item #224 Blocker 1 |
| Final O8 / `special-care` consent wording & Route B sign-off | Legal item #224 |
| In-house `mishima` endpoint readiness (currently fail-closed) | Dev / Ops |
| Formal AWAI-4143 conformance | Spec PR + `catalog.list` POC gate |
| Owner DNS (`_dnslink.soudan.itonami.app`) & production signing key rotation | Owner approval |
| Physical Android / Awai OS device & TalkBack qualification | Device run |
