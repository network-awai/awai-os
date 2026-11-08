# Awai Otehon base 0.4.0

The first implementation stage of AIUEOS Otehon
(`docs/aiueos-otehon.md` in `network-awai/network-awai-apex`, AWAI-160). It adds
encrypted state, secrets, a closed firewall, and boot generations that can be
rolled back.

| Part | Component | File |
| --- | --- | --- |
| Encrypted state | LUKS volume at `/var/lib/otehon`, formatted on first boot | `nixos/otehon/state.nix`, imported by `base-module.nix` |
| Secrets | sops-nix with an age key kept on the encrypted volume | `nixos/otehon/base-module.nix` |
| Firewall | nftables, inbound closed by default | `nixos/otehon/base-module.nix` |
| Generations | systemd-boot entries, Nix database registered on first boot | `nixos/otehon/base-module.nix` |
| Check image | Fixture secret, test listeners, update and rollback sequence | `nixos/otehon/base.nix` |

The keys in `nixos/otehon/fixtures/` are for local check VMs only. They open only
the fixture secret. `base.nix` is a check image, not a release: it has no login
credentials, SSH or Hermes Agent, and it is not an Itonami OS release or a complete
Awai Node.

The root partition is not encrypted. It holds the public system closure, the Nix
database and system logs. Private data belongs in the state volume.

## Build

Follow [vm-0.1.0.md](vm-0.1.0.md) and add `--argstr profile base` to `nix-build`.

## Check

The check changes the image, so run it on a copy.

```bash
nixos/otehon/base-make-key-disk.sh nixos/otehon/fixtures/test-age.key keys.tar
```

```bash
cp otehon-base.qcow2 check.qcow2
```

```bash
nixos/otehon/base-check-qemu.sh check.qcow2 keys.tar serial.log
```

Exit codes: `0` every check passed, `1` a check failed, `3` the check could not run.

One QEMU run goes through these steps:

1. First boot formats the state volume, writes a canary to it, and switches to generation b.
2. The second boot must report generation b and the same canary, then rolls back.
3. The third boot must report generation a and the same canary, then powers off.
4. The Mac reads a banner from the allowed port and nothing from the closed port.
5. The Mac searches the whole disk. It must find a canary written to the root
   partition and must not find the canary written to the state volume.

Generation b is a specialisation stored in the image, so the update does not come
over a network.

## Evidence (2026-11-07, Apple M1 Max, QEMU 10.0.3 with HVF)

| Item | Result |
| --- | --- |
| nixpkgs | `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7` |
| sops-nix | `89a234ce2daf6e568a7d4b4fe250afdd23d84e20` |
| Raw image SHA-256 | `4854ddb6fbb2644af17483f8af5ce63042cd92e1040ef6890323c2944c716b0e` |
| Check | Generations a, b, a with the same canary, `failed=0` on each boot, exit 0 |
| Firewall | `allowed=open closed=dropped` |
| Disk search | `plain_canary=found encrypted_canary=absent` |

| Negative control | Result | Exit |
| --- | --- | --- |
| Another LUKS key on the used disk | `state=0`, `No key available with this passphrase.` | 1 |
| No key disk on the used disk | `state=0`, `otehon-state: no key disk` | 1 |
| Wrong age key on a new disk | `state=1 sops=0 failed=1` | 1 |
| `base-open-port` profile | `FAIL closed port reachable` | 1 |
| `base-no-switch` profile | `FAIL stage 1 expected generation b` | 1 |

The report lines are in
[otehon-base-20261107.txt](../evidence/otehon-base-20261107.txt).

## Known gaps

- The key disk is a test stand-in. TPM2, a passphrase, key rotation and key recovery
  are not implemented.
- `nixos/network-update.nix` is not used. It asserts `services.murakumoNative.enable`,
  so it needs work before it can serve Otehon. Network delivery of an update, a
  one-shot trial, and automatic rollback after a failed boot are not implemented.
- The refusal to format a partition that already holds data was not exercised.
- The volume was not reopened with the right key after the wrong-key boot.
- Secure Boot, a reproducing second build, x86_64, physical hardware and a CI image
  build are not verified.
- The desktop uses the state volume (`state.nix`, see [protection-0.1.0.md](protection-0.1.0.md)),
  but not sops-nix, the nftables firewall or the generation check from this module.
