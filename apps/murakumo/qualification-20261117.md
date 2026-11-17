# AWAI-3011: Android llama.cpp Otehon qualification

Figma252:3 /255:58 in umqCqP5KSjLWh9fhCI1HaN. This is a separate Otehon app; no native Murakumo, GPU, image/video or physical-device qualification.

Observed on the task's independent arm64 AOSP API35 VM (`emulator-5570`):

- Official Qwen3 0.6B Q8_0 at the source revision/digest in pins.json was downloaded as a development fixture. Actual639,446,688bytes matched the independent Hugging Face LFS SHA256. This is not a product download workflow.
- Android's real document picker selected the GGUF; app-owned streaming import/digest admission completed. The model loaded through the actual llama.cpp JNI library, not a fixture reply or a remote server.
- A real UI-generated request, `Write one short sentence saying hello.`, returned **Hello!**. The app observed loaded CPU readiness before submission and actual completion afterward. Exact native timing/token counters were not captured in this first run; unknown is not zero.
- After the UI Release operation, readiness returned to un-loaded. One process-memory sample per state: TOTAL PSS745,823KiB loaded versus120,994KiB released, and TOTAL RSS897,080KiB versus267,244KiB. These are process snapshots on this virtualized ARM configuration, not a universal model memory cost, physical6600H measurement, native benchmark or latency claim.
- All four compiled-CLJC/SDK tests passed, including UTF-8 byte bounds, unsupported modality before native invocation, request/result binding, output/engine alteration, denial and absent-host refusal. Existing link/device/trust regression suite24 tests passed separately; totals are overlapping coverage, not a completion percentage.
- Advanced owning-shell CLJS/Garden build passed after integrating the scoped Android view and exact vendored SDK. No Native/Otehon fallback was introduced.
- The ARM64 JNI libraries built with the installed NDK27 pin; inspected ELF LOAD segments have16KiB alignment. The actual VM has4KiB pages, so this is not16KiB-device runtime acceptance. Built APK permission inspection found no INTERNET permission.

The subsequent CPU abort callback/deadline and Activity-result/read-only provider source still require their final candidate tests. Itonami transport and authenticated UI, denied caller/confirmation, corruption, cancellation, current APK artifact readback, x86_64 build, phone lifecycle, user-facing model download and Gaka/Dougaka consumers remain separately tracked. 6600H is exclusively held by AWAI-2992's persistence chat; no additional physical ADB/install/settings/reboot is authorized in this chat while it holds the device. Nix/NVMe/EFI and Moto are preserved.

Binding: AWAI-3011 / chat01a1e3f0-1dde-7af3-a093-2a8257f6eb56 / worktree codex/awai-3011-android-inference, base68aab3c. Provider/model runtime settings for the test are llama.cpp CPU/four threads and the pinned Qwen artifact; agent provider/model/settings, issue sizing unit, attributable tokens/cost and active/wait time remain unknown. Do not allocate shared session usage or infer Native maturity from these results.

## Subsequent native boundary and consumer evidence

The actual installed Itonami ARM64 app invokes its scoped Tauri command and Android client plugin. The provider readiness readback reports the pinned Qwen model with `loaded=false` after Release, separately from installation. A fresh native dialog identifies **Itonami からの生成** and the public fixture prompt.

- Canceling this dialog returns rejection to the real Itonami WebView, with no text result.
- After the provider's actual UI Load, another request displays a new confirmation. Accepting it returns `awai.inference.result.v1`, the same request UUID, `modality=text`, `engine=llama.cpp`, the generated sentence **Hello! How can I assist you today?** and a native **9 output-token** counter. This is the local llama.cpp output count for this fixture, not agent API/billing usage. Model input/reasoning counters remain unknown.
- These transport tests were issued diagnostically from Itonami's **sign-in WebView**. No account state was fabricated or copied. They prove the real app-to-app path, not authenticated Core-view acceptance. That recurring owner request was withdrawn. The unattended software-account Core UI test below now covers this view without real owner credentials; real phone/hardware acceptance remains separate.
- The unprivileged Android shell is denied both the exported generation Activity and read-only provider. A separate wrong-signer/allowed-name adversarial APK was not exercised.
- A public long-generation fixture received cancellation and its original request rejected; one observed bridge interval was649ms, including a50ms test delay. CPU abort callback/deadline now stops work inside decoding; this one sample is not a cancellation latency benchmark.
- The real file picker selected a21-byte invalid GGUF. Native admission rejected it and the previously admitted model retained its exact SHA256. This exercises the size rejection path; same-size corruption remains a distinct unrun case.
- Source archive/tree verification now compares every extracted engine file against the admitted archive, rejecting additions or missing files. `--verify-only` passed; a task-owned extra-file negative control was rejected before compilation and then removed.
- The ARM64 and x86_64 provider APKs build. The x86_64 artifact was not installed on6600H because of the persistence hold. Initial private artifact manifest: ARM64 provider37,961,037bytes/SHA256 `4c73b2f2114a0e31bb234ade715bd388aa05bddd179c760f82c3e2ec591df32e`; x86_64 provider40,491,416bytes/SHA256 `d6c477850b6bd9e7458790ad3b98b390fd8b273d11358711ac0cadff3a382cc7`; ARM64 Itonami consumer30,761,274bytes/SHA256 `ba8d9fb94b9c974d18915c773f955e8ce9e6d0e2adb859db0913656e02e4d910`. Candidates remain development-signed/version0.1.0/code1000; distinguish by exact hashes. Later artifacts require their own updated manifest.

