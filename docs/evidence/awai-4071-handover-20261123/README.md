# AWAI-4071 evidence — account handover (2026-11-23)

- `jvm-handover.log` — `bb -cp android/contracts/src:android/contracts/test -m itonami.store.handover-test`: 6 tests, 36 assertions, 0 failures.
- `jvm-domain.log` — pre-existing domain: 4 tests, 20 assertions, 0 failures.
- `node-otehon.log` — `node --test test/handover.test.js test/link.test.js test/device.test.js` (from `otehon/shell`): 27 pass, 0 fail.
- `node-android.log` — `node --test android/tests/handover.test.mjs android/tests/domain.test.mjs android/tests/setup.test.mjs android/tests/identity.test.mjs`: 24 pass, 0 fail.
- `walkthrough.mjs` / `walkthrough.log` — real WebCrypto walk-through: challenge creation, phone verification (device-key signature), approval-yields-no-profile assertion, sealed transfer (ciphertext contains no plaintext), new-device open, secret refusal (`forbidden-field`), unimplemented scope → `unavailable`.

Build bundles: `clojure -M:build` (CLJS domain, exposes `handoverSchema` et al.) and
`node android/build-identity.mjs android/client/generated` both succeed (regenerates
`generated/domain.js`, creates `generated/handover.js` 73 KB). Full Home APK +
emulator/device walk-through not run (no Java runtime on this host) — remains an
open gate, not claimed. See `docs/otehon/account-handover-awai4071.md`.
