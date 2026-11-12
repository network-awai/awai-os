# AWAI-2792 UI verification — 2026-11-11

Latest candidate uses automatic read-only HTTPS host inventory, with the canonical fresh-operation confirmation and no folder picker. Earlier unit sections below are historical; the final automatic-catalog section supersedes directory-picker behavior.

Base: e2c3f6a (AWAI-2791, PR #92). Candidate: codex/awai-2792-soshiki-ux.

Reagent/Hiccup renders SVG circles instead of rectangular nested cards. Garden styles retain Asa/Hiru/Yoru. Sibling circles have equal radii; their area does not represent membership or workload. Small/deep nodes remain reachable through child navigation and the role list. Editing is collapsed initially.

Validation on this candidate:

- `npm test --prefix nixos/otehon/shell`: 60/60 pass, including CLJS/JS extern property coverage.
- `npm run build --prefix nixos/otehon/shell`: file/kiosk release success.
- `OTEHON_HTTP=1 npm run build --prefix nixos/otehon/shell`: loopback preview release success.
- Both shell/link Closure builds reported 0 compiler warnings. Garden and JVM printed upstream name/deprecation warnings.
- Dedicated headless Chrome/CDP (1440×1100 and 390×844), random software wallet, synthetic local state: circle rendering, role details, self assignment, circle zoom, breadcrumb return, chart/list, open-role filter, circle-name search, no-results and reset, keyboard Enter activation, focus into details and return on close, dark theme, no horizontal document overflow.
- Dense fixture: 62 child circles remain accessible even when SVG labels would be too small. Multiple-root selector renders. No uncaught browser exceptions in these checks.
- `git diff --check`: clean.

Images: desktop.png (seed diagram), dark.png (Yoru after synthetic assignment), mobile.png (390px diagram). These are local synthetic browser observations, not real account/provider or Nix/physical-device qualification.

No broker/descriptor changes or production deployment. Existing 8901 preview is preserved; this worktree's HTTP preview uses 8902. Nix image hash placeholders inherited from AWAI-2791 remain outside this UI task.

Runtime binding: issue 3be182f3-b833-46e9-8977-4ba30cbbea9d / thread 01a1c9f2-e2ba-79c2-a37f-d5c7c348a18a / base e2c3f6a. Provider OpenAI; model GPT-6, exact variant and reasoning setting unknown. Forecast and observed input/cache-read/cache-write/output/reasoning tokens unknown because complete issue-attributed telemetry is unavailable. No zero usage or individual velocity is inferred. Source/browser unit completed; merge, deployment, and physical-device milestones remain separate.

## Profile ↔ circle follow-up

Owner requested itonami bot profile mapping after the initial circle UX unit. An optional, unique `profileId` (`profile-id` in the .cljc twin) now links each local Bot to an itonami profile ID. IDs use the owning manifest's lowercase/digit/underscore/hyphen name rule and 64-character limit. One profile may belong to multiple circles. Clearing its reference preserves membership and role assignments.

Bot Profiles offers a profile ID field, multiple circle checkboxes, and user-selected `itonami.edn` import. The importer bounds file size to 256KiB, checks itonami schema/runtime/ID, and keeps only ID, description, and skills. It does not persist the manifest or act on inference, authority, credentials, or capabilities. This is metadata import, not complete manifest/runtime validation. Connected Manimani agent names are never assumed to be itonami IDs.

Each focused circle offers direct profile membership editing and shows the linked IDs. Removing direct membership preserves role assignments. Existing version-1 state remains compatible; there is no filesystem/runtime/store write or new network request.

Follow-up verification:

- Node tests: 61/61.
- Otehon .cljc: `bb -cp nixos/otehon/soshiki/src:nixos/otehon/soshiki/test nixos/otehon/soshiki/test/soshiki/core_test.clj` — 13 tests, 87 assertions, no failures/errors.
- File/kiosk and HTTP shell/link release builds successful, 0 Closure warnings (upstream JVM/Garden warnings remain).
- Browser regressions from the prior unit passed again.
- Synthetic profile UI checks: manual ID, multiple memberships, circle-side unlink/relink, EDN import, persistence/reload, duplicate ID rejection, reference unlink, rejection of non-itonami input. A private sentinel field in the input never appeared in persisted state. No uncaught exceptions.
- Images: profile-circle.png and profile-bots.png. These use synthetic profiles and a software wallet; they do not establish connection to a live itonami process or modify the user's profile store.

Run binding remains AWAI-2792 / 01a1c9f2-e2ba-79c2-a37f-d5c7c348a18a; follow-up base d3c6c04. Provider OpenAI / GPT-6 exact variant and reasoning setting unknown. Forecast and observed token fields remain unknown for lack of complete attributed telemetry; no zero or velocity inferred.

## Existing-profile list selection

The circle picker can now enumerate an existing itonami profiles directory, search its IDs/descriptions, select a profile, and bind it directly to the current circle without prior Bot registration or typing its ID. An already-bound profile reuses its Bot record. Only a selected profile becomes persistent organization state.

Browser-local File System Access supplies read access: on first use choose `profiles` (or its `.itonami` parent). The browser may retain the read handle; subsequent reads check permission again. A separate action changes the folder. Enumeration opens only immediate, validly named profile directories and bounded `itonami.edn` files, never config.yaml, .env, workspace or session files. The manifest's itonami schema, runtime, and ID-to-directory match are checked before display. This does not assume a Manimani agent is an itonami profile. No app-origin API, background service, network call, profile-store write, or shared-runtime fork was added.

Verification: Node tests 65/65 (including directory bounds, parent selection, remembered read permission, denial/cancel, unreadable input). The existing eight local itonami manifests were read using the same enumeration module through a filesystem adapter; a dedicated synthetic browser session displayed all eight and passed selection, bind, repeat/deduplicate, cancel preservation, and reload persistence. The browser picker itself was stubbed for this automated check; native folder-dialog permission remains a user action. Actual local inventory names/descriptions and its screenshot are retained locally, not published in this PR. Only aggregate counts are recorded here.


## Automatic existing-profile inventory (supersedes directory selection)

Owner requested no folder selection. Soshiki now requests the existing itonami inventory on entry, expands the picker, and displays returned profiles after the canonical shared runtime obtains the required fresh choice. No path/ID/folder input is needed. Refresh asks again; leaving the screen aborts the pending operation. Denial sends no catalog request. Profile binding remains browser-local and does not run a Bot or change its permissions.

A distinct read-only platform service at `https://127.0.0.1:8777/v1/itonami/profiles` reads `ITONAMI_DIR` or the default `.itonami` store, never the app origin. Babashka/.cljc projects only ID, description and skills. It excludes symlinked/oversized/invalid/mismatched manifests, ignores other files, and fails closed when the store is unavailable. The TLS wrapper rejects other origins/routes/methods/queries before reading. The declaration has one fixed GET route with no query names and no redirect approval. The existing vendor runtime is unchanged and matches its canonical pinned source; static CSP is derived from the declared service.

This host already had a trusted mkcert CA. The local runner generated only a localhost leaf certificate in that existing application certificate directory, with no CA installation, trust change or validation bypass. Credentials and actual local inventory are not published. Static preview 8902 and the separate TLS host service remain available locally. Host/native/VM/app installation is distinct from this local qualification.

Final validation:
- Node: 64/64 (the old four directory-handle tests were replaced by three broker/metadata/host-route tests).
- Existing .cljc Soshiki core: 13 tests / 87 assertions.
- New .cljc host metadata core: 2 tests / 7 assertions, including negative origin-independent filesystem cases; added to the Otehon CI job via profiles/check.nix. Nix is unavailable locally, so that derivation is left to CI.
- Default file/kiosk and HTTP release builds successful, 0 Closure warnings; upstream Garden/JVM warnings remain.
- Real headless Chrome, real trusted-TLS host endpoint, software account: automatic confirmation on entry; denial caused 0 catalog requests; approval caused exactly 1 request and displayed all 8 existing profiles. Selection/binding and reload persistence passed; reentry required a new choice, and rejecting it caused no extra request. No directory picker or endpoint stub was used, no TLS bypass flag, 390px document overflow check passed, uncaught exceptions 0.

The raw local-inventory screenshot remains local. Usage binding: AWAI-2792, base 7353ab9, run 01a1c9f2-e2ba-79c2-a37f-d5c7c348a18a. OpenAI/GPT-6 exact variant/reasoning and complete attributed input/cache-read/cache-write/output/reasoning counters remain unknown, not zero; no velocity inferred.
