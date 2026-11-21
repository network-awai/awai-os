# Soudan (法律相談) — consultation memo for a lawyer you chose

Write down a legal problem in your own words and turn it into a memo to hand to a lawyer you chose yourself. Everything runs and is stored on the device. Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/horei`. Tracking: [AWAI-3321](https://linear.app/kotobalabs/issue/AWAI-3321) (parent [AWAI-3236](https://linear.app/kotobalabs/issue/AWAI-3236)).

## Scope (ADR 0001)

The scope comes from ADR 0001 in `kotoba-lang/app-itonami-cloud-itonami-isic-6910-legalsupport` (`docs/adr/0001-awai-legal-matching-scope.md`):

- **Template selection and document assembly only (D1).** The memo repeats what the user typed under fixed headings and adds a fixed notice. It does not analyse the matter, rate a risk or propose wording. A test checks that no line is added beyond the title, headings and notice.
- **The lawyer is whoever the user names (D9, owner decision O1 of 2026-11-18).** The app holds no list of lawyers and never suggests, ranks or recommends one. It checks only that the name and contact fields are filled in.
- **No default jurisdiction (O7 open).** The user must choose one. Only Japan has a template, so Japan is the only choice.
- No referral fee or other payment path exists (D2).

## Sending (X1, ADR 0001 D9 / owner decision O1)

The descriptor declares **one operation**: handing the memo to the lawyer the user chose, through the Android share sheet (`browser-action: share`, recipient `user-selected-app`; no service origin is fabricated). Scope is the O1/D9 range only: the memo the user assembled, to the lawyer the user named. The app holds no lawyer list and never suggests one (a test checks this). The operation also declares the finding-9 disclosure the canonical broker shows (recipient, country JP, data, purpose, `one-time` frequency, withdrawal slot); the canonical `kotoba-client-runtime.js` pin is recorded in `otehon/shell/vendor/PINS.json`.

Two gates, both fail closed:

- Governor review: the operation runs only when it is in the broker's eligible operations (`approvedOperations` intersected with `hostSupportedOperations`). Otherwise the send button stays disabled and `invoke` refuses before consent is even shown.
- User approval: every send shows the canonical per-operation consent dialog (`consent: each-operation`). When the device language is Japanese the dialog is Japanese (the device language picks the wording; English otherwise). The first screen shows the declared facts (送り先, 送る情報, 目的, 送る回数); the technical scope (Service, Operation, Receiver "the app you pick next", Data categories `legal.consultation-memo`) stays behind 詳細を見る. Denial throws and nothing leaves the device.

The sent body heads with a 宛先 line built only from what the user typed (name / office / contact, `model.js addressedMemo`): no candidates, no lookup, no recommendation (ADR D9, tested). The memo preview itself is unchanged.

Wiring: the page's browser adapter calls the Tauri `soudan_share` command (Android only; other platforms fail closed with `android-only`), which fires `ACTION_SEND` through `SharePlugin` (no chooser result is read back: resolving means the chooser opened). Tests prove approval hands the memo over exactly once and denial hands nothing over, through the real broker and consent host.

- The Android manifest has no `INTERNET` permission: the share sheet needs none.

## Build

```sh
(cd ../../packages/awai-ui && npm ci && npm run build)   # shared UI, once per checkout
npm ci
npm test
npm run build                  # dist/: static files, each pinned in release.json
npm run build:android          # arm64 APK; JDK21, SDK, NDK 27.0.12077973
```

Debug APK for an emulator: `npx tauri android build --debug --apk --target aarch64`.

## Boundaries

- `kotoba.app.client-runtime.v1` descriptor:
  - one operation (`itonami.soudan.send` / `user-chosen-lawyer` / `send-consultation-memo`, consent `each-operation`, share-sheet endpoint);
  - local state in `localstorage` through `awai.shell.host.v1`, with revision-checked writes.
- The page and Tauri CSPs allow only the Tauri IPC for `connect-src`. The build fails if either CSP or the descriptor says otherwise.
- The Tauri host exposes `awai_host_info` and the Android-only `soudan_share`. It has no network, filesystem, installer or shell permissions.
- UI text is keyed in `src/messages.js` (ja, en). Text the user types is never translated or rewritten.

## Not yet qualified

| Item | Waiting on |
|---|---|
| The lawyer's return path (X3) | — |
| The lawyer-side screens | X3 |
| Store distribution | [AWAI-3238](https://linear.app/kotobalabs/issue/AWAI-3238) |
| Physical devices | — |
| Release signing | — |
| Figma design review | — |
| TalkBack testing | — |
| Owner decisions O2–O10 | The owner |
