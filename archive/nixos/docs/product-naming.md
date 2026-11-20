# NixOS and Murakumo product names

The current installer delivers NixOS and configures Murakumo Client. AiueOS is
an unfinished future replacement for NixOS; it is not a NixOS distribution name.

| Role | Name |
| --- | --- |
| Current operating system | NixOS |
| Installed software suite | Murakumo Client |
| Resident participation process, when supplied | Murakumo Daemon |
| Command interface | Murakumo CLI |
| User-facing application | Murakumo App |
| Running network participant / host | Awai Node |
| Future operating system | AiueOS |

Installation is **Install NixOS → Set up Murakumo Client → Participate as an
Awai Node**.

The host role was renamed **Murakumo Node → Awai Node** on the same owner
instruction that named `network-awai`'s distribution Itonami OS (AWAI-84 /
ADR0013): *Awai Node* is the logical host, *Murakumo* stays the dedicated
machine and its compute service, *Murakumo Client / Daemon / CLI / App* keep
their product names. Display labels, prose, boot-menu title and the self-signed
tls CN follow the new name; **compatibility identifiers do not** — service and
unit names, paths, boot entry IDs, release endpoints, signing-key IDs, Nix
options, and the `kotoba://murakumo/…` capability resource strings stay as
they are. Evidence, hashes and delivered release receipts keep their original
text. Node details describe the host and participation status. Local
setup or account approval does not establish running inference or fleet admission.
The Daemon name describes a role; this naming change does not add a daemon binary.

## Compatibility and delivery

Existing `aiueos.*` signed schemas, service/unit names, paths, boot entry IDs,
release endpoints, signing-key IDs and Nix options remain compatibility identifiers.
Renaming them would require a separately qualified migration; their spelling does
not identify the current OS as AiueOS. Boot-menu titles and current UI text say
NixOS. Historical evidence, hashes and release receipts retain their original text.

This source change does not rewrite already delivered USB media, change a
published signed release or update an installed host. Those need a new built and
qualified release. Existing disk labels and ownership/update policy remain intact.
