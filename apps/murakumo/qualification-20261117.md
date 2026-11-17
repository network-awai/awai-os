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
