# Signed latest-catalog pointer: checks (AWAI-3662, 2026-11-21)

- `python3 android/publish-latest-pointer.py --sequence 1`: signer `2507930b…`, openssl verified, 2,867 bytes, sha256 `317990b8…`.
- The committed pointer verifies (`openssl dgst -sha256 -verify`: Verified OK) against `catalog-key.der` from the Store build (`android/build.py --skip-cljs --version 1`).
- `node --test android/tests/latest-pointer.test.mjs`: 1 pass (shape and pins).
- API 35 arm64 emulator: `am instrument -w network.awai.tests/.StoreInstrumentation` printed "85 assertions passed" (`instrumentation.log`). The new pointer cases:
  - accepted cases: a valid pointer and envelope; the pinned catalog and APK bytes;
  - refused cases: the wrong key, changed bytes, a sequence rollback, an expired pointer, a lifetime over 31 days, an issue date in the future, the wrong schema, a non-integer sequence, 8 bad URLs (another host, the `main` branch, a query, a fragment, `..`, `%2e`, http, another port), an unknown app, an app over its budget, a bad digest, an oversized envelope, a digest mismatch and an unlisted app.
- Not done: a negative-control rebuild of the Store; fetching over the network (step 5); a physical device.
