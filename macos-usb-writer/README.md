# KIOXIA-only recurring USB writer

One administrator setup installs a root-owned compiled Swift helper and a sudoers
rule for junkawasaki. The rule permits only the exact helper binary digest, with
no arguments; it does not permit dd, Python, a shell, diskutil, or arbitrary root
commands. The fixed target is KIOXIA TransMemory serial 0022CFF6B899CA205987CBC4,
61949214720 bytes. The current disk number is discovered through its IOKit USB
parent rather than assuming disk6. Internal, non-USB, duplicate, missing, partition,
and changed targets fail closed.

The current candidate's fixed request is
`/Users/junkawasaki/github/workspaces/codex/awai-usb-writer/usb-write-request.json`.
This persistent tool inbox follows the canonical workspace layout. It contains
action check/write, ISO path, length, and expected SHA256. Migrating from the
older installed helper requires administrator setup with the new pinned binary;
changing repository source alone does not update the installed helper.
ISO input must be a regular file owned by uid 501, inside the configured QA folder,
with ISO9660 magic, a sector-aligned 1 MiB–8 GiB length, and the expected SHA256.
The helper drops effective user/group privileges before opening user input. It
snapshots and verifies the image in a root-private temporary directory before any
USB write. No caller-controlled file receives root output; events use stdout.
Only one writer runs at once. The target is rechecked before and after raw-device
open and before ejection. The complete image length is read back and hashed before
ejecting. Temporary staging data is removed even when a failure occurs.

Open KIOXIA-Initial-Setup.command once and enter the Mac administrator password.
It installs the checked binary and validates sudoers, tests no-password execution
with cached credentials deliberately ignored, and refuses extra arguments. It
performs read-only preflight and returns. Writing is a separate invocation of
KIOXIA-Update.command with the owner's media-update authorization.
The update action overwrites this specific USB. No password is stored.

A future ISO needs only a freshly prepared request with its exact path, bytes, and
SHA256. Replacing the helper itself requires administrator approval again. The
helper uses Apple system tools and CryptoKit, not a user-writable root interpreter.
Build: xcrun swiftc -O USBWriter.swift -o <QA>/murakumo-usb-writer. Test build uses
-D USB_WRITER_TEST. After rebuilding, update the installer binary digest.

macOS removable-volume/TCC access is separate from sudo authentication. The prior
AppleScript privileged write failed with Operation not permitted. A no-password
sudo rule alone does not establish disk access. This environment's CUA connector
refused Terminal access, so the initial setup was launched by the user. After
installation, the compiled helper runs through the normal command tool without
a password or a Terminal UI session. No Full Disk Access setting was changed.

To remove the capability, an administrator removes only
/private/etc/sudoers.d/murakumo-kioxia-writer and
/Library/PrivilegedHelperTools/cloud.murakumo.kioxia-writer.

Status on 2026-10-06: helper installed by the user; the dedicated sudoers rule
parses, root ownership and permissions match, and a preflight with ignored cached
credentials runs without a password. An unrelated finch-lima sudoers permissions
warning stopped the original global post-install check; it is not modified.
Installer validation is now scoped to this rule. Real USB write verification is
completed without another password, matching all 2011299840 readback bytes and
safely ejecting the USB. See docs/verification-passwordless-usb-2026-10-06.md.
