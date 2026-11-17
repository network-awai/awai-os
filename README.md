# Awai OS

Awai OS is the operating system of the Awai network for phones and desktop PCs.
It is built on Android AOSP. The current release is **Awai OS Meiji**
([`release.json`](release.json)).

- [Platform decision](docs/otehon/aosp-platform-decision-20261117.md): what AOSP
  owns, what Awai adds, and the gates before a production release.
- [Android implementation](android/README.md): Awai Home, Itonami Store and
  Yotei, first-run setup, and the [desktop PC architecture](android/desktop/aosp-architecture.md).
- [Shared setup design](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=241-3)
  in Figma, and the [UI design rules](docs/design/interface-principles.md).

## Status

Awai OS runs today as Android apps and system overlays on qualified test
devices, and as Android VM and live images for desktop PCs. A signed Awai OS
ROM, OTA updates and persistent PC installation are not released yet; the
platform decision lists the remaining gates.

## Repository layout

| Path | Contents |
| --- | --- |
| [`android/`](android) | Awai OS on Android: Home, Store, setup, SystemUI overlays, desktop PC work |
| [`apps/`](apps) | Bundled apps: Itonami, Murakumo (local inference), Drive, Yotei |
| [`dapps/`](dapps) | Otehon dapps: D1, reward loop, Saifu, Sanka, Wellbecoming |
| [`otehon/`](otehon) | Itonami shell UI shared with Android, and Otehon fleet sources (Meiji, Bot fleet, Soshiki, storage) |
| [`packages/`](packages) | Shared Awai inference and shell packages |
| [`store/`](store), [`distribution/`](distribution) | Signed app catalog and its distribution Worker |
| [`deploy/awai-link`](deploy/awai-link) | awai.link account-link relay |
| [`ci/`](ci), [`scripts/`](scripts), [`tests/`](tests) | Checks and operator tools |
| [`docs/`](docs) | Decisions, design and dated evidence |
| [`archive/`](archive) | Deprecated material kept for history |

## Build and test

Android builds, emulator and device checks are described in
[android/README.md](android/README.md) and [android/test/README.md](android/test/README.md).
Each app documents its own build in its directory. Source, VM, device and
release evidence are recorded separately; a passing build is not a released
device image.

## Deprecated

The NixOS desktop install route and Otehon NixOS profiles, the Murakumo NixOS
installer, the native NixOS preview and the old Awai Node setup are deprecated. They are kept in
[`archive/nixos/`](archive/nixos/README.md) for history and are not an Awai OS
install path. Device cleanup of the old NixOS installation follows the
[deprecation runbook](docs/otehon/nixos-route-deprecation-20261117.md).

## For agents

See [AGENTS.md](AGENTS.md).

## License

[Apache License 2.0](LICENSE).
