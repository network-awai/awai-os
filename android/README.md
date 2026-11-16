# Awai Home and Itonami Store — Otehon Android host

Implementation of Figma native UX v2 for LineageOS, with a shared browser UI/domain suitable for NixOS. This is a development build, separate from the Native selfhost profile.

- `network.awai.home`: reversible Android HOME-role launcher, real installed-app drawer/launch, clock, local agenda projection and system-settings entry.
- `network.awai.store`: signed bundled catalog, library/update state, independent native confirmation, bounded APK digest/package/version/signer checks and Android PackageInstaller user action.
- `network.itonami.yotei`: actual bundled calendar application; shared browser UI and local event model, persistent local storage, signature-permission protected read-only agenda projection. No sync, remote inference or notification scheduling is claimed.
- All three hosts have no INTERNET permission. No ROM, SystemUI, Keyguard or existing launcher is replaced/uninstalled.
- Browser UI/state/domain use local JavaScript and compiled shared `.cljc`; Java contains platform operations and an independent installer trust boundary. Browser consent never grants host install authority.
- Canonical Kotoba runtime is copied unchanged from the existing revision/digest-pinned source bundle. Empty external operations, strict CSP, fixed local asset origin, no arbitrary file/content URLs or remote navigation.
- Catalog signatures use the local Android debug identity for this development build. This is not a production publisher/key-rotation release.

## Build

Installed macOS SDK prerequisites: platform37.0, build-tools36.1.0, OpenJDK27.0.1, Clojure CLI1.12.5.1654. The shared compiler dependencies are pinned in `client/deps.edn` (Clojure1.12.1/ClojureScript1.12.145). Local Babashka1.12.218 tests are additional evidence, not a fallback.

```sh
bb -cp android/contracts/src:android/contracts/test -m itonami.store.domain-test
cd android/client
clojure -M:build
cd ../..
node --test android/tests/domain.test.mjs
python3 android/build.py --version 1 --skip-cljs
python3 android/build-tests.py --version 1
```

Build outputs, signed APKs, public fingerprint/digests and tool logs stay in `.agent-output/android`. The existing debug key stays in Android's credential directory and is never copied to source or reports. `build.py` never connects to or installs on a device.

The build generates tokens/CSS/resources from one shared palette, compiles shared domain functions once for both browser clients, and packages original Figma assets. Raw SVG dimensions are retained:24px controls,28px Store header source and64px featured calendar source. API-supplied installed app icons remain dynamic. Design-time Aozora/Murakumo/Itonami placeholders are not advertised as installable without actual release artifacts.

The launcher remains an ordinary app. Before default-HOME selection, record the previous component/role. Use Android's role selection UI to opt in; keep the existing launcher installed as rollback. Never assume adb selects the right phone: all device commands require an explicit serial.

## Qualification boundary

Initial source unit:4 shared tests/20 assertions,3 compiled-browser tests, APK compilation/signature verification and instrumentation APK compilation. On-device integrity, UI, app acquisition/update/restart and NixOS packaging evidence are subsequent units; source/build alone do not prove these.

The first Store is deliberately **bundled/offline**, not an online marketplace. Google Play compatibility remains AWAI-2978/2981. Remote catalogs, production key rotation/revocation, anti-rollback release policy and NixOS platform installers remain planned, not silently delegated to a native host or app-origin backend.

Sources: [v2 home](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=194-2439), [v2 Store](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=194-2956), [Android HOME role](https://developer.android.com/reference/android/app/role/RoleManager), [PackageInstaller](https://developer.android.com/reference/android/content/pm/PackageInstaller). Figma high-fidelity context/screenshot was used; React/Tailwind output was translated to the existing Otehon browser approach. Available Compose-only icon mappings are not applicable to this browser client; exact exported SVG/image assets are used instead.

Tracking: [AWAI-2977](https://linear.app/kotobalabs/issue/AWAI-2977), parent[AWAI-2975](https://linear.app/kotobalabs/issue/AWAI-2975). Issue/run binding: chat01a1e187-0e12-7813-b500-73aa77f2a03e, branch codex/awai-2977-android-store-device-20261116, base3a0e46a. Forecast/estimate units/attributed counters/cost/active-wait are unknown; current session-context model gpt-6.1-sol/medium is not complete billing telemetry.

## Shared NixOS client

`export-web.py` copies the exact build's browser UI, compiled domain, signed catalog and pinned runtime without Android APK payloads. See [`nixos/otehon/itonami-store/README.md`](../nixos/otehon/itonami-store/README.md) for the opt-in static NixOS module and digest checks. This is a bundled browser-app path; native Nix/Waydroid installers remain separate work.
