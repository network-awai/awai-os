# AWAI-2794: real Muse conversation — 2026-11-12

The 8901 static preview now offers Bots → Muse with a browser-local conversation history. The selected local Muse bot service has a fixed HTTPS POST endpoint on port 8778. Every send uses the unchanged canonical shared operation broker with prompt/history categories. Denial sends nothing; leaving the view aborts the request. The local-only Manimani path remains separate and has no silent remote fallback.

The installed Muse Code 1.4.15 (1.4.15-R8339.1), meta provider, resolved to muse-spark-1.3. It uses existing Muse authentication, empty preset, low effort, max one model step, no workspace trust, no session log, shell/write/web/reminder/user-input tools disabled, and a dedicated empty workspace. The CLI requires a regular input file; each request creates an owner-only temporary prompt file and removes it in finally. Tests cover cleanup on success and failure. No credentials are copied into the browser or repository.

Validation:

- Node: 69/69, including bounded history, exact broker POST, CLI-output parsing, route denial, private regular-file input and cleanup.
- Muse conversation .cljc: 1 test / 8 assertions, including invalid/system-role/oversized/extra-field inputs.
- File/kiosk and HTTP shell/link release builds passed, 0 Closure warnings (upstream Garden/JVM warnings remain).
- Real 8901 headless Chrome, software wallet, real trusted TLS endpoint and live Muse subscription: rejecting send produced 0 requests; two approved requests returned real responses. The second recalled a fact from the first. Reload restored both exchanges without a new model call. Uncaught browser exceptions: 0. Screenshot browser.png uses only synthetic test dialogue.
- No temporary prompt files remained after those requests.
- CI adds a no-live-provider Nix check for the conversation core to the Otehon job. CI uses fixture adapters and never requires Muse credentials.

State finding: preview served 200 while Manimani 8771 was not running. JUN-1155 explicitly qualified provider configuration/gates and excluded live inference. This work verifies Muse only. Claude, ChatGPT/Codex and OpenRouter are not connected by this UI; their installed tools or accounts are not qualified by Muse's response. No profile inference rail or stored provider settings were changed. OS image/VM/native/macOS-app distribution remains separate from this local browser/host observation.

Run binding: AWAI-2794 (aca5ac18-822e-4d99-9f1d-524211c090f0), base f8da311, coding thread 01a1c9f2-e2ba-79c2-a37f-d5c7c348a18a. Provider/model/settings and usage observations are recorded on the internal issue; raw prompt/transcript event files stay local. The earlier Soshiki/profile units belong to AWAI-2792 and are not counted again here.
