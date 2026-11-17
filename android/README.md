# Awai Home and Itonami Store — Otehon Android host

Implementation of Figma native UX v2 for Awai OS on Android AOSP, with a shared browser UI/domain. Device bring-up may reuse upstream community device trees; the product is presented only as Awai OS. This is a development build, separate from the Native selfhost profile.

To run Awai OS on an emulator, a PC or a phone, start with [BOOT.md](BOOT.md).

- `network.awai.home`: reversible Android HOME-role launcher, real installed-app drawer/launch, clock, local agenda projection and system-settings entry.
- `network.awai.store`: signed bundled catalog, library/update state, independent native confirmation, bounded APK digest/package/version/signer checks and Android PackageInstaller user action.
- `network.itonami.yotei`: actual bundled calendar application; shared browser UI and local event model, persistent local storage, signature-permission protected read-only agenda projection. No sync, remote inference or notification scheduling is claimed.
- `network.itonami.torihiki`: Torihiki devnet viewer listed in the bundled Store catalog (not preinstalled). Read-only: three fixed GET routes (`/head`, `/market?id=1`, `/book?market=1&depth=15`) on one devnet node, each through the canonical broker with its own each-operation consent; the host allows only those URLs and the page CSP only that origin. No keys, orders, faucet or real assets (orders stay in AWAI-491). The live node is a single sequencer with unbacked devnet collateral and currently lists only market 1.
- Home has INTERNET permission for the fixed Awai account-link relay route. Store has INTERNET only in its explicit online build; Yotei remains offline. No ROM, SystemUI, Keyguard or existing launcher is replaced/uninstalled.
- Browser UI/state/domain use local JavaScript and compiled shared `.cljc`; Java contains platform operations and an independent installer trust boundary. Browser consent never grants host install authority.
- Canonical Kotoba runtime is copied unchanged from the existing revision/digest-pinned source bundle. Home declares one bounded relay GET with fresh operation consent; offline Store/Yotei declare no external operations. Strict CSP and the native request filter retain the fixed local asset origin and reject arbitrary file/content URLs or remote navigation.
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

Account linking also requires the owning shell’s lockfile-pinned npm dependencies: run `npm ci` inside `otehon/shell` before building. `android/build-identity.mjs` bundles the existing awai.link.v1 verifier, device-key custody and QR renderer; the canonical runtime stays an external, digest-checked module. `--home-only` builds Home without rebuilding Store/Yotei.

Build outputs, signed APKs, public fingerprint/digests and tool logs stay in `.agent-output/android`. The existing debug key stays in Android's credential directory and is never copied to source or reports. `build.py` never connects to or installs on a device.

The build generates tokens/CSS/resources from one shared palette, compiles shared domain functions once for both browser clients, and packages original Figma assets. Raw SVG dimensions are retained:24px controls,28px Store header source and64px featured calendar source. API-supplied installed app icons remain dynamic. Design-time Aozora/Murakumo/Itonami placeholders are not advertised as installable without actual release artifacts.

The launcher remains an ordinary app. Before default-HOME selection, record the previous component/role. Use Android's role selection UI to opt in; keep the existing launcher installed as rollback. Never assume adb selects the right phone: all device commands require an explicit serial.

## Qualification boundary

Initial source unit:4 shared tests/20 assertions,3 compiled-browser tests, APK compilation/signature verification and instrumentation APK compilation. On-device integrity, UI, app acquisition/update/restart and NixOS packaging evidence are subsequent units; source/build alone do not prove these.

The first Store is deliberately **bundled/offline**, not an online marketplace. Google Play compatibility remains AWAI-2978/2981. Remote catalogs, production key rotation/revocation, anti-rollback release policy and NixOS platform installers remain planned, not silently delegated to a native host or app-origin backend.

Sources: [v2 home](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=194-2439), [v2 Store](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=194-2956), [Android HOME role](https://developer.android.com/reference/android/app/role/RoleManager), [PackageInstaller](https://developer.android.com/reference/android/content/pm/PackageInstaller). Figma high-fidelity context/screenshot was used; React/Tailwind output was translated to the existing Otehon browser approach. Available Compose-only icon mappings are not applicable to this browser client; exact exported SVG/image assets are used instead.

Tracking: [AWAI-2977](https://linear.app/kotobalabs/issue/AWAI-2977), parent[AWAI-2975](https://linear.app/kotobalabs/issue/AWAI-2975). Issue/run binding: chat01a1e187-0e12-7813-b500-73aa77f2a03e, branch codex/awai-2977-android-store-device-20261116, base3a0e46a. Forecast/estimate units/attributed counters/cost/active-wait are unknown; current session-context model gpt-6.1-sol/medium is not complete billing telemetry.

## Shared browser client

`export-web.py` copies the exact build's browser UI, compiled domain, signed catalog and pinned runtime without Android APK payloads. [`otehon/itonami-store/README.md`](../otehon/itonami-store/README.md) describes its static Nix module for the existing Otehon hosts and its digest checks. The NixOS desktop install route is deprecated and archived; this export is not an Awai OS install path.

## Explicit online development build

Store is offline by default. Home’s separately declared account-link relay is available in either build. `python3 android/build.py --version 5 --skip-cljs --online-pins android/online-pins.dev.json` includes a fixed immutable catalog/APK source and additionally grants INTERNET to Store. The canonical runtime broker handles each real browser download, with exact paths, no credentials/referrer, no redirects, byte bounds and expected digest. Browser signature/expiry/revision verification is followed by independent Android catalog/identity verification and OS install confirmation. Denial sends no request; an app/bot must not synthesize the trusted user's approval.

The public development payload is under `store/distribution/dev-20261116` at commit `2cbd32f31b3053fd148e04dda25cbfd8e2f0b726`. Pins are immutable and must not be changed to `main` or an arbitrary URL. The signed catalog is revision100 and expires30 days after packaging. No production key rotation/revocation or automatic mutable latest channel is claimed. Browser-state and host-state failures remain visible; cached signed APKs can be installed offline with fresh native/OS confirmation.

`node --test android/tests/domain.test.mjs android/tests/online.test.mjs` checks compiled domain behavior, exact URL scope, signature alteration, metadata expiry and revision floor. Build/runtime/online/NixOS evidence remain separate. See `docs/otehon/itonami-store-shared-install-sync-20261116.md` for the common auth/permission/sync recommendation and current native-Nix/sync boundaries.

## Android setup and account linking

Home follows the existing Figma Android setup composition. Android Settings owns the actual language, networking and screen lock; Awai never receives the PIN. The account step uses the existing `awai.link.v1` phone/wallet/Passkey protocol through `https://relay.awai.network/<32-hex-topic>/json`. Each attempt requires the canonical broker’s direct user consent before its GET; native filtering and CSP independently restrict the route. No approval or private key is imported from a fixture.

A saved signed link is reverified for expiry, device binding and the non-exportable device key’s possession before it can restore an authenticated account. The native setup preference is only a flow marker, not an identity credential. Invalid or missing proof returns to account linking while retaining saved evidence. Explicit account deferral remains available. Home’s WebView and Itonami’s WebView have separate stores: shared sign-in, encrypted profile transfer and sync are not implemented by this change.

See [the qualification record](setup-qualification-20261117.md) for current VM, real-account and physical-device gates. An ordinary Home APK is not privileged SetupWizard integration or a qualified persistent PC ROM.
