# Itonami — single Tauri v3 Otehon app (AWAI-3001)

Packages the owning `nixos/otehon/shell` UI in one Android APK, using the existing
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
shell command or arbitrary host invocation. Existing browser operation consent
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
APK bytes32685869, SHA256
`673fcaffafbf63dc6e6c927039a414a28dc6292e624cbb5a3bf399ca1f2c697f`.
This development build is32685869bytes and does not meet the current20MiB Store
artifact ceiling; it was installed directly by explicitly targeted ADB, not
Store enrollment. No production publisher signing or release qualification is
claimed. APK source base c7f1008 plus the recorded task source changes; dirty
state at build time is explicit in local evidence.

Actual Awai Android Live desktop(API37, Ryzen7 7735HS) accepted the single APK
and launched `network.itonami.app/.MainActivity`. The existing Welcome/Hello UI
rendered at1920×1200. Native IPC/read-only capability and restart evidence are
recorded separately as they become verified. Owner authentication and complete
Nix service parity are not inferred from a rendered welcome screen. The OS is
RAM-only; its system notification/user handoff covers loss on OS reboot.
