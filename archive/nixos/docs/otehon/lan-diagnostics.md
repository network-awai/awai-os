# Direct LAN installer diagnostics

The diagnostic boot imports `installer-runtime.nix`, the same console and
broker as the USB installer. It is read-only: the broker accepts only LIST
and STATUS. The SSH key can collect the fixed diagnostic report, not run a
shell or forward connections. The report contains installer status, disk
inventory, broker logs and kernel warnings. It cannot recover logs lost
from a previous USB session's RAM.

## Verified candidate

On 2026-11-15 the candidate built from
`abde194a0a9b8964f3742057c7f7c09edafad3f8` passed the Mac QEMU test at
16 GiB. The 8 GiB attempt failed in the EFI stub loading the approximately
3 GB initrd (`Out of Resources`, `0x8000000000000009`). This is a tested
configuration, not a measured universal minimum. The source includes the
AWAI-2921 diagnostics merged in PR #133.

The VM proof is `docs/evidence/otehon-lan-vm-abde194-16g.json`. The test used
an isolated scratch NVMe and checked console selection refusal, host-key
matching, unauthorized-key and password refusal, authenticated reports and
forwarding refusal. Physical 6600H boot and log retrieval remain unverified.

## Prepare and serve

Build `netboot-diagnostic-6600h` with an explicit `diagnosticPublicKey`.
An empty key disables SSH. Keep the private key on the operator's machine.
The workflow produces a separately keyed candidate with `SOURCE_REVISION`
and `SHA256SUMS`. Early artifacts are unqualified.

Run `archive/nixos/scripts/check-otehon-lan-vm.py --help` for the VM arguments. Use the
actual candidate and its source revision. Preserve the output directory.
Before physical serving, `archive/nixos/scripts/otehon-lan-http.py` requires that successful
VM proof and verifies that its hashes match the candidate.

The Mac's direct Ethernet interface has address `10.77.0.1/24`. Generate the
dnsmasq configuration with `archive/nixos/scripts/otehon-lan-dhcp.py`, specifying that
interface and the complete physical PC MAC. Test the configuration with
`dnsmasq --test --conf-file=...`, then run the dedicated foreground process
with local administrator authentication. It offers `10.77.0.2` only to that
MAC, advertises HTTP Boot for HTTPClient firmware and TFTP for PXE, and
provides neither DNS nor a default gateway. Do not use a shared LAN.

Start the verified HTTP helper, retry network boot on the PC, and compare
the SSH fingerprint shown on its screen. Use
`archive/nixos/scripts/otehon-lan-diagnostics.py --help` to collect a report with that
fingerprint and the operator key. The client refuses mismatched keys and
will not overwrite an existing report. No password or private key belongs
in chat or evidence. Stop the foreground HTTP and DHCP processes after use.

The firmware HTTP/TFTP bootstrap is not Secure Boot qualification. USB
refresh, installed-OS boot and production remote access have separate gates.
