# Awai Shell common host API v1 (Otehon)

`awai.shell.host.v1` is the application-facing contract. Tauri v3 is the native carrier; Web uses the same UI and local-state adapter. It is separate from Kotoba/Amu Native and does not replace the canonical `kotoba.app.client-runtime.v1` broker.

- `initialize()` verifies native protocol identity; never silently downgrade a detected native host to Web.
- `info()` returns app ID, runtime and explicit capabilities. Unsupported notification/sync/install operations stay false. `peerSnapshots` is true only when the native host explicitly advertises `awai.shell.peer.v1`; this indicates availability, not consent or automatic synchronization.
- `read()` returns `{schema, revision, data}`. Revision zero means no state; invalid stored bytes are preserved and refused.
- `write({expectedRevision,data})` is bounded to 128KiB UTF-8, app-scoped, and serialized through Web Locks. Mismatched revisions fail with `state-conflict`; absent locks refuse writes. Browser/WebView user-state remains local.
- `legacyAgenda()` reads the preserved old Android snapshot; the UI must validate it and obtain an explicit local import choice. No automatic reset or merge.
- `projectAgenda(events)` updates only the app-private Android projection exposed through a signature-protected provider. It grants no account, network or installer capability.
- Other operations fail with `unsupported-operation`.

Native adapters never accept arbitrary paths, commands or URLs. API availability is not user approval. External operations remain empty in Yotei; any future service calls must use the exact pinned canonical operation broker and fresh endpoint/operation-specific consent. Tauri ACL is an additional host boundary, never a replacement for that approval.

Persistence scope is application ID plus WebView/browser origin. Web and Android do not implicitly share state. Backups preserve event IDs; imports merge only after confirmation, keep current entries on ID collision, enforce 200 events, and never erase the source. A failed HOME projection is reported separately from successful app-state storage.
