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

## Quiet by design (静けさ)

Awai OS, the Awai network and Murakumo share one product principle: quiet.

- **Encrypted end to end.** Private messages, mail, private posts and files are
  encrypted on the sending device and decrypted only on the recipient's devices.
- **No advertising, no ad tracking.** The OS and its default apps show no ads,
  carry no advertising identifier and do not profile use to sell attention.
  Google Play services are not required.
- **Not identifiable to other people.** Other members see a pseudonym, and peers
  do not learn the home IP address. Accepted actions stay traceable to a
  verified responsible party through a bounded case process; this is not
  anonymity without responsibility.
- **Decentralized.** Apps run on the device with local state, Murakumo inference
  is local by default, and each external operation asks for consent first.

These are directions with evidence gates, not released guarantees. The
[public roadmap](https://awai.network/network/roadmap/#quiet-by-design-静けさ)
lists the current position and the open gates for each point.

## Status

Awai OS runs today as Android apps and system overlays on qualified test
devices, and as Android VM and live images for desktop PCs. A signed Awai OS
ROM, OTA updates and persistent PC installation are not released yet; the
platform decision lists the remaining gates.

## Repository layout

| Path | Contents |
| --- | --- |
| [`android/`](android) | Awai OS on Android: Home, Store, setup, SystemUI overlays, desktop PC work |
| [`apps/`](apps) | Existing in-tree integrations and pointers to independent app repositories |
| [`dapps/`](dapps) | Otehon dapps: D1, reward loop, Saifu, Sanka, Wellbecoming |
| [`otehon/`](otehon) | Itonami shell UI shared with Android, and Otehon fleet sources (Meiji, Bot fleet, Soshiki, storage) |
| [`packages/`](packages) | Shared Awai inference and shell packages |
| [`store/`](store), [`distribution/`](distribution) | Signed app catalog and its distribution Worker |
| [`deploy/awai-link`](deploy/awai-link) | awai.link account-link relay |
| [`ci/`](ci), [`scripts/`](scripts), [`tests/`](tests) | Checks and operator tools |
| [`docs/`](docs) | Decisions, design and dated evidence |
| [`archive/`](archive) | Deprecated material kept for history |

## Boot, build and test

**[Booting Awai OS on Android](android/BOOT.md)** lists every way to run Awai OS
today (emulator, PC LAN Live, PC NVMe persistence, phone) and what is still
missing for a real Awai OS image. Android builds, emulator and device checks are
described in [android/README.md](android/README.md) and [android/test/README.md](android/test/README.md).
Independent app repositories own their source, build, tests and releases. See
[app ownership](docs/app-ownership.md) for the active split. Source, VM, device and
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
