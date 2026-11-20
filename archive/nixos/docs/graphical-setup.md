# Graphical setup

The installation medium and installed node share a native GTK 4 setup window.
Weston provides a single application display with software rendering. Japanese
Noto fonts, a restrained light background, rounded cards and large controls
make the same guide usable with a mouse or keyboard. Network configuration,
offline installation and phone account linking retain their existing backend.

## User flow

1. Choose Wi-Fi, Ethernet or offline installation. A saved connection avoids
   repeated password entry. Wi-Fi passwords are masked with an optional reveal
   control and go to NetworkManager through stdin, never command arguments.
2. Select an internal disk card showing model, capacity, serial and device.
   USB, read-only, mounted, swap, mapped and undersized disks remain excluded.
3. Review the destructive action, acknowledge loss of all selected-disk data,
   and press **消去してインストール**. The native UI sends the existing exact
   selected-device approval to the installer; the console fallback still asks
   for the typed phrase. Disk identity and eligibility are checked again.
4. The busy page remains visible while the bundled OS is copied offline.
   Completion offers reboot. No automatic erase retry follows any failure.
5. Boot the installed disk. Network settings survive. When connected, display
   a phone QR with the device ID and approval code. Passkey authentication and
   approval happen on the phone. Cancellation closes the QR and aborts polling.
6. Display saved versus online-verified registration distinctly. An unavailable
   service remains an actionable retry/network/later page. Inference readiness
   is verified separately.

The UI communicates with the existing privileged backend only through a UNIX
socket in its 0700 runtime directory; the socket is 0600. There is no HTTP
listener or remote admin endpoint. Closing the QR transport clears the waiting
screen. Backend and display startup are tracked so a display failure cannot
launch the installer twice. A console fallback is used only if the graphical
backend has never started.

## Filesystem identity

Previous offline systems located root and EFI partitions by shared filesystem
labels. The installer therefore refused another disk bearing Murakumo labels.
The new manifest version is 2. New systems use UUID parameters generated for
that selected installation, validated before constructing device symlinks in
initrd. Both EFI and BIOS boot entries receive those parameters, as does the
retained `/etc/nixos/configuration.nix`. Old version-1 manifests are rejected.
Friendly filesystem labels may repeat without selecting another installation.
Missing or invalid UUID parameters do not fall back to a shared label.

A new ISO must contain both the new installer and new prebuilt systems. Updating
only the installer script in an old ISO is insufficient. Writing a USB does
not update an already installed internal system.

## Acceptance evidence

The release verification record must show actual graphical media boot,
explicit disk approval, offline installation, a boot without the ISO while a
second Murakumo-labelled disk remains attached, UUID-based mounts and an
unchanged hash for the second disk. Source tests or screenshots alone are not
complete installation evidence. Physical hardware graphics, real Wi-Fi radio,
real phone Passkey approval and production registration remain separate checks.
