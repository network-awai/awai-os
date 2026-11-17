# Itonami — single Tauri v3 Otehon app (AWAI-3001)

Packages the owning `otehon/shell` UI in one Android APK, using the existing
Tauri3.0.0-alpha.6 / Wry foundation (tauri-build alpha4). Core/Apps/System,
Manimani, account/node docks and the approved composition are retained. No
second workspace UI, test identity or authenticated-session fixture is shipped.

Design baseline: https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=216-476

## Build

From the repository root, install the owning shell's locked npm dependencies;
from this directory run `npm ci`, `npm run build`, and
`npm run tauri -- android build --apk --target x86_64 --debug`.
Prerequisites match Yotei: JDK21, Android SDK37, NDK27.0.12077973, installed
x86_64-linux-android Rust target. Generated Android project is committed;
Gradle VFS watching and persistent daemons are disabled to avoid enumerating
unrelated network mounts. An Android project regeneration must preserve the
explicit npm CLI task, NDK/API pin and cleartext=false changes.

`build` compiles the owning CLJS/Garden bundle, then packages it. For an already
checked build use `npm run package:frontend`. It verifies the canonical broker
pins, preserves JS/CSS/logo bytes, and derives Android's CSP from the owning
HTML plus local Tauri IPC only. `src-tauri/tauri.android.conf.json` is generated.
The WebView origin is **https://tauri.localhost**; keep that stable across app
updates or app-private IndexedDB/localStorage will change origins. Never fix
unavailable Nix services by globally enabling mixed content or remote IPC.

## Runtime boundary

Application ID `network.itonami.app` is independent of Home/Store/Yotei. Native
capabilities expose read-only `awai_host_info` only: no filesystem, installer,
shell command or arbitrary host invocation. `withGlobalTauri` is false on
purpose: the shared shell mounts the Meiji desktop whenever `__TAURI__` exists,
but this app registers no `meiji_request` command, so advertising Tauri would
mount a desktop whose every request fails. The shell degrades to the fleet view
instead. Re-enable the global only together with a real Meiji capability probe. Existing browser operation consent
uses the exact vendored canonical Kotoba runtime revision/digests, independently
checked against its owning source. No product-local consent implementation or
silent remote inference fallback is introduced.

NixOS-local network/configuration, node/agent/inference/media services are not
ported by wrapping this UI. Their unavailable state remains explicit; the
native capability report returns false for NixOS services/local inference/host
filesystem. Connecting these services, Android network controls, peer/WNFS and
model execution remains separate AWAI-3001 work. Existing wallet/account state
is not copied from Nix, and no owner's signature is automated. A fresh app
starts the existing setup/sign-in flow.

## Observed development delivery — 2026-11-16

x86_64 APK0.1.0/versionCode1000, minSdk35/targetSdk37, Tauri3 alpha6 built;
Android debug signer SHA256
`2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29`.
APK bytes32644749, SHA256
`09e92086e6b5edde9c91804a4fc30b6c980299cd64d4924a2f1c65e74e9da5cb`
(`withGlobalTauri` false; rebuilt 2026-11-16).
This development build is32644749bytes: inside the shared 64MiB artifact
ceiling and the host per-app budget, so bundled Store enrollment carries it
as an offline asset; browser-pin online delivery stays capped at 20MiB and
cannot carry it. It was installed directly by explicitly targeted ADB for UI
evidence, and is enrolled in the rev101 Store catalog for host-verified
installs. No production publisher signing or release qualification is
claimed. APK source is the committed `apps/itonami` tree plus the recorded
shell build; provenance guards (clean tree, fresh dist, empty-dest copy)
run on every package.

Actual Awai Android Live desktop(API37, Ryzen7 7735HS) accepted the single APK
and launched `network.itonami.app/.MainActivity`. The existing Welcome/Hello UI
rendered at1920×1200. Native IPC/read-only capability and restart evidence are
recorded separately as they become verified. Owner authentication and complete
Nix service parity are not inferred from a rendered welcome screen. The OS is
RAM-only; its system notification/user handoff covers loss on OS reboot.

## AOSP setup continuation — 2026-11-17

AWAI-3004 packages Android entry at sign-in, without replaying Hello, locale or NixOS network steps. Home owns the ordinary-app setup flow and delegates actual locale/PIN to Android Settings; this is not privileged SetupWizard/ROM integration. Home and Itonami retain separate WebView identity stores, so a verified Home link is not silently copied into Itonami.

The rebuilt ARM64 API35 VM and x86_64 Live physical app both visibly start at サインイン and report the same embedded source manifest. Physical update preserves the previous package identity, `https://tauri.localhost` origin and app data. Development version remains0.1.0/code1000; exact APK hashes and the source revision are recorded in [the setup qualification record](../../android/setup-qualification-20261117.md). Authenticated Itonami desktop acceptance, profile sync and persistent physical Android storage remain separate.
