# Account handover (AWAI-4071)

Tracking: [AWAI-4071](https://linear.app/kotobalabs/issue/AWAI-4071) (priority 3 of
the user's 2,3,1 order, 2026-11-23). Concretizes
[AWAI-3004](https://linear.app/kotobalabs/issue/AWAI-3004) /
[docs/otehon/android-shared-setup.md](android-shared-setup.md)
("Existing iOS/Android Awai users should approve adding this device from their
phone. A proposed short-lived challenge binds the new device public key,
device name, expiry and selected profile/data scope. QR or cross-device Passkey
authentication does not itself copy a profile or private credential." and the
registration gates in `android/setup-qualification-20261117.md`: "Home/Itonami
identity-store synchronization and profile-data transfer remain open.").

Started after AWAI-4070's worker queue (AWAI-4070 was Backlog at dispatch;
no branch/PR existed). Branch `awai-4071-account-handover`, PR created, not
merged. Scope AWAI/KOTOBA only.

## What this change implements

Protocol data structures + client signing (non-exportable P-256) +
verification paths, as a catalog-of-code along the existing canonical broker
(`kotoba.app.client-runtime.v1` / `awai.link.v1`):

- `android/contracts/src/itonami/store/handover.cljc` — pure domain.
  `schema="awai.handover.v1"`. Short-lived challenge shape (device `did:key`,
  device name ≤64 chars, `nonce` 24-hex, `topic` 32-hex, ephemeral `ek`,
  `exp`, selected `scope` vector). `transfer-status`: `:ready` only when every
  requested scope has a provider wired in this build
  (`profile:settings`, `profile:home-state`); otherwise `:unavailable`
  (caller must offer defer — never a fabricated restored state).
  `verify-challenge` covers wrong-device, expiry, scope-subset,
  revocation, cancellation, and phone-loss recovery (fresh challenge + old
  device in `revoked`). `forbidden-keys-present?` refuses seed / mnemonic /
  PIN / password / private-key fields outright: there is no "copy owner
  authentication" path. `handover-next-status` maps unimplemented scopes to
  `:unavailable`, never `:completed`.
- `otehon/shell/src/identity/handover.js` — browser implementation.
  `createHandoverChallenge` verifies the device pair is a non-exportable
  P-256 ECDSA key holding the claimed DID (same checks as
  `device.js:verifyDeviceKeyPair`), performs a possession probe, creates a
  fresh ephemeral ECDH key for the transfer envelope, and signs the
  canonical challenge text
  `awai.handover.v1\n<device>\n<name>\n<exp>\n<scope>\n<nonce>\n<topic>\n<ek>`.
  `sealProfileTransfer` / `openProfileTransfer` use ECDH P-256 + HKDF +
  AES-GCM (same construction as `link.js:sealResponse` /
  `openResponse`), rejected with `forbidden-field` when the payload
  carries a credential field, and with `cannot-decrypt` for any other
  device. Verifying the challenge alone yields no profile
  (`{device, deviceName, scope, status}` only) — proving QR/Passkey
  approval does not itself copy a profile.
- `android/home/src/network/awai/home/HandoverKeys.java` — AndroidKeyStore
  mirror (same pattern as `android/sanka/.../MainActivity.java`):
  non-exportable P-256 `secp256r1` key, `sign(bytes)`, `spki()`, and
  `hardwareBacked()` via `KeyInfo.isInsideSecureHardware()` (reports
  `false` when the device cannot answer; never claims hardware custody
  unobserved, per AWAI-3004). Native custody is a separate alias
  `awai.handover.device`; the browser `device.js` / `deviceDid()` custody
  remains the WebCrypto non-exportable path.
- `android/client/handover-entry.js` — broker bundle entry (mirrors
  `identity-entry.js`): creates the challenge, invokes
  `awai-handover/awai-relay/await-handover-approval` through the canonical
  broker with `each-operation` consent, renders QR + confirmation code, and
  reads the sealed envelope from the same topic. When the selected scope is
  unimplemented the entry reports `unavailable` before any relay read,
  so the UI offers defer rather than faking a transfer.
- `otehon/shell/src/runtime.js` — `awai-handover` operations added to
  both `osOperations` and `phoneOperations` (`/v1/:topic/json` GET and
  `/v1/:topic` POST), sharing `RELAY_DISCLOSURE` with the existing
  `awai-link` relay operations.
- `android/build-identity.mjs` + `android/build.py` — bundle `handover.js`
  alongside `identity.js` and copy it into the Home APK assets.
- `android/client/src/itonami/store/bridge.cljs` — exposes the domain to
  the compiled browser bundle (`validChallenge`, `verifyChallenge`,
  `transferStatus`, `handoverNextStatus`, `validEnvelope`,
  `forbiddenKeysPresent`, `handoverDescriptor`).
- `android/client/setup.js` — explicit copy after a verified signature:
  "QR・パスキー承認だけではプロフィールや認証情報はコピーされません…"
  / "QR / Passkey approval alone does not copy a profile or credentials…"
  No behavior change: `Next` still cannot manufacture enrollment; deferred
  account still completes only with a device lock.

Relay (`deploy/awai-link/relay/worker.js`) is unchanged: it still carries
only ciphertext under a random 32-hex topic (GET `/:topic/json`,
POST `/:topic`, 4 KiB / 8 messages / 10-minute TTL). Handover topics follow
the `/v1/:topic` contract used by `osOperations` / `phoneOperations` and resolve
to the same Worker routes.

## Explicit non-goals / truthful deferral

- No seed, device PIN, wallet private key, or owner-authentication material
  is ever copied (domain `forbidden-keys-present?` + JS `hasForbiddenKey`
  reject at seal time; sealed payload is never logged).
- `profile:wnfs-snapshot` and `profile:yotei-events` report
  `unavailable`/`deferred` in this build: the Home web store and Itonami's
  data store are still separate (see `android/README.md`: "Home's WebView and
  Itonami's WebView have separate stores"). The setup UI already says
  "データ同期は別に設定 / configure sync separately"; this change adds the
  missing handover doc so the defer is named, not silent.
- Cross-device Passkey enrolment is not created by handover:
  `existingPasskeyOnly` purposes (`awai.drive.device-authorize.v1`,
  `itonami.bot-launch.v1`) still require an already-enrolled Passkey
  (`link.js:passkeyForLink`). Handover never enrols a new Passkey by itself.
- Phone-loss recovery is a fresh challenge with a new device key; the lost
  device's DID must be in the revocation set. This verifier reports
  `:revoked` for the lost device and evaluates the fresh device
  independently — it never copies material from the lost device.
- Hardware-backed custody is reported by `HandoverKeys.hardwareBacked()`
  and must be checked on the actual PC/phone before being claimed. No
  device was measured for this change; no hardware claim is made.

## Verification (QA evidence)

- JVM: `bb -cp android/contracts/src:android/contracts/test -m
  itonami.store.handover-test` — **6 tests, 36 assertions, 0 failures**.
  Domain tests still pass (20 assertions).
- Otehon shell (WebCrypto, real non-exportable keys):
  `node --test test/handover.test.js test/link.test.js test/device.test.js`
  (from `otehon/shell`) — **27 pass, 0 fail** (handover 6 + link/device 21).
- Compiled domain (CLJS → `android/client/generated/domain.js`):
  `clojure -M:build` succeeds; `node --test android/tests/handover.test.mjs
  android/tests/domain.test.mjs android/tests/setup.test.mjs
  android/tests/identity.test.mjs` — **24 pass, 0 fail** (handover 6 +
  pre-existing 18). The CLJS `good-text?`/status portability fixes are
  covered because the same cases run on both runtimes.
- Bundle: `node android/build-identity.mjs android/client/generated`
  succeeds; `generated/handover.js` (73 KB) and `generated/domain.js`
  regenerated from the new bridge. `android/build.py` now also copies
  `handover.js` into Home assets.
- Not built in this session: full Home APK + emulator/device walk-through
  (no Android SDK Java runtime on this host: `java -version` fails).
  The APK `build.py` path is exercised only as far as the JS bundles
  above; APK signing/install, VM screen operation, and real-account
  phone-approval acceptance remain open gates and are not claimed.
  Evidence package: `docs/evidence/awai-4071-handover-20261123/`.

## Files

New: `android/contracts/src/itonami/store/handover.cljc`,
`android/contracts/test/itonami/store/handover_test.clj`,
`otehon/shell/src/identity/handover.js`,
`otehon/shell/test/handover.test.js`,
`android/client/handover-entry.js`, `android/tests/handover.test.mjs`,
`android/home/src/network/awai/home/HandoverKeys.java`,
`android/client/generated/handover.js` (build output),
this doc, evidence package.
Modified: `android/client/src/itonami/store/bridge.cljs`,
`android/client/generated/domain.js` (regenerated),
`otehon/shell/src/runtime.js`, `android/build-identity.mjs`,
`android/build.py`, `android/client/setup.js` (truthful copy only).

## Remaining gates

1. Full Home APK build + disposable-emulator walk-through (account step
   through to empty `done`).
2. Real iOS/Android phone approval against `relay.awai.network` with the
   dedicated handover topic; capture the confirmation code match and the
   sealed-envelope open; verify cancellation/bridged defer in the UI.
3. Physical-device (6600H / Moto) handover acceptance, OS-reboot
   persistence, and hardware-backed custody readback per device.
4. Per-scope providers for `profile:wnfs-snapshot` / `profile:yotei-events`
   (Home↔Itonami store sync) before those scopes can report `ready`.
