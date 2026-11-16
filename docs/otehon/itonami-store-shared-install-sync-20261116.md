# Itonami Store: shared acquisition, identity, permissions and sync

Owner request 2026-11-16; AWAI-2977 / AWAI-2979 / AWAI-2980. Preserve Android UX v2 and the existing desktop Core / Apps / System, Manimani and Dock. Desktop baseline: https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=216-476 . Any new composed UI must be designed within these baselines before implementation; adding a Store does not replace the desktop.

Awai/LAN-debug readback (chat01a1dd46-084a-7861-b35b-fd0bd9d17927) found the 6600H in a RAM diagnostic environment. Browser storage there is temporary and normal desktop restoration remains unverified. Do not use that environment to claim persistent sign-in or install acceptance. This work uses an isolated NixOS VM and leaves 6600H recovery untouched.

## Recommended common user flow

1. Browse the catalog without an account. Display publisher, version, target platform and the acquisition source.
2. Confirm the precise catalog/artifact HTTPS operation through the canonical client-runtime UI. Refusal sends no request. Each fetch is distinct; login or an earlier download is not installation permission.
3. Verify pinned release digest, metadata signature, expiry and revision floor. Admit only the platform-specific immutable artifact for the shared application ID.
4. Present the independent OS installer confirmation. Preserve app data on update, reject downgrade/signature change, retain a previous version for rollback.
5. Manage app permissions separately from installation. Ask only when an operation needs a resource. Installation does not grant contacts, files, camera, notification, network/sync or privileged system access.
6. Offer optional account/device linking for sync. Keep the device key in OS-protected persistent storage, retain a valid link over reboot, show expiry/revocation and reconnect without erasing unreadable local data.
7. Sync selected app/data categories directly to an explicitly selected service only after the canonical operation-specific approval. Display destination and sending/receiving categories. Conflicts, stop-sync and device revocation preserve local data; re-enabling requires fresh approval. Automatic background sync is not authorized by an install or account login.

| Responsibility | Android | NixOS |
| --- | --- | --- |
| Common | Shared app IDs, `.cljc` selection/state, release metadata, UI, sync contracts and evidence |
| Acquisition | Same pinned browser download broker | Same pinned browser download broker |
| Installer authority | PackageInstaller user-action UI plus independent host confirmation | User-scoped installer/portal with authenticated calling-app identity and independent native confirmation |
| Package trust | APK signer/package/version plus catalog signature | Nix closure/cache signature plus pinned catalog; never evaluate catalog-supplied arbitrary Nix/shell code |
| Runtime permissions | Android app UID/runtime permissions | App sandbox and xdg-desktop-portal / filtered D-Bus; Nix build sandbox alone is not app confinement |
| Privilege | App install distinct from device administration | Per-user app profile distinct from system generations / nixos-rebuild / administrator changes |
| Credentials | Keystore-backed device key and encrypted account handle | Secret Service or equivalent protected persistent device key; no wallet private key in browser localStorage/Nix store |
| Update state | App data preserved across signed update | Per-app state outside immutable package generation, with schema-aware rollback |
| Android APK on NixOS | Not applicable | Explicit Waydroid path, own Android UID/permissions; never claim native APK execution |

Store browsing and public artifacts do not need wallet authentication. Device unlock/account linking, install consent, runtime permissions and external-operation consent are separate controls. Aim for equivalent steps and wording across platforms; platform security dialogs remain real OS UI.

## Current implementation boundary

The first online release is a fixed development catalog and Yotei APK hosted as immutable GitHub commit bytes. The root development key is distributed with the trusted host; signatures are verified independently in browser and Android. Android independently admits the signed catalog, persists its revision floor, verifies cached APK identity, and requires native plus PackageInstaller confirmation. Requests send no account credentials or app data; the distribution service sees IP and requested artifact. Offline bundled use remains available until a newer catalog is explicitly admitted; invalid/expired admitted metadata fails closed.

The NixOS browser path uses the same UI/model and a separate persistent Chromium profile. In this phase it activates the already bundled Yotei browser app; native Nix-package and Waydroid installation are not claimed. Online catalog checks are shared. Protected persistent identity, sandbox/portal-backed native installer and actual cross-device sync are AWAI-2979/2980 work, not implicit permissions added to this browser prototype.

Production keys/rotation/revocation, mutable latest-channel discovery and multi-publisher distribution remain release work. Development debug signatures are not production publisher identities. Immutable development releases require a host update to select another revision; no silent mutable update source is introduced.

## Acceptance

Keep source, package evaluation/build, NixOS VM boot/launch/reboot, Android install/update and physical 6600H acceptance distinct. The VM must demonstrate disabled-module behavior, no APK payload exposure at the static origin, Store/Yotei launch and event retention over reboot. Online acceptance must exercise actual canonical refusal and approval, digest/signature failure and Android installer handoff. Identity/sync acceptance will additionally require reboot persistence, expired/revoked device behavior and denial with no transmitted bytes.

Sources checked 2026-11-16: https://flatpak.github.io/xdg-desktop-portal/docs/ (portals are usable by desktop containment frameworks, not only Flatpak); https://docs.flatpak.org/en/latest/sandbox-permissions.html (runtime isolation and portal behavior). These inform the proposed native permission adapter; they do not prove the adapter exists.
