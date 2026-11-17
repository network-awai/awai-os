# Voice setup qualification — 2026-10-07

Frozen runtime source: `481cd28` (initial implementation `3d186d1`). Product naming: AiueOS operating system; Awai Node service.

## Verified locally

- 59 Node tests pass, including stale screen/model response refusal, deduplication, model action bounds, local password spelling, fresh serial-bound erasure consent, VAD and audio-control consent invalidation.
- Actual GTK4/GJS frontend with VoiceControl and a dedicated installer-backend fixture completes Japanese language selection, Wi-Fi choice, secret input, serial-bound confirmation and Continue. `actualDiskErased=false`; this is a binding/flow test, not a physical disk installation.
- Official whisper.cpp 1.8.4 with immutable `ggml-small.bin` recognizes the Japanese PCM fixture. Actual Qwen3 1.7B Q8_0 selects Wi-Fi, smartphone-free local completion and English wired networking. It distinguishes unlinked status from an explicit linked-status fixture. Five final cases took 9507ms on Mac native CPU, two threads; this is a combined test duration, not a per-turn speed guarantee.
- Japanese OpenJTalk synthesizes the actual model reply as an unprivileged user in the network-disconnected x86_64 VM. The earlier 1.7B/base-model runtime package built offline from cached dependencies; this does not establish an offline build of the final small-model ISO. Final image creation can fetch immutable build dependencies. Target-PC installation is a separate offline check.
- BIOS and UEFI retained install configurations parse and evaluate. Source retention includes all voice modules and license notices.

## Negative findings and limits

Qwen3 0.6B incorrectly selected an operation when asked a status question; it is not the default. The 1.7B model passed the corresponding actual-model test. x86_64 inference under Mac TCG emulation was too slow for conversation qualification; the real dialogue test uses native Mac CPU and the same pinned model/runtime version. No claim of physical target-PC latency follows from that result.

This version is half duplex. It suppresses its own speech/BGM while listening; full duplex and acoustic echo cancellation are not qualified. Physical microphone/speaker, actual Wi-Fi hardware and a real phone Passkey ceremony remain separate acceptance gates. Speaking a command, QR or FSK decoding, and speaker similarity cannot establish account ownership. The real registration server must authenticate the owner and issue the signed bound receipt.

## Restartable evidence

Evidence directory: `/Users/junkawasaki/github/murakumo-usb-auto-install-qa/`.

- `voice-native-small-result.json`: actual final recognition and dialogue.
- `voice-ui-result.json`, `voice-ui-audio-final.log`: real GTK/controller fixture flow with fresh per-run transport and results.
- `voice-final-package.log`: offline runtime build.
- `voice-final-eval.log`: BIOS/UEFI evaluation.
- `voice-reply-tts.log`, `voice-ai-reply.wav`: actual model reply synthesized offline.
- `voice-iso-481cd28-build.log`: final frozen-source ISO build; completion must be checked before using the image.

No USB overwrite or physical disk operation has been performed for this voice candidate. Old prototype ISOs were preserved. App/Worker production release remains a separate reviewed change.

## ASR controls follow-up

