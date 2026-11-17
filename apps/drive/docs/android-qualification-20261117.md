# AWAI-3014 Android qualification — 2026-11-17

Source under test: `dc321b123bbabf0e8fff7370dfa45dbb3896e8f2`.
PR: https://github.com/network-awai/awai-os/pull/166
Tracking: https://linear.app/kotobalabs/issue/AWAI-3014

## Observed results

| Check | Result and coverage |
| --- | --- |
| Shared CLJC/CLJS and descriptor | 4 Node tests pass; canonical broker accepts memory-only descriptor, zero remote operations; JP/EN key and interpolation parity |
| Java file adapter | 24 local checks pass: bytes, reopen, duplicate/concurrent no-clobber, short/faulting source, traversal/control/symlink and size admission |
| ARM64 APK | Build and development-signature verification pass; installed and cold-started on dedicated AOSP API35 ARM64 VM |
| x86_64 APK | Cross-build and development-signature verification pass; runtime untested |
| Native document picker | Drive read-only provider appears in Android Files; actual document selection imports through native activity callback |
| Import | 1,048,595-byte deterministic fixture imported from Downloads; full readback SHA256 matches source |
| Offline UI | With VM airplane mode enabled: folder creation, UTF-8 text save, duplicate rejection and listing pass; saved 47 bytes match expected SHA256 |
| Process and OS restart | Force-stop/restart, then actual VM OS reboot with airplane mode retained; root listing and imported fixture full readback pass |
| Home integration | Unchanged Home APK discovers installed `network.awai.drive` through existing PackageManager route; VM setup remains incomplete, no authenticated Home user journey claimed |
| Layout | Actual Japanese baseline and final English VM views inspected; system bars are inset; bundled Noto Sans JP; Japanese/English strings have parity |

Imported fixture SHA256:
`19470658c44b75bca0910d467208af0be767b30df75553e8c0ac165a9bc1ba37`.
UTF-8 text SHA256:
`a5b79740acac022e087f3d199ee84b004b03e9550005134914c93d48f72d2e9d`.
Airplane mode was restored to disabled after verification. No user accounts,
private keys, unrelated emulator state or physical disks were changed.

## Development artifacts

| File | Bytes | SHA256 |
| --- | ---: | --- |
| awai-drive-0.1.0-dc321b1-arm64-debug.apk | 36593986 | c825855ccd849375f4c3224b01b41ba1f2fffc3ae17e1c240a4a5178e91b8be8 |
| awai-drive-0.1.0-dc321b1-x86_64-debug.apk | 23699539 | 2d5f77b276e117c6824a09153a5013fefadd24305089ad1d081008c748d2bebb |

Both use development signer SHA256:
`2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29`.
APK files, raw VM screenshots, readbacks and build logs remain in the task
worktree `.agent-output/`; APKs are not committed or uploaded as Actions artifacts.
Both artifacts exceed the existing Store 20 MiB ceiling. Direct authorized ADB
installation does not qualify Store enrollment; release optimization is pending.

## Handoff and open acceptance

The owner says the 6600H persistence task is still in progress. Do not install,
reboot, repartition or change that target until its task is handed back. Verify
the intended device serial, architecture, persistent userdata and existing app
signer before deployment. Do not use an unqualified all-devices ADB command.
When available, install the matching ABI with `adb -s SERIAL install -r APK`,
launch `network.awai.drive/.MainActivity`, repeat picker/save/readback and reboot
checks, and verify Home discovery without bypassing Android setup/identity.
Do not clear app data to resolve a signing mismatch: preserve local files first.

Still open: physical 6600H acceptance, x86 runtime, production signing, Store
size qualification, device Keystore/FBE recovery, real AwaiFS Pack/CAR/WNFS
storage/sync and empty-cache remote recovery. This app currently owns only an
app-private local tier. Local restart success is not remote durability or power
loss qualification. GitHub Actions was not enabled; PR checks are absent, not
passing. Keep the PR draft until review and the remaining integration scope are
resolved. Existing Nix/EFI and fleet state remain untouched.

## Measurement boundary

Run binding: AWAI-3014, chat 01a1c403-4751-72d2-84de-55853fc89649,
provider OpenAI, source revision above. Exact model/settings, attributable token
counters, cost, active/waiting durations and estimate unit are unknown. Results
above are observed acceptance checks, not a completion percentage or ETA.
