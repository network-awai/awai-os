# Awai Otehon boot and setup experience — AWAI-2962

Design: [Boot & Feel](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=145-2)
and [account-linked setup](https://www.figma.com/proto/umqCqP5KSjLWh9fhCI1HaN?node-id=149-5&starting-point-node-id=149%3A5&page-id=145%3A2).
The existing Page 1, foundations, library and desktop work remain intact.

## Delivered shell behavior

The browser's actual device-identity preparation renders a boot view instead of
an empty root. The existing Hello/setup entry uses the exact user-supplied logo
(SHA256 e64357d85ec32fbbb8ab9c087b60637e97779db64c9d4e2a18146bba80481347).
The emblem fades from opacity 0 / scale .94 to its resting state over 700ms,
then holds. Figma's timeline exporter loops its 2-second preview; the shell
intentionally plays once, without delaying readiness or waiting for an
animationend event. Timing/easing derive from node145:6; layout uses Garden,
Reagent and the existing shared brand themes rather than generated Tailwind.

Original synthesized tones give start, select, confirm and back feedback.
Audio starts only on trusted input, uses no downloaded samples and does not
change the OS mixer. Startup sound accompanies Get Started, not unattended
firmware boot. The standard sound/motion experience starts without a preference question.
Customization lives only in Sound after setup; appearance lives in Display.
Failure to create/resume audio never blocks navigation. Preference persistence
failure is visible; the current tab still honors mute and reduced motion.
System reduced-motion always wins. Only opacity/transform animate; focus rings
and static final content remain available. Consent dialogs are excluded from
sound delegation and retain the canonical broker semantics.

## Proposed setup and protection, not an implemented crypto path

Welcome in the detected language → S03 phone/passkey account → S04 protection →
S05 recovery verification → S06 ready. Language/network choices are exceptions
when a change or connection is needed, not a preference questionnaire. S07 covers later account unlock; S08
covers devices without automatic protection. The successful state in S06 is a
design scenario, not evidence about the current PC. Back navigation is part of
the prototype. Current live setup still uses its existing sign-in/trust flow.

The aim is no *additional routine disk passphrase*, while retaining account
verification and encryption. [AWAI-165](https://linear.app/kotobalabs/issue/AWAI-165)
owns implementation of TPM/Secure Boot, encrypted user state and screen lock.
A passkey signature alone is not an encryption/recovery key, and account
sign-in alone must never mark protection or recovery complete.

Implementation boundary for that follow-up:

- Boot a public, temporary setup/unlock UI before mounting personal state.
  Current disk-6600h.nix instead waits for a local passphrase before sysinit;
  that path is deliberately unchanged by this shell change.
- Generate random data keys locally. Bind the key-wrapping/unlock path to the
  verified account and, where available, reviewed hardware/boot policy. TPM
  auto-unlock by itself must not expose personal state before account unlock.
- Verify actual PRF/hmac-secret results for eligible credentials, or a separate
  reviewed recovery mechanism. Do not assume phone transport or passkey sync
  preserves a usable wrapping key. No plaintext cloud escrow.
- Verify independent-device recovery, denied/wrong-account unlock, absent/cleared
  TPM, changed boot measurements and OS-update/rollback recovery. Display
  incomplete/error states honestly. Preserve old key slots during migration
  until restart and recovery succeed; never reformat existing state.
- Show “protected” only after encrypted state and account binding are verified;
  show “recovery verified” only after an independent unwrap test. The normal
  screens need not expose TPM/LUKS terminology; details and exceptions can.

References: [systemd-cryptenroll](https://www.freedesktop.org/software/systemd/man/latest/systemd-cryptenroll.html),
[WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension).
Neither capability presence nor these documents qualify a device.

## Evidence boundaries

Host tests and a local release build qualify their stated scope only. Nix-pinned
VM, physical GPU/audio, OS boot theme, unattended start and phone recovery are
separate checks. The physical 6600H black screen after data unlock is tracked in
[AWAI-2965](https://linear.app/kotobalabs/issue/AWAI-2965), independently of the
successfully installed/read-back NVMe and merged LAN installer PR137.

## Product defaults and visual atmosphere

Owner decision 2026-11-16: Awai defines the first experience. Do not ask users
to configure sound, motion or theme before use, including optional disclosures
on the welcome screen. Keep these controls in post-setup settings. OS mute,
volume and reduced-motion remain authoritative automatically.

The entry canvas shares the logo's pale blue, lavender, warm cream and subtle
red light. Blend the exact logo into this scoped light atmosphere; preserve
readable foregrounds, focus rings and restrained motion. The component-level
entry palette is intentional; it does not overwrite the saved desktop theme.
The background reuses the already selected desktop macro artwork
(SHA256 4637ce4a054ea77ddf427889b2eff1b54c71df380aec4bd4cdea3ad8095f6fef),
bundled as assets/awai-atmosphere.png. Tokens and the shared Figma paint style
define the atmosphere. The foreground feather affects only the original
asset's outer 12% backdrop, leaving the mark itself intact. Avoid animated
background filters or persistent decorative loops.
