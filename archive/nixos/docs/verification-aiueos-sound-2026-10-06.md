# AiueOS / Awai Node sound and authentication QA — 2026-10-06

## Scope and evidence boundaries

The USB request covers local installer media and dedicated Mac QEMU qualification.
No production deployment, push, PR or merge was performed. Device setup remains
available without a smartphone; OS installation remains offline. Public account
registration is not working yet: the actual packaged client reached the fixed
public authority, whose registration start route returned HTTP 404. The companion
sound reader is packaged locally and has not been published to that portal.

The approved account was a deliberately isolated fixture (`did:key:owner`). The
reviewed Worker and actual packaged client verify device signatures, bound polling,
receipt persistence and signed online status. Authentication admission was an
explicit injected test verdict. No actual phone Passkey/account or fleet inference
is claimed. Test verdicts and diagnostic harnesses are not packaged in the ISO.

## Controlled install and authentication

Runtime `06009dc` was installed fully offline into a dedicated 16 GB NVMe QEMU
disk with no network interface, using the embedded prebuilt system. English was
selected during install, Japanese after boot. No initial root-password prompt or
remote package build was needed. All 17 retained sources matched the installer.
The VM rebooted from the same disk without ISO, with root and boot UUIDs verified.
The real public registration attempt returned 404 and created no account receipt.

The packaged client's QR was decoded from an actual VM screenshot. A mobile-width
local portal rejected unverified admission, offered the existing authentication
handoff, compared the actual VM DID, then accepted explicitly admitted fixture
approval. The VM saved its receipt and verified signed online state. After a real
VM reboot, the same DID, account DID and linkedAt were retained; signed online
verification succeeded again with a different boot ID. Fixture state was removed
before the VM powered off.

## Startup audio and code transport

The graphical language screen plays an original, quiet 24-second ambient piece.
Changing screens stops audio; stop and replay buttons were exercised. Native VM
PCM output confirmed a quiet signal (peak about 2.3% full scale in the initial QA
capture). Actual speaker loudness depends on hardware and was not measured.

The code-sending button sends only the public expiring approval code as FSK.
Generated WAV decoded correctly, but initial native VM playback lost symbols at
output startup. A one-second silent lead-in corrected that loss (`afc0762`).
The corrected single transmission was played through the native VM audio device;
its recorded PCM decoded to the same URI as the QR, including through the browser
companion at 390 px width. Physical phone microphone decoding remains unqualified.
Receiving sound never approves an account automatically: the existing Passkey and
device comparison remain necessary.

Source tests: 45 pass. Worker authentication fixtures: 21 pass. Browser fixtures
cover authentication refusal/explicit approval and reader visibility/cancellation.

The final ISO differs from the fully installed `06009dc` candidate only in the
code-playback silent lead-in (plus its source test). Final media asset and native
playback checks are recorded separately. The earlier full offline installation
and account persistence evidence is retained with its exact source/hash boundary.

Evidence: [directory](evidence/aiueos-sound-2026-10-06/).

## Final artifact

Frozen runtime: `afc0762`. Final ISO is 2,306,211,840 bytes, SHA-256
`c1d28f40e6834613c2ca50da550fddb734378db3bd05456c9aa3d36d64932cad`.
Builder and Mac hashes agree; build exit is zero. The final ISO boots to the
graphical language page, plays startup audio and includes matching runtime assets
in its live, prebuilt UEFI and prebuilt BIOS environments. Its actual packaged
code generator produces native VM PCM that decodes to the approved fixture's QR
URI. No production authentication bypass was added.

All task-owned QA VMs, browser sessions and local fixture servers were stopped.
Other user VMs and apps were not closed. The diagnostic account state was removed
from the dedicated VM after evidence export.

KIOXIA TransMemory 61.9 GB, serial `0022CFF6B899CA205987CBC4`, was written
using the existing passwordless serial-bound helper. Exactly 2,306,211,840 bytes
were read back; USB and ISO SHA-256 matched. The helper safely ejected the media;
the final external physical-disk listing was empty. The USB can be unplugged.
