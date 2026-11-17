# Shared Awai Android setup

Owner direction: 2026-11-16. Tracking: [AWAI-3004](https://linear.app/kotobalabs/issue/AWAI-3004), child of AWAI-2974.

Awai Otehon Android Desktop uses the same Android setup state model as Awai Android OS. Desktop adapts layout, keyboard/mouse focus and available hardware. It does not reuse the NixOS Itonami Hello/language/network/sign-in sequence as its OS setup.

## Design handoff

[Editable Welcome and shared setup](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=241-3), page `241:2`. Existing Android v2, original desktop baseline and deferred particle studies remain unchanged.

| Order | Shared state | Desktop Figma |
| --- | --- | --- |
| 0 | Welcome; accessibility available immediately | 241:3 |
| 1 | Language and region | 241:46 |
| 2 | Wi-Fi, Ethernet or supported phone tethering | 241:84 |
| 3 | Date, time and time zone; automatic when available | 241:132 |
| 4 | Restore/link an existing Awai profile, create one, or defer | 241:170 |
| 5 | Phone approval subflow, only when selected | 241:220 |
| 6 | Privacy and selected restore/sync scope | 241:261 |
| 7 | Android native screen-lock enrollment | 241:308 |
| 8 | Complete setup and open the existing Awai Home | 241:348 |
| E1 | Network failure, retry, back or explicit offline continuation | 241:395 |
| E2 | Phone-link failure/expiry, network repair or defer | 241:442 |

All displayed networks, dates and successful lock states are design fixtures. Prototype navigation is not network authentication, PIN enrollment or completed profile import. The new-account and actual phone challenge/approval screens still need detailed design; the current frames establish their entry points, not a completed enrollment system.

Android SetupWizard reference: LineageOS `android_packages_apps_SetupWizard`, branch `lineage-24.0`, pinned revision [`d995f1a1949f5988850c9977658e2590efe502b4`](https://github.com/LineageOS/android_packages_apps_SetupWizard/blob/d995f1a1949f5988850c9977658e2590efe502b4/app/src/main/res/raw/lineage_wizard_script.xml). Read the actual script rather than assuming a universal Google setup wizard. Its sequence includes Welcome, locale, networking, SIM/date-time, restore, location/device-specific settings, recovery, lock/biometrics, appearance/navigation and finish. Awai deliberately applies its defined appearance, sound, motion and navigation defaults; customization belongs in later Settings. SIM and biometric steps appear only on supported hardware. PC date/time and physical keyboard handling remain applicable.

## Identity and protection

- A device PIN unlocks this Android device. It is not the Awai account, a wallet seed or a transferable identity.
- Existing iOS/Android Awai users should approve adding this device from their phone. A proposed short-lived challenge binds the new device public key, device name, expiry and selected profile/data scope. QR or cross-device Passkey authentication does not itself copy a profile or private credential.
- Reuse Awai's verified identity/link protocol and canonical per-operation consent. Wallet authentication is an optional supported identity route. Do not force a wallet transaction at every device unlock or copy a seed/private key from Nix or a phone.
- Create device keys locally through Android Keystore; verify the actual PC's hardware-backed custody and encryption capabilities before promising them. Profile transfer must encrypt selected data for the new device and support cancellation, expiry, revocation and phone-loss recovery.
- If account linkage is deferred, allow local Home use and later enrollment. Denied or failed network/link operations must not fabricate a connected, authenticated or restored state.
- Use Android's native screen-lock and storage-protection lifecycle. Do not add Nix's separate first-boot data-protection passphrase to the Android wizard. This design does not establish that the current evaluation image has qualified persistent encrypted storage.

## Runtime ownership and acceptance

SetupWizard owns the OS setup lifecycle. Android Settings/Connectivity APIs own locale, validated connectivity, date/time and credential enrollment. The Itonami APK remains an ordinary app and must not set provisioning-complete flags or gain privileged settings access merely to hide its onboarding.

Only after required native steps succeed may the OS finalize setup. Reopening Itonami should consume the installed OS's locale/account capability where supported, without replaying OS setup. Missing accounts still require the app's truthful account entry. Android Back must work from every subordinate state; retain non-secret selections on retry. Do not retain Wi-Fi passwords, PINs, QR secrets or identity keys in screenshots, logs or Linear.

Required implementation verification: Japanese/English, keyboard/mouse/touch and large text; no network, captive portal, associated Wi-Fi without Internet, supported USB tethering and independent relay failure; back/cancel/expiry; failed/denied enrollment; process death and first-boot completion; persistent reboot and subsequent unlock. The current RAM Live image cannot qualify reboot persistence. Preserve existing Nix storage and boot configuration.

## Design evidence and remaining work

Figma readback: 11 editable 1440×900 screens, 134 text layers, 99 component instances, vector icons, and only discrete logo/artwork image fills. Product font is Noto Sans JP. Reused Android v2 button/row components, semantic color variables and spacing/radius tokens. 27 prototype navigation routes persisted and were read back. Welcome has a native 0→1 opacity track over 0.6 seconds; transitions dissolve over 180 ms. Static Welcome and network composition inspected. Motion playback/video, focus order, TalkBack and physical visual acceptance remain unverified; reduced motion must show the final static state immediately. No particle animation was added.

This is a design handoff, not a ROM implementation or physical deployment. The currently packaged Itonami shell still contains the NixOS-derived setup. Its replacement/OS handoff is explicitly pending. No device state, owner identity, storage or network services were changed for this design task.

Issue/run: AWAI-3004 (`a904a681-5e8c-4635-be77-6b124887a2e2`), Codex thread `01a1e3f0-1dde-7af3-a093-2a8257f6eb56`, branch `codex/awai-3004-android-setup`, base `c7f1008cf06f4eacb7817d3602f7a9c0373146c5`. Provider/model/settings, estimate/unit, calibrated token forecast, attributable counters, cost and active/wait split are unknown. Prebinding/mixed app-install work is unallocated. No velocity or completion percentage is inferred.
