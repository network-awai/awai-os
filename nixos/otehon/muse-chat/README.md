# Muse conversation host (Otehon preview)

The browser's Bots → Muse view connects directly to a distinct loopback bot service at `https://127.0.0.1:8778/v1/chat/muse`. The app origin still serves static artifacts only. The canonical shared broker asks for each POST carrying the current prompt and bounded recent conversation history; denial sends no request. Browser-local state holds the conversation and is retained on reload. Long history is bounded before sending. Leaving the Muse view aborts its request.

The host runs the installed, already authenticated Muse CLI with the meta provider, the user's configured default model, an empty preset, low reasoning effort and one model step. Shell, writes, web tools, reminders and user-input tools are disabled; sandbox and normal approvals stay enabled. Workspace trust and session logging are not enabled. It uses a dedicated empty local workspace. Muse requires a regular prompt file, so each request uses an owner-only temporary directory/file that is removed in `finally`, including failed/cancelled calls. Credentials remain in Muse's own credential store; no key is copied to the browser or repository. No other provider or local model is used as fallback.

## Local preview

Requires Node, Babashka, an installed/authenticated `muse` command and an already trusted mkcert CA:

```sh
cd nixos/otehon/shell
npm run muse:host
# The static preview runs separately:
npm run preview
```

`MUSE_COMMAND` / `BB_COMMAND` can select installed executables. `MUSE_CHAT_WORKSPACE` can choose the dedicated empty workspace (default is this repository's `.agent-output/muse-chat-workspace`). Use platform-managed `MUSE_CHAT_CERT` / `MUSE_CHAT_KEY` with `node ../muse-chat/bridge.mjs` when supplying TLS directly. The helper only generates a localhost leaf certificate in mkcert's existing application directory. It never installs a trust root or bypasses TLS validation.

The live-provider service accepts only the named loopback preview origins (8901/8902); opaque `null` origins, including file pages, are rejected. File-kiosk integration requires a separately qualified trusted host path. The service has one fixed POST route, rejects other origins/routes/methods/queries, bounds body size, accepts only alternating user/assistant text messages, and handles at most one model call at once. It returns the completed Muse text/model and available per-call usage counters. There is no app-origin proxy or prompt persistence on the host. Unexpected or incomplete CLI output is an error, never a fabricated response.

## Qualification

On 2026-11-12, the installed meta provider resolved to `muse-spark-1.3`. A dedicated browser session at port 8901 received two real replies, recalled a fact from the first turn, and restored the conversation after reload; rejecting a send caused zero requests. This is local browser/host evidence, not Nix image, VM, macOS-app distribution or the native runtime qualification. The original local-only Manimani path is separate and remains unavailable while its service is stopped. Prior JUN-1155 support for muse/codex/Claude/openrouter concerned configuration and gates, not live transport. Claude, ChatGPT/Codex and OpenRouter are not connected by this view.

CI tests the bounded conversation core with Babashka and tests adapters/CLI-output parsing using fixtures; CI never invokes a live provider or requires credentials.