A review fix snapshots the output-token counter before releasing the per-request busy reservation, so another request cannot reset the counter before the UI result is delivered. Android's scoped dapp details now describe the llama.cpp app path instead of showing the retained Native catalog's micro-bigram description; the canonical Native catalog is unchanged. Whole-shell/source checks are rerun; the subsequent unattended Core UI run below qualifies only its software-account scenario, not creative-app consumers or owner-phone linkage.

Current review: draft [PR164](https://github.com/network-awai/awai-os/pull/164), stacked on setup PR160. Repository Actions remains disabled; no remote CI pass/merge/physical acceptance is claimed.


## Unattended signed-account Core UI regression

Owner requested removal of repeated human authentication from regression on 2026-11-17.
`android/test/run-auth-emulator.mjs` now creates a new explicitly owned disposable
AOSP API35 arm64 AVD, installs the unchanged app APKs, and uses newly generated
software wallet/passkey fixtures through the production verifier. No test auth
flag, signing key or account-acceptance endpoint is packaged. The real relay and
owner-linked VM/device are not used; physical6600H exclusivity remains intact.

At source `c9f340a321b5a0b1990b0dd6e93d7db422513d20`, the complete unattended run
passed **12/12 cases**, including invalid-signature/device/expiry/origin/UV refusal,
valid wallet/software-passkey signatures, actual Trust/Finish/Home clicks,
background6.5s/process-restart proof revalidation, actual Core Murakumo form,
per-request native denial followed by fresh acceptance, real llama.cpp output
**Hello!** (6 UTF-8 bytes), and actual provider UI Release. This output is generated,
not the unit test's native-JSON fixture. The run has no measured inference token
counter or inference latency; its timestamps measure the whole test execution.
The final UI screenshot was visually inspected and shows the preserved shell,
Core Murakumo panel and Hello! result.

The public pinned model is seeded into this disposable provider's private storage;
normal native Load still admits its digest. This automation does not claim SAF
import/download, physical WebAuthn/phone transport, OS PIN, or physical reboot
coverage. Those retain their separate acceptance records.

This E2E exposed advanced-compiler property renaming of `modality`, `maxTokens` and
`installed` on native JSON. Native-boundary externs fix the packaged UI. The
compiled `test:inference` check fails before these externs and passes afterward;
source-only SDK tests had missed this boundary. Existing identity/trust plus
emulator-scope source tests31 pass separately. The rebuilt owning shell and
ARM64 APK pass; compiled checks do not depend on owner login.

Qualified ARM64 Itonami candidate:30,761,402bytes, SHA256
`e11f6ba3e80499acdf19d4ae5a349d134d7a21c813cca5fbf4e1402af62becb2`.
Provider/model retain the earlier exact pins. Private full-run evidence is
`.agent-output/qa-1794884319030/report.json` and `inference.png`; reports bind
source hashes, APK/model digests, scope, per-case outcomes and timestamps.

Immediate process force-stop after completion twice reproduced loss of the new
setup-completion marker while the verified account proof survived. It is recorded
under AWAI-3004 and reproducible with `--restart=abrupt`; it is not a passing
power-loss test. Normal background/restart is explicitly a different case.
Actions remains owner-disabled; no CI, merge, physical deployment or owner
acceptance is inferred from these local results.

The corrected x86_64 consumer APK also builds: 32703807bytes, SHA256 `d440a47c8b08b0338117949b03ac4ea97c58fa2be71b3bf0a723fd902488f36f`. It is not installed or runtime-qualified on6600H; that hold remains.
