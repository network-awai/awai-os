# Manimani voice transport

A foreground voice session is one fresh, canonical `each-operation` approval
for the fixed WSS endpoint `/v1/bot-chat/voice`, a selected registered Bot and
an existing named session. The connection ends after 180 seconds or 12 turns.
It grants no HTTP operation, other Bot, URL, provider, tool or subsequent
connection. Denial creates no socket. Closing, backgrounding or expiry stops
local capture/playback and closes the connection, aborting only its owned
inference process group. An uncertain turn is never automatically resubmitted.

The browser performs workflows and holds transient voice state. SenseVoice ASR
and Supertonic3 TTS execute locally through `packages/awai-speech`; only
recognized text crosses the approved connection. Raw audio is not persisted or
sent. The selected Itonami Agent remains authoritative for text history and
uses its existing pinned Muse model and tool-free invocation. Tailscale Serve's
original owner identity, exact Origin and loopback peer are checked before
upgrade. The service never accepts a client-provided owner in a frame.

`src/itonami_chat/voice.cljc` owns scope, request, duplicate and turn admission.
`voice-transport.mjs` is the bounded socket/HTTP adapter; it reuses the existing
Agent database and turn handler. HTTP and voice share the same active-scope lock.
`vendor/ws-source.json` binds the MIT upstream ws 8.23.0 source file bytes;
startup verifies all 17 files, and optional native add-ons are disabled.

The experience is sequential listen/respond/playback, with an uncalibrated
energy-based endpoint detector. It is not full-duplex speech-to-speech. The
complete recognized text and response appear in the conversation; long replies
are displayed in full while playback is bounded to the first 512 characters.
Physical microphone, playback, latency and cancellation measurements are
separate from synthetic in-memory TTS-to-ASR probes and transport fixture tests.
