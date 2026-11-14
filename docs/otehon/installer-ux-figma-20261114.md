# Awai install process — UI/UX handoff

[Editable Figma design](https://www.figma.com/design/EFljF3PXOrrVNM2v9Wdis1?node-id=4-31)
/ [NixOS installer gallery](https://www.figma.com/design/EFljF3PXOrrVNM2v9Wdis1?node-id=7-240)
/ [First boot and support gallery](https://www.figma.com/design/EFljF3PXOrrVNM2v9Wdis1?node-id=7-1008)

AWAI-450. Owner requested a clearer install/overwrite procedure and a redesign
of the initial NixOS installer through the Awai install process. The deliverable
is a design proposal, a concrete [current-CLI Japanese guide](install-guide-ja.md),
and this implementation handoff. It does not replace the current USB image.

## Flow and screen ownership

| Figma screens | Purpose | Current implementation owner |
| --- | --- | --- |
| 00–01 | USB entry and preparation; boot environment always visible | `usb-install-6600h.nix`, `common.nix`, `hardware-6600h.nix` |
| 02–03 | Explicit target selection; source USB unavailable as target | `install-disk.sh` disk enumeration and in-use checks |
| 04–05 | Whole-disk overwrite review; exact serial + ERASE | `install-disk.sh` serial and approval checks |
| 06–08 | Image verification, OS write and full readback as separate stages | `install-disk.sh` install_to |
| 09, 14 | Verified completion; remove USB and boot installed NVMe | Existing `INSTALLED` / `REBOOT`; proposed poweroff guidance needs implementation |
| 10–13 | Pre-write failure, partial-write failure, diagnosis, safe pre-write cancel | Current failure strings; structured status/cancel boundaries need implementation |
| 15–16 | Initial encrypted-state setup and subsequent unlock | `disk-6600h.nix` / `otehon-state` |
| 17–18, 21–22 | Awai welcome, language, network and identity handoff | Existing shell setup/network/identity UI; new composition proposed |
| 19–20 | Current text-console instructions and boot-report explanation | Japanese guide and current CLI |

23 distinct 1280×800 screens are represented as native editable text, frames and
component instances. The galleries contain editable copies; the top-level
originals to their right are clickable prototype frames. Named prototype
starting points cover USB installation, failure/diagnosis, first boot, unlock
and the current text-console guide. Progress frames advance to their next
sample state when their background is clicked. The confirmation's sample-filled
frame demonstrates the state after validation; clicking a prototype never
performs approval or disk operations.

## Product language and visual system

- Source font: Noto Sans JP, verified against `shell/styles/main.cljc` and all
  rendered Figma text. Medium/Bold hierarchy is used with fixed action areas.
- Source Asa colors are represented as Figma variables. Context is expressed in
  text as well as color: USB boot, installed NVMe boot, selected target, exact
  current stage and last update.
- Simple Design System Button, Button Danger and Input Field are imported and
  instanced, with Awai font/color overrides. Repeated step, environment and byte
  progress controls use local components. No complete-UI raster is embedded.
- Sample device names, capacities, time and byte counters are design examples,
  not new observed measurements or performance thresholds.

## Execution boundaries that the implementation must preserve

1. Booting USB does not select or write a target. No automatic NVMe selection.
2. Bind destructive approval to the exact reviewed target identity and exact
   serial + ERASE input. A visual selection or Figma interaction is not approval.
3. Check source payload and recheck target identity/in-use state before writes.
   Preserve current bounds, known-byte digest checks and full readback.
4. Keep pre-write cancellation and partial-write failure separate. Never claim
   the previous OS/data is intact after any write, or silently choose another disk.
5. A successful write alone is insufficient: show completion only after all
   expected raw bytes match. Describe when to remove USB and which disk to boot.
6. Use observed byte counts for each known-size stage. Unknown totals must not
   produce fabricated percentages or an ETA. Track stage and last actual event.
7. Data-protection passphrases belong to the OS setup/unlock path, not Awai
   wallet sign-in. Never put them in status, diagnostics, logs or telemetry.
8. Keep installer administration separate from the normal static Awai app
   origin. A graphical implementation needs an explicitly bounded privileged
   bridge; an app-origin API or general command executor is not authorized by
   these screens. Shared app operation consent is not redefined here.
9. Do not advertise backup, rollback, data-preserving reinstall, production
   update enrollment or missing recovery mechanisms as implemented features.

## Required implementation and acceptance work

The design is ready for review; these remain runtime work:

- Build the initial USB graphical/text entry and ensure the physical display
  (`tty1`) works without requiring the VM's serial console (`ttyS0`). Keep a usable
  text path when graphical initialization fails.
- Resolve boot-report / console presentation so a service description cannot
  hide the operator prompt. Make the active boot source and next action visible.
- Expose bounded typed status and byte progress for verification/write/readback;
  preserve existing verifier and selection logic rather than duplicating it in UI.
- Add any proposed poweroff, status export or cancellation operation explicitly;
  the current CLI only offers REBOOT after success. Do not fake a working button.
- Exercise missing/ambiguous serial, in-use source, undersized disk, mismatched
  confirmation, corrupt source, I/O error, target change, pre-write cancel and
  partial-write failure. Confirm that unrelated disks remain untouched.
- Test keyboard-only operation, focus, local screen/OCR, readable error copy,
  installer-detached NVMe first boot and reboot/unlock using the same artifact.
- Keep source, built image, VM gate, physical PC acceptance and USB publication
  separate. Physical install failure remains unresolved until captured/reproduced.

Figma QA checked typography, native editability, layout bounds and the complete
composition, then corrected environment-badge contrast and single-action
alignment. The Figma screenshot endpoint returned empty downloads in this
session; inline screenshot delivery was used for visual inspection. No temporary
asset URLs or credentials are stored in this handoff.
