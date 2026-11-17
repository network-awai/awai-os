# Encrypted Drive VM qualification — 2026-11-17

Tracking: https://linear.app/kotobalabs/issue/AWAI-3014
PR: https://github.com/network-awai/awai-os/pull/166
Source of final VM build: `177d093ad10a9c351b9f99f5d94cd94e9f5fcd29`.
Build override: `AWAI_DRIVE_SYNC_ORIGIN=https://localhost:18463`, with an
uncommitted debug-only localhost CA overlay. Development signer SHA256:
`2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29`.
Final ARM64 VM APK:36,572,309 bytes, SHA256
`9bb2c5dc2359fdc63ededf9aecd8e6a538c2680be568f6d4156f744b24c37ca1`.
The endpoint-pinned configuration differs from the default/no-endpoint build;
this is not a physical-device/Store/release APK.

## Observed checks

| Check | Observed outcome |
| --- | --- |
| Compiled CLJC/browser tests | 7 Node tests pass: path, permissions/read-only provider, canonical descriptor, JP/EN, exact HTTPS scope, encrypted CAR bytes/negative inputs, oversized/stalled/failing response streams |
| Java file adapter | 27 checks pass: bounded copy, bytes/SHA, reopen, no-clobber/concurrent writers, short/faulting source, name/path/symlink and size/depth admission |
| Independent compatibility | Browser-generated262121-byte encrypted CAR restored by separately run owning owner-store CLI; exact original bytes; unlock passed by fd3 only |
| HTTPS sync | UI -> canonical trusted consent -> PUT -> receipt -> separate fresh GET approval -> full SHA readback -> protected receipt commit |
| Denial | Real trusted Deny input causes zero PUT/GET/OPTIONS counter change |
| Upload503 | Injected failure leaves original inventory and every hash unchanged; no sync acceptance/eviction authority |
| Unsynced data | Additional UI-created folder/file causes eviction refusal; complete current inventory/hash retained |
| Interrupted write | Injected `.pending-interrupted-3014.part` blocks eviction; exact bytes retained, then only the test-owned fixture is removed |
| Offline/process restart | Airplane mode plus removed transport forwarding; cached listing/bytes and device-protected synced receipt survive force-stop/relaunch |
| Empty cache and OS reboot | UI evicts only fully synced copies; actual VM OS reboot retains key/control/root with empty file cache |
| Missing/corrupt/truncated GET | Each refuses with empty published cache; no old-root fallback |
| Disconnected restore | Actual connection refusal after removing forwarding, not merely airplane-mode indication; no plaintext publication |
| Complete restore | Reconnection retrieves encrypted CAR, verifies/decrypts then publishes all7 files/5 directories,1,048,835 bytes with exact pre-eviction path/size/SHA inventory |
| Final review regression | Updated endpoint-bound receipt and bounded staging candidate repeats sync/evict/restore with exact inventory/hash equality |

Wrong unlock, wrong root, altered and truncated CAR, unsafe path and encrypted
empty-directory metadata are covered by the compiled browser test. The VM
scenario uses synthetic data only. Owner account enrollment is not simulated.
The original user's data, keys, other emulators, Nix/EFI and6600H are untouched.

The original candidate had two defects caught before publication: an import
ordering error and object-key-order inventory comparisons across Java/Rust.
Both were fixed and the successful checks above were rerun. An initially early
post-boot automation click did not start restore; it is not counted as an offline
refusal. That refusal was rerun against a ready UI with transport disconnected.

## UI scope

Figma proposal259:1506 retains initial Drive Android composition and reusable
Android v2 button/font/color assets. Actual app remains within that structure,
adding explicit sync/restore and confirmed eviction controls. The canonical
trusted consent dialog is reused unchanged, including its English disclosures.
Locale/key parity is automated; actual AOSP per-app locale and phone/tablet
renders are retained in task evidence. Full authenticated Home onboarding and
physical input/visual acceptance remain separate; no credentials were copied.

## Reproduce without touching physical devices

1. Use a dedicated API35 AOSP ARM64 emulator with a distinct AVD/data directory.
   Confirm `adb -s SERIAL shell getprop ro.kernel.qemu` is1 before any mutation.
   Do not use bare `adb -e`/`adb -d` when other devices are attached.
2. Build this app with JDK21/SDK37/NDK27.0.12077973 and the documented dependency
   pins. Run `npm run build`, `npm test`, and the Java checks in README. For this
   fixture set `AWAI_DRIVE_SYNC_ORIGIN=https://localhost:18463` at build time.
3. Generate a short-lived localhost test certificate/key in a new private task
   evidence directory. Add its public CA only to an ignored Android `src/debug`
   trust overlay scoped to localhost. Never add it to release/main trust stores.
4. Start `node apps/drive/test/pack-server.mjs NEW_PEER_ROOT KEY_PATH CERT_PATH`.
   It listens only on host127.0.0.1:18463. Forward only the owned emulator's
   `tcp:18463` to host`tcp:18463`; install the matching ARM64 development APK.
5. Use actual Drive UI and trusted Allow once/Deny inputs. Compare complete
   inventories/hashes, stop the app, reboot the owned VM, evict synced copies,
   disconnect forwarding, then reconnect and restore. The fixture's `fault.txt`
   supports `write-failure`, `missing`, `corrupt`, `truncated` and empty/normal.
   Keep private control/Keystore; clearing app data is not an empty-cache test.
6. Restore emulator locale, display and connectivity settings; stop only the
   owned fixture/emulator. Preserve evidence and original user files.

## Coverage limits and handoff

- VM peer is an independent process on the same Mac, not an independent machine,
  OS-cache-loss, real power-loss or independent failure-domain retention proof.
- This is bounded8 MiB owner-store/CAR integration, not WNFS certification,
  streamed large-file sync, shared access/revocation, GC/repair or global fencing.
- Android Keystore behavior was exercised on a software emulator. Hardware/FBE,
  owner/Passkey enrollment and recovery after losing the device key are unproven.
- Production authenticated storage service deployment, production signing,
  Store artifact ceiling and x86 runtime remain separate. Source supports a
  build-pinned endpoint; default artifacts fail closed with no remote operations.
- Physical6600H application is explicitly held by the owner. Do not install or
  reboot that target as a side effect of merging or reviewing this PR.
- GitHub Actions is disabled; no hosted CI run/check is claimed. Local/VM
  results are exact candidate evidence. No GitHub artifact storage was added.

Unique APKs, screenshots, synthetic readbacks and logs remain in the task's
`.agent-output/`; open/dirty/evidence-bearing worktrees are preserved. Agent
handoff needs the merged source, build endpoint, admitted storage service,
matching signer and explicit target acceptance before any physical deployment.

Measurement binding: AWAI-3014 / chat01a1c403-4751-72d2-84de-55853fc89649;
provider OpenAI. Exact model/settings, attributable tokens/cost, active/waiting
time and estimate unit remain unknown. Linear comments provide milestone
clock times; those are not model execution time, velocity or percent complete.
