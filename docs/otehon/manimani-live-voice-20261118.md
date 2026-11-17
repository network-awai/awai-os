# Manimani: normal Android Agent, persistent images and local speech

2026-11-18 JST. Tracking: AWAI-2794, AWAI-3107 (child of2927), AWAI-3108
(child of258). This is normal-package acceptance on the handed-off x86_64
Android37 PC, not a signed ROM/OTA, ARM-phone or owner-account qualification.

## Observed behavior

| Boundary | Evidence and limit |
| --- | --- |
| Normal Itonami → Agent | Real HTTPS/h2 directory797 available Bots, named conversation, actual pinned Muse1.3 response and Agent-owned history. No fetch interception or substitute executor. |
| Authentication | A separate diagnostic wallet signed the normal UI challenge and passed unchanged verification. No owner passkey, private key or account proof was copied. Owner identity acceptance remains separate. |
| Images | Normal Murakumo native512px generation, Agent mixed text/image metadata and Gallery save with exact PNG byte/SHA readback. Image bytes remain on the generating device. |
| Persistent image models | All3 pinned files,6565132376bytes, verified as normal Murakumo UID from persistent storage. Idempotent provisioner transferred0 files. Two actual OS reboots retained account/history/images and protected GPT/ESP/closed-LUKS witnesses. Fresh generation after persistent reboot produced229083-byte PNG, exact Gallery SHA and authoritative history. |
| Native speech | Publisher-pinned sherpa-onnx2.0.1, Japanese SenseVoice and Supertonic3. Actual TTS→ASR in memory recognized the fixed public test phrase; actual AudioRecord capture and AudioTrack playback APIs executed. |
| Voice transport | One fresh canonical approval for selected Bot/session, fixed production WSS,180seconds/12turns. Normal UI reached101 and scoped Agent readback; Stop closed the socket/native audio and stopped its owned Muse process. |
| Complete synthetic chain | Operator entry invoking the exact source adapters inside the normal app: local public TTS→ASR→actual selected Bot/Muse→Agent readback→native playback. This is synthetic audio, not an intended human microphone utterance. |
| Native negatives | Same-length1-byte actual model-file defect refused; exact original restored, positive begin succeeds. Wrong-session and expired-token operations refused. Quiet capture returned96127 real samples and no recognized/forwarded text after the brief-transient correction (one observation). |
| Native deadline | Without caller Stop, active at150.24s and inactive at180.38s; expired operation refused. UI stop/background guards remain independent. |

The voice is sequential listen/respond/playback, not full-duplex or measured
barge-in. The full recognized text and reply are displayed; playback is bounded
to512characters for long replies. Raw microphone audio is transient and is not
sent, saved or put in telemetry. Recognized text is sent only inside the approved
connection and becomes ordinary Agent conversation history.

A separate public speaker stimulus was not correctly recognized by the analogue
microphone path. A read-only ALSA control query subsequently reported
`Mic Jack present=0`; the ALC269VC codec identifies that input as an external
right-side jack. Android's generic microphone advertisement and permission are
not evidence of a connected microphone. No mixer/control setting was changed. Intended human speech, acoustic audibility, noise robustness,
other hardware and general Murakumo CLI/gateway acceptance remain open under
AWAI-258. A model's reassuring reply is not evidence of those properties.

## Runtime operations and performance

The existing Tailscale Serve8443 route was reapplied to the same private8912
Agent service. The physical app uses a managed, exact-peer Ethernet TLS CONNECT
transport; it still verifies the actual service certificate and uses the
original Tailscale identity. Android17 LAN permission, process-local Ethernet
binding and the canonical browser broker remain separate. General host DNS
repair is not claimed.

Agent sources are installed in a verified immutable runtime using
`otehon/bot-chat/install-runtime.mjs`; credentials, profile rails, identity
custody, encrypted stores and inference settings stay in their original homes.
The dialogue LaunchAgent needs `ProcessType=Interactive`: the installed primary
`launchd.plist` manual documents CPU/I/O throttling for the default type and
reserves Interactive for user-facing responsiveness. This applies only to the
foreground dialogue service, not the Bot fleet or unrelated services.

For the same seven messages and storage basis, one observed authenticated
history call fell from36.611s to1.736s after changing only that scheduling key.
Direct independent reads were0.48–0.56s. These are individual before/after
observations, not a throughput guarantee. No integrity check was bypassed and
no database cache or storage-engine change was introduced.

The successful synthetic-chain Muse process took10012ms: one selected final
run reported20753 input,0 cached and346 output tokens, with309 reasoning tokens
inside output. Do not add subsets. Its operator chain took about32s including
local inference and approvals. A separate stopped run had no terminal usage;
its consumption remains unknown, not zero. Coding-agent tokens, monetary cost,
active/wait split and issue estimate unit are unknown.

## Validation and preservation

Owning shell116 tests, backend18 regression/protocol tests plus an owned
TERM-ignoring-descendant cancellation test, advanced CLJS release, actual Android
Kotlin/native APK builds and the normal signer/installed-APK byte readbacks
passed. The JVM1.12.6 pure-policy run is a separate local reference oracle;
neither it nor these Otehon dependencies qualify Kotoba/Amu Native.

Editable Figma voice states reuse the existing Awai components and shell
composition. Physical screenshots and private structured readbacks distinguish
normal UI checks, operator synthetic-chain checks and unverified acoustic scope.
Raw prompts, credentials, private checkpoints and complete logs are not published.

Approved old-Nix retirement followed the existing encrypted-preservation,
quarantine and actual-reboot runbook. Unique encrypted checkpoints and task
evidence are preserved. Full OS restoration, hardware-backed custody/FBE,
private-mail enrollment recovery and unrelated fleet services are not qualified
by this work. Do not remove the task worktree while it owns those checkpoints.
