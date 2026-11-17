# Awai local speech adapter

Shared Android platform operations for local Japanese speech recognition and
synthesis. The browser owns the conversation workflow and its transcript.
Audio stays on the device. Sending recognized text to a selected Agent remains
a separate canonical, freshly approved external operation; a microphone grant
does not approve that request. This is turn-taking speech, not a full-duplex
speech-to-speech model or a silent replacement of the selected Agent provider.

The pinned Otehon engine is [sherpa-onnx 2.0.1](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v2.0.1).
`prepare.mjs` verifies the publisher's release artifact byte length and SHA-256.
This dependency is not Kotoba/Amu Native qualification. The AAR supports x86_64
and ARM Android; actual hardware measurements are recorded separately.

The fixed model set is SenseVoice multilingual int8 (2024-07-17) and Supertonic3
int8 (2026-05-11). Model weights are separate operator-provisioned assets, never
downloaded or substituted during an inference request. `pins.json` records
individual model bytes as well as the publisher archive identities.

Sources and license boundaries:

- [SenseVoice original model](https://github.com/FunAudioLLM/SenseVoice),
  [converted release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models).
  The model release points to the FunASR model-license terms; engine and model
  licenses must not be treated as interchangeable.
- [Supertonic3 original](https://huggingface.co/Supertone/supertonic-3),
  [converted release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models).
  Its README distinguishes MIT sample code from OpenRAIL-M model terms.
- Android 17 microphone and local-network permissions are OS permissions.
  They do not authenticate an Awai account or authorize remote inference.

Raw audio is transient memory. A voice session is bounded to three minutes,
stops capture/playback on exit or backgrounding, and does not log transcripts.
Missing models, digest mismatch, microphone denial and cancellation must remain
visible failures. No Web Speech, cloud ASR, VOICEVOX or substitute provider is
used as a fallback.

## Input availability is separate from permission

`status` reports both `microphoneGranted` and `microphoneAvailable`. Capture uses
a concrete OS-enumerated physical input, sets it as the preferred AudioRecord
device and checks the actual route. A virtual/submix input is not a microphone.
Availability is checked again before and after recognition.

For a prototype whose generic built-in advertisement does not represent a
connected microphone, approved device provisioning can install app-private
`speech-input-policy.json`:

```json
{"schema":"awai.local-audio-policy.v1","capture":"external-input-only"}
```

This policy only narrows capture to OS-enumerated external inputs. It grants no
OS permission, identity, provider or remote operation. Malformed policy refuses
capture. It contains no endpoint or credentials. The UI disables voice start
and offers a local connection recheck when no input is available; text/image
conversation remains usable. Do not remove the restriction to make a failed
hardware test green. Synthetic model probes do not qualify a physical input.
