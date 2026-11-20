# KIOXIA-only passwordless writer, 2026-10-06

User explicitly requested repeated USB updates without repeated password prompts,
then launched the one-time setup. The compiled helper is installed as root:wheel
0755 at /Library/PrivilegedHelperTools/cloud.murakumo.kioxia-writer. Its dedicated
sudoers entry is root:wheel 0440, permits junkawasaki to run only the exact binary
SHA256 3b424555f51c72c90860cb1393d242ab6586750775c16a9938bf09da385da689,
with no arguments. Source, target-binding tests and syntax checks were completed
before setup. No passwords are stored.

The user's setup installed the helper and valid dedicated rule, then stopped on
the pre-existing finch-lima sudoers file's permissions warning during global
visudo validation. That unrelated file was not changed. The local installer now
validates its own rule. Direct execution with sudo -n -k (ignoring cached
credentials) completed real ISO preflight without a password. The same execution
method subsequently started the actual USB write. Unlike the earlier AppleScript
and dd route, this installed compiled helper could open the raw USB for writing.
No Full Disk Access change was made.

The fixed serial is 0022CFF6B899CA205987CBC4; capacity 61949214720 bytes.
IOKit resolution found disk6. The request selected the new guided setup ISO,
2011299840 bytes, SHA256
ae196687f5677e9f4a12adb2c1b1f1d75d2db38adb9c1d614828927964210188.
The root-private source snapshot was hashed before opening the raw USB.

The general administrator command and extra-argument tests are expected to refuse
noninteractive execution. The source helper uses user privilege for opening user
files; a root-owned binary, digest pin, private staging, exact-device checks and
exclusive raw descriptor restrict the permanent capability to this KIOXIA.

The actual write completed with exit 0, without password entry and with cached
credentials ignored. Exactly 2011299840 bytes were read back; the ISO and USB hashes
both equal ae196687f5677e9f4a12adb2c1b1f1d75d2db38adb9c1d614828927964210188.
The helper reports verified-and-ejected; diskutil no longer lists external physical
media. Private staging is removed. The request is reset to check after completion.
Authoritative evidence is evidence/passwordless-usb-2026-10-06/result.json and
write-readback.log. The older AppleScript result.json still describes its failed
pre-write attempt and is superseded by this record.
This update does not publish production registration routes, install the physical
PC, link a real account, or establish fleet inference readiness.
