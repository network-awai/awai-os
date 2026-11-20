# Soudan (法律相談) — consultation memo for a lawyer you chose

Write down a legal problem in your own words and turn it into a memo to hand to a lawyer you chose yourself. Everything runs and is stored on the device. Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/horei`. Tracking: [AWAI-3321](https://linear.app/kotobalabs/issue/AWAI-3321) (parent [AWAI-3236](https://linear.app/kotobalabs/issue/AWAI-3236)).

## Scope (ADR 0001)

The scope comes from ADR 0001 in `kotoba-lang/app-itonami-cloud-itonami-isic-6910-legalsupport` (`docs/adr/0001-awai-legal-matching-scope.md`):

- **Template selection and document assembly only (D1).** The memo repeats what the user typed under fixed headings and adds a fixed notice. It does not analyse the matter, rate a risk or propose wording. A test checks that no line is added beyond the title, headings and notice.
- **The lawyer is whoever the user names (D9, owner decision O1 of 2026-11-18).** The app holds no list of lawyers and never suggests, ranks or recommends one. It checks only that the name and contact fields are filled in.
- **No default jurisdiction (O7 open).** The user must choose one. Only Japan has a template, so Japan is the only choice.
- No referral fee or other payment path exists (D2).

## Sending is not declared yet

ADR 0001 D9 allows sending the memo (operation X1), but its service and endpoint have not been chosen. The canonical `kotoba-client-runtime.js` requires an `https` service origin for a `browser-action` operation. Handing the memo to the user's own mail app through the Android share sheet has no such origin, so it cannot be declared yet.

Until it can, the descriptor declares **no operations**:

- The send button stays disabled and says no sending route exists yet.
- A send attempt goes through the canonical broker and is refused there.
- The Android manifest has no `INTERNET` permission.

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
  - `operations: []`;
  - local state in `localstorage` through `awai.shell.host.v1`, with revision-checked writes.
- The page and Tauri CSPs allow only the Tauri IPC for `connect-src`. The build fails if either CSP or the descriptor says otherwise.
- The Tauri host exposes only `awai_host_info`. It has no network, filesystem, share, installer or shell permissions.
- UI text is keyed in `src/messages.js` (ja, en). Text the user types is never translated or rewritten.

## Not yet qualified

| Item | Waiting on |
|---|---|
| Sending (X1) and the lawyer's return path (X3) | A runtime declaration shape for the share sheet |
| The lawyer-side screens | X3 |
| Store distribution | [AWAI-3238](https://linear.app/kotobalabs/issue/AWAI-3238) |
| Physical devices | — |
| Release signing | — |
| Figma design review | — |
| TalkBack testing | — |
| Owner decisions O2–O10 | The owner |

## Police reporting guide

Open **警察への届出 / Police reporting** in Soudan. The guide is bundled in
the app and covers preparation for reporting cybercrime and fraud. It uses the
248 entries from the UN M49 geographic list as a lookup index. The list is a
statistical classification. It does not establish police jurisdiction.

The initial review uses the jurisdiction set from the Mithril intake survey
(MITHRIL-1749 / MITHRIL-1750) and rechecks primary public sources. The
MITHRIL-186 evidence-preparation and MITHRIL-365 case-stage models inform the
guide. The bundled catalog contains only public guidance and published,
anonymized case summaries. No private case records are imported.

Update `src/police-guide.json` with the official publisher, URL and retrieval
date for each statement. Use `official-route` for an official route documented
for the stated scope, `partial` for narrower coverage and `unverified` for
unconfirmed historical leads. An entry with no status is unassessed. Identify
evidence items as required, recommended or to be retained using official
wording as the basis. Record the specific confirmed stage for every public
case. Record a supplement, a status check, a complaint about staff conduct and
a challenge to an agency decision as distinct follow-up paths. An empty
section means unverified.
