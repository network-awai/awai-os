# VM gate before release

The release gate imports the production `offline-base.nix` configuration and starts
`murakumo-account-link` with its original PATH, StateDirectory and
ProtectSystem settings. A CI wrapper runs the exact production launch command
and a probe inside that unit's own filesystem namespace. It calls the actual update and remote setup UI backends,
the systemd timer, Unix control socket and HTTPS server without mocking them.
The menu selections are scripted; this is not a real-phone Passkey test.

The real GTK screen is checked with OCR before keyboard language selection.
Checks cover update consent and private state creation, starting the declared
timer without modifying read-only unit links, native LAN address discovery,
eight-digit pairing, refusal before local approval, approved status access,
revocation, and persistence across a same-disk reboot. The update timer interval
is extended during the test to prevent production fetching. Hardware recovery
qualification stays false. Real hardware audio, Wi-Fi radio, firmware and
physical recovery remain separate qualification work.

Run on x86_64 Linux with Nix 2.34 or newer (client and daemon), sufficient space for the production closure,
at least 6 GiB available RAM, and a VM-capable builder:

```sh
pin=$(nix-instantiate --eval --strict --json ci/nixpkgs.nix | tr -d '"')
node archive/nixos/scripts/check-setup-vm.mjs "$pin"
```

`ci/nixpkgs.nix` fixes both the package commit and unpacked content hash.
CI executes on the Murakumo fleet through `murakumo-setup-vm`, requiring the
measured `:nixos-vm` capability and one concurrent job. Host-root dispatch is
refused. A runner that cannot execute the VM does not produce a passing result.

`build-iso.sh` runs this gate before building the ISO. `publish-update.mjs`
requires an additional pinned-nixpkgs argument, re-evaluates the production
target, rejects a mismatching system path, builds the VM test and verifies its
Nix output before exporting or signing. It embeds the evidence in the signed
release payload. Keychain and file-key cosigning require the same source
checkout and refuse missing or mismatching gate evidence. A caller-supplied
success flag is not accepted by the publisher.
Signing validates transported metadata; it does not independently rerun the
Linux VM on Mac. The release operator must use the gated publisher.

To prove that this gate detects these regressions, run it on two disposable
copies: remove `aiueos-update` from the UI service StateDirectory in one, and
restore the old `hostname -I` remote address discovery in the other. Both must
fail, while the original must pass. Keep their Nix logs and test outputs with
the release evidence. CD pin promotion stays disabled until the actual fleet
run has passed; a local unit-test run does not qualify it.

```sh
node archive/nixos/scripts/check-setup-vm-negative.mjs "$pin" /absolute/path/to/qa-logs
```

## User journey scores

The same proof now requires a recomputed [user journey quality scorecard](user-journey-quality.md). Four VM-covered journeys must individually score at least 95/100; unverified physical/phone/voice journeys remain explicitly unqualified. Older proofs without `journeyScore` are rejected.

## Kekkai installation SSH

Proof schema v2 additionally requires the immutable `kekkaiTestPath` output
from `archive/nixos/tests/kekkai-setup.nix`. The publisher builds that two-VM test and
checks its certificate pin, two-key local approval, account-free encrypted
SSH connection, reboot and revocation assertions. Old proofs are rejected.
The existing GUI quality score remains independently required. See
[kekkai installation SSH](kekkai-install-ssh.md) for the owner workflow and
limits of this LAN bootstrap.
The source digest covers `archive/nixos`, `scripts` and `ci`, including installer entry
points and the gate itself. Changing a script after qualification invalidates
the transported proof even if its installed system derivation stays the same.
