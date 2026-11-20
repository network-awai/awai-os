# Supplied Murakumo logo — 2026-10-06

Runtime source: `7645df4` on the local automatic-install branch.
The user supplied `murakumo-logo-white-60mm.svg` and explicitly permitted
changing its color. Its original bytes are retained at
[`archive/nixos/murakumo-logo.svg`](../murakumo-logo.svg), SHA256
`ce8e3ae8cd9cf859d7264e26cb13a6b0690a536564754413e8794ef152d466bf`.
Only the displayed fill changes from white to navy `#253b62`; the supplied
paths and proportions are preserved. Nix renders a transparent 960×148 PNG,
and GTK downsamples it to a 240×37 header texture before layout. Its natural
size is constrained; a minimum-size request alone had allowed the first
candidate to display at 960 pixels wide. That candidate was not written to USB.

The installer and both prebuilt UEFI/BIOS installed systems include the source
SVG and the rendered PNG. The source SVG is copied into the retained Nix
configuration as well, allowing a later rebuild without the user's Downloads
folder. The former star and separately typed wordmark are removed.

35 source tests passed after asset wiring. A native GTK diagnostic run of the
final source on the first candidate ISO verified the constrained header on the
network and account-link screens at 1280×800. The QR fixture remained visible,
decoded to its exact expected URI and cancelled without linking an account.
The private approval directory was removed. These diagnostic screenshots are
labelled as fixtures; no real Wi-Fi password or phone Passkey was used.

The prior disk selection, UUID routing, offline installation and no-media boot
qualification remains recorded in
[graphical setup verification](verification-graphical-setup-2026-10-06.md).
The logo change does not alter those routines; it adds the retained asset to
configuration copying. This run does not reinstall the physical PC, link a
real account, publish production dependencies or qualify fleet inference.

The final ISO was built successfully from `7645df4` and booted normally with
no network interface. Its packaged GTK frontend displayed the supplied logo
at the correct size on the first network screen, without a diagnostic override.
The packaged frontend SHA256 matches the frozen source. Original SVG and rendered
PNG digests were checked in the live installer and both prebuilt installed systems.
Evidence is in [the logo evidence directory](../../../docs/evidence/logo-setup-2026-10-06/).

Final ISO: `murakumo-logo-setup-sized-20261006.iso`, 2,303,950,848 bytes, SHA256
`879d7f6cb51471a6f9b57c2294d780469d325e9cdcf9ee73ed1b9747c9358f8c`.
Guest and host hashes agree. The build output is
`/nix/store/7iqmj7s6p4nq7g4bs1sbaj0qis6vjiw5-nixos-minimal-26.05pre-git-x86_64-linux.iso`.

USB update remains pending: macOS listed no external physical disk during the
final check. The guarded writer request points to the final logo ISO with
action `check`; no logo candidate was written to USB. The previous USB write
and eject record therefore does not establish that the USB contains this logo.
The KIOXIA must be physically reconnected and reidentified before the authorized
repeat write, exact-byte readback and safe eject. No password change is needed.

Both task-owned build and logo-qualification VMs were shut down and their
processes were confirmed stopped. Other user VMs and apps were not closed.
