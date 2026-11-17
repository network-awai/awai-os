# Itonami GMS / Store core — P0

Independent **Itonami device services**, with an Android compatibility adapter planned alongside the common Store. This is the Otehon edition, separate from the selfhost native profile. The name does not assert Google certification, a Google license or complete Google Play Services compatibility.

Implemented here: pure `.cljc` artifact selection and version-bound observation reporting, offline local-file integrity inspection, and an opt-in NixOS module source. This is **not yet a functioning app store, Google API implementation, Android service APK, installer or background service**.

## Run locally

```sh
cd otehon/itonami-gms
bb -cp src:test -m itonami.gms.test-runner
bb -cp src -m itonami.gms.cli contract
bb -cp src -m itonami.gms.cli plan catalog.edn network.itonami.yotei android android arm64-v8a
bb -cp src -m itonami.gms.cli verify EXPECTED_LOWERCASE_SHA256 LOCAL_FILE
```

The shipped catalog is intentionally empty and expired; the plan command returns `expired-catalog` / exit1. Tests use explicitly fictional fixtures. Plan success exits0 but means only `plan-only`; errors exit1/2. No command contacts a service, installs a package, executes catalog text or persists an approval. `verify` proves bytes match the supplied digest, **not** that this digest came from a trusted publisher.

Catalog format: `itonami.store.v1`, revision, epoch-seconds expiry and apps. Each app has a unique ID, version, publisher label, required-API keywords and artifacts. Each artifact specifies an exact platform/runtime/ABI tuple, format, HTTPS source, immutable revision label, lowercase SHA-256 and byte count. Revision labels are planning data; immutable source availability is not independently verified by the planner. Signed catalog authentication, download size limits, anti-rollback, publisher revocation and actual APK/Nix signatures are P1 requirements. APK splits, multiple versions/channel selection and OS/API-level constraints need explicit schema extensions; do not infer them from version text.

Supported *planning targets* (not runtime qualification):

| Platform | Runtime | ABI | Artifact |
| --- | --- | --- | --- |
| Android | android | arm64-v8a, armeabi-v7a, x86_64 | apk |
| NixOS | native | aarch64, x86_64 | nix-archive |
| NixOS | waydroid | arm64-v8a, x86_64 | apk |

Waydroid target selection must use the **container** ABI, not infer support from host architecture. A `nix-archive` is a transport artifact, not an APK or a trusted Nix store path; importing a closure still requires the platform's own signature/trust policy. No native ARM translation or Google fallback is selected.

`evidence-status` matches all of platform/runtime/ABI, OS build, adapter version, app ID/version and test case ID. Missing observations are `not-tested`, disagreements are `conflicting-reports`, malformed reports fail validation. `reported-pass` means an imported report said pass; it is not authenticated evidence, permission or a Play Integrity token. The consumer must independently authenticate evidence and decide freshness/acceptance policy. The core does not roll partial API results into a whole-app compatibility verdict.

## NixOS packaging

```nix
{
  imports = [ ./itonami-gms/module.nix ]; # adjust relative path to this checkout
  otehon.itonami-gms.enable = true;
}
```

Default is disabled. Enabling adds the `itonami-gms` CLI and an empty expired catalog under `/etc/itonami-gms/catalog.edn`. It creates no listener, daemon, Google package, Waydroid container or account. This module is not automatically imported into existing profiles. Native D-Bus/portal and Android Binder adapters remain P2–P4 work.

Build/check with the repository-pinned nixpkgs (no mutable channel):

```sh
nix-build otehon/itonami-gms/check.nix
nix-build archive/nixos/otehon/itonami-gms/module-check.nix
nix-build otehon/itonami-gms/package.nix
```

No Nix binary is available on the authoring Mac: Nix evaluation/build/VM claims remain open until CI evidence is available. Local test runtime was Babashka1.12.218; the Nix package uses this repository's pinned nixpkgs Babashka. Independent Otehon CI job `itonami-gms-core` checks the core, module and CLI package. No Native runtime or Java/Gradle gate was changed. The `.cljc` source is intended for shared JVM/JS use; ClojureScript/Android compilation is not yet tested.

## Approval and service boundary

This is selection/reporting code, not a new consent broker. Browser UI must use the canonical `kotoba.app.client-runtime.v1` broker from Kotoba; no approval can be minted by catalog data or these functions. Native adapters require their own host identity/capability boundary and must not treat browser approval as authorization to execute commands. Fetching the catalog, fetching an artifact, installing it, synchronizing data and using remote inference are distinct operations. Existing third-party Android applications may contact their own services directly; an Itonami API adapter alone cannot enforce the browser broker on arbitrary APK traffic. Network isolation and compatible consent behavior need platform qualification.

See [architecture, roadmap and sources](../../docs/otehon/itonami-gms-plan-20261116.md).