Actual Whisper base misrecognized short Japanese secret characters and both tested serial-confirmation phrases. It is not the shipping recognizer. Immutable official Whisper small (487601967 bytes, SHA256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`) correctly recognized language selection, `小文字のBを入力`, `数字の7を入力`, `入力完了` and `番号1234のディスクを消してインストール`. The actual recognizer fed VoiceControl; secret `b7` reached only the fixture callback and the serial-bound erase callback targeted `/dev/voice-fixture`. No disk was erased. Empty secret completion is refused. Evidence: `voice-asr-controls-small-result.json`, `voice-asr-controls-small.log`.

The service now creates both UI and voice runtime directories through systemd. The root-owned voice parent permits traversal (0711); each private session remains0700 and owned by the unprivileged runtime. This avoids the installed service's strict filesystem protection preventing startup or the runtime from reading its own0600 model key/audio.

The first full ISO build without network failed because system dependencies were not all cached. Package creation is permitted to fetch trusted immutable build dependencies; offline installation is qualified separately. No image from that failed build was distributed.

Final small-model dialogue run passed all five cases in9507ms. Actual English small-model recognition also passed `lowercase B`, `digit seven`, `done` and the exact serial-bound erase phrase. Named symbols and NATO letters are parsed locally; sentence punctuation cannot silently add password characters. Physical microphone=false and actualDiskErased=false.

The protected runtime-directory test passed under actual systemd with `ProtectSystem=strict`, `NoNewPrivileges=yes`, a0700 session and a0600 file read as the dedicated unprivileged voice user. The updated GTK flow passed again. Selected results are committed under `docs/evidence/voice-setup-2026-10-07/`.

## Acoustic playback coordination

The real GTK approval view now sends playback state to the voice agent. Recognition pauses while BGM/FSK plays, pending erase consent is cleared, and listening-state notifications cannot terminate the code player. A new native GTK test sends the existing public FSK code by voice, injects the listening notification immediately after player startup, and verifies the player completes before returning. The code generator/QR renderer are real; the one-second player is an explicit fixture, not a physical speaker. Results: `voice-ui-playback-final.log` and the committed `voice-ui-result.json`. Each run now uses unique result/transport paths so old files cannot establish success.

The native GTK voice action produced real QR PNG and16000Hz FSK WAV. Independent macOS Vision QR decoding and the acoustic decoder both returned `https://murakumo.cloud/portal/#device-link?code=ABCD123456`. This is a fixture public code, not a live approval.

Final playback binding tests also confirm requested BGM is allowed to finish. Only the initial startup BGM is stopped when dialogue becomes ready; manual BGM and FSK use the shared playback pause/resume protocol. Initial automatic language detection recognized Japanese and English correctly and selected both languages through the real controller. Evidence: `voice-ui-audio-final.log`, committed `voice-auto-language-result.json`.

The real llama.cpp server was also tested with the actual per-session key configuration: public health200, missing-key inference401, authorized bounded Wi-Fi choice passed. The test uses only an ephemeral local key, never an account credential. Evidence: committed `voice-model-key-result.json`.

## Final media and offline installation

Frozen runtime `481cd28` built successfully (`VOICE_ISO_BUILD_EXIT=0`). The image is `aiueos-voice-setup-481cd28.iso`, 5248696320 bytes, SHA256 `647d77202af5f05fab9b4dad6e712a492a7d1f4ca99e0c296274e67a9aee3fb1`; Mac and build-VM hashing agree. Image creation fetched immutable build dependencies.

The actual image cold-booted with UEFI into the GTK language screen. A new, task-owned 32GiB NVMe image (`AIUEOS-VOICE-QA`) was installed with `-nic none`, without an initial password prompt. The installer displayed completion and logged `installation finished!`. This test uses keyboard/pointer fallback; it is not a physical voice-only installation. The VM has no microphone. A subsequent boot from the same virtual NVMe, without the ISO and still with `-nic none`, is checked separately below.

The task-owned builder was stopped after completion. To retain enough space for this test, only already-free blocks in its labelled virtual filesystem were trimmed; no files or old prototype ISOs were deleted. No real disk was changed.

The same NVMe cold-booted without the ISO and without a NIC. Local setup completed, with no phone, account or Internet. Retained voice/UI/language/account sources match `481cd28`. The actual voice service is active under `ProtectSystem=strict` and `NoNewPrivileges=yes`; its parent is root-owned0711, session0700 and model key0600 owned by the unprivileged runtime. Actual local model health returned200. There is no physical network interface or default IPv4/IPv6 route. The expected Tailscale virtual interface remains present; the first proof script incorrectly required loopback alone, and its failed result is preserved. The corrected proof checks actual device attachment and routes rather than calling a virtual interface Internet connectivity.

Evidence: committed `voice-installed-proof.json`, `voice-installed-proof.log`, the initial proof failure, proof script/expected hashes and `aiueos-voice-local-complete.png`. `localSetupExists=true`, `publicAccountReceiptExists=false`, `physicalMicrophone=false`, `realPasskey=false`. This does not establish account linking, fleet admission, inference or rewards on a physical PC.

Final KIOXIA check returned no external physical media, so this candidate was not written to USB. Production voice/registration release is pending explicit authorization; the read-only public sound-page check still returned404. The draft review artifacts are installer#4, app#38 and Worker#274.

QEMU's actual HDA output captured 96.19 seconds of non-silent PCM during media setup (including startup sound and generated speech). This verifies virtual audio output, not physical speaker quality. Evidence: `voice-vm-audio-metadata.json` and `voice-vm-audio-levels.log`. Task-owned build/media/installed VMs and native model/registration fixture processes are no longer running; other user VMs and applications were not closed.
