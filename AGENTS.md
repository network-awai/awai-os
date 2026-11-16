# Murakumo NixOS

Follow the workspace-level AGENTS.md architecture and Linear tracking rules.
The native product entry is `nixos/murakumo-nixos.nix`. Keep it separate from
the historical `node-base.nix` setup/provider/update closure. Never add those
Node.js tools as a native profile fallback, and do not stop existing services.

- Compile the monitor and dapp cores with the digest-pinned Amu selfhost native
  compiler in `nixos/native-sources.json`. No JVM, nbb, KBB, babashka, Node.js
  compiler, C compiler or C loader in this build/execution route.
- Nix and its platform build shell package artifacts; this is not a claim that
  the general installer, compiler project linker or CDCI controller is native.
- Static localhost nginx serves only immutable app files. Browser JavaScript
  owns UI/local state and a Worker executes selfhost-produced Wasm. Copy the
  exact pinned canonical `wasm-webcomponent/src/kotoba-client-runtime.js`.
  Current external operations are empty. Changes must follow the shared
  operation-consent contract, never a product-local broker.
- Keep observations outside the static root. Unsigned snapshots are neither
  admission nor execution permission. Unknown Cell/peer state stays unknown.
- Do not describe the observer as a complete Awai Node, hata conductor,
  distributed state system, model provider or qualified economic participant.
- Live sessions must warn that browser state is temporary. Validate recovery
  files and refuse to overwrite existing work. Preserve unreadable data.
- Use the pinned NixOS VM gates before claiming boot/restart/desktop behavior.
  Keep source, build, VM, physical hardware and published releases separate.

The new gate is `nixos/tests/native-workspace.nix` (add `--arg desktop true`
for Cage/Chromium/OCR). No old JVM/nbb workflow is added or retained as a
fallback. Historical setup/provider/voice/update tests do not qualify this
native profile, and this profile does not replace their release/signing gate.
Physical GPU/firmware, networking, full Cell execution, distributed app state
and production keys remain independent acceptance work.

Installed native OS network updates are an opt-in platform administration route
in `nixos/network-update.nix`, qualified separately by
`nixos/tests/network-update.nix`. Nix/systemd/OpenSSH/shell here manage the OS;
they do not replace native app/Node logic or use the historical SCI/Node updater.
Do not enable remote access, generate keys, accept changed SSH host keys, update
live USB sessions or claim early-kernel hardware watchdog recovery. Preserve the
old persistent boot default until an actual one-shot trial has booted and the
authorized operator confirms its exact ID after local health. Never make a
production update or USB refresh a side effect of building/testing this module.

Awai Otehon (`network-awai/network-awai-apex` ADR 0026) is added as a profile
separate from the native profile. It is the Otehon edition of Itonami OS and may
use `.cljc`, clj / JVM, cljs builds, nbb, babashka and the rest of ADR 0026 D3,
pinned with Nix (owner decision 2026-11-07, D18). Do not put Otehon dependencies
in the native profile. The native profile rules above stay unchanged.

## Meiji desktop entry (AWAI-195, owner direction 2026-11-16)

Owner direction 2026-11-16, AWAI-2820: if former execution keys cannot be
restored, rotate them and persist recovery material encrypted in AwaiVol.
Preserve the existing cluster/member identities, enrollment, cursors and guest
disks. Stage authenticated encryption and restore verification before a
quorum-preserving trust update. New credential issuance does not prove old
credential revocation. Keep wrapping keys in the OS credential store; never
put plaintext keys, prompts or transcripts in WebDAV/Git/telemetry.

VM lifecycle controls and the dense Bot/Circle workspace must mount separately
in the desktop entry. Qualify lifecycle UI on a disposable guest first; record
production guest shutdown/drain and Bot work separately. A blank fixture's
QMP stop request is not evidence of a guest acknowledging clean shutdown.

- Awai Otehon OS codename is **Meiji**. Use **Tauri v3** as the desktop entry
  managing Meiji VMs; do not silently select v2. v3 is Alpha at implementation
  time: pin exact published crate versions and keep release qualification open.
- Implement lifecycle policy, resource validation, persistence, inference
  adapters in `.cljc` under `nixos/otehon/meiji/src/`; desktop views and the
  local IPC client live in `nixos/otehon/shell/src/meiji/` so the existing Nix
  shell source closure remains self-contained.
  Rust is the thin Tauri IPC/process adapter. The Babashka Otehon development
  controller does not establish the ADR 0031 `cljrs` AOT target as completed.
- Soshiki displays Bot observations and controls VM start/stop and vCPU/guest
  RAM allocation. A running hypervisor is not guest health or Bot liveness.
  Missing/stale reports and unmeasured GPU use remain unknown.
- Permit only locally configured VM IDs, signed image digests, executable
  paths, resource ceilings and selected inference providers. No shell or
  arbitrary command/path/endpoint arguments from WebViews. Never adopt or stop
  an unrelated existing VM. Require a stopped VM for resource changes.
- Keep UI/operation approval, Bot executor grants, and VM administration
  distinct. Tauri capabilities do not replace the shared Kotoba external
  operation consent contract. Keep UI/workflows in the local WebView; no BFF.
- Local GPU worker connections (Metal/CUDA/ROCm/Vulkan/DirectML) are explicit
  host inference routes, not evidence of VM GPU passthrough. No remote/CPU
  fallback. Test each actual OS/device/model separately before qualification.
- Owner selected Kapitsa with Qwen3.6-35B-A3B for the Mac route. Pin the
  engine release and model/drafter revisions and verify artifact digests.
  Kapitsa is Apple-Silicon-only; never claim Linux/Windows support for it.
  Force private/local execution, no discovery or model switching, and pass
  API credentials over private files/stdin, never argv or environment.
- Owner clarification (2026-11-16): **do not start Kapitsa on this local owner
  workstation**. Do not run its serve, pull, probe or benchmark commands here.
  The local worker configuration is disabled and its provider was removed.
  A different Awai execution node must be explicitly identified before any
  deployment there. Pure configuration/protocol tests do not launch Kapitsa.
- Owner selected **jacob** as the execution node. Its verified account is
  `node` and it has 16 GiB unified memory; deploy the explicitly pinned
  Qwen3.6-35B-A3B `16gb` variant there, not the 22 GB 4-bit pack. Treat this
  quantization as a separate measured configuration. Keep its worker private
  to jacob and use a strict-host-key SSH forward for the desktop connection.
  No public port, unknown-host-key acceptance, node failover or local engine
  startup is implied by that forward.
- Preserve working disks and AwaiFS/Kotobase state across launcher updates.
  VM snapshots do not undo external operations or prove distributed backups.
  Do not replace or disable live cron, fleet or authentication services when
  testing the desktop entry. Record source/build/hypervisor/guest/GPU/installer
  evidence separately in Linear. Packaging the app does not qualify its worker.

## UI design and writing

Apply [the shared UI rules](docs/design/interface-principles.md) to Awai OS and
its bundled apps. Prefer recognizable controls, hierarchy, selection feedback
and concise status labels over explanatory paragraphs. Keep implementation
notes, measurement caveats and design rationale in engineering documentation;
show optional technical facts through named disclosure controls. If an action
needs a paragraph to explain it, simplify the interaction first.

Keep actionable errors, stale/unknown states, destructive consequences and the
canonical operation-consent disclosures visible when relevant. Moving a note
out of the main view never grants capabilities or changes what a metric means.

Use stable translation keys, complete messages with named placeholders, and
locale-aware formatting. Do not assemble sentences from translated fragments,
hard-code layout widths to Japanese text, or use color/motion as the only
status cue. Check Japanese and English at phone and tablet widths, keyboard
focus and reduced-motion behavior. Imported profile names and user-authored
content are not UI copy and must not be silently translated.

## Shared Agent sessions and peer dialogue

Keep Itonami and Soshiki on the same Agent conversation component and pinned
canonical Itonami session contract. Authoritative messages belong to the Agent's
Kotobase/AwaiFS store; browser navigation, drafts and rendered messages are
transient. Participant views of a peer dialogue resolve the same canonical
session; unrelated scopes stay isolated. Preserve legacy histories until an
explicit migration is qualified.

Show observed processing, residence, source-cron waiting and on-demand support
as separate states. A loaded shared service or a registered profile does not
prove an individual Bot is resident. Use current matched heartbeat evidence;
unknown coverage stays unknown. Keep large catalogs searchable and paged.

Peer output is proposal data, never tool authority. Bind each approved dialogue
to its goal, named participants, source hashes, owning Issue, model and turn
bound. Preserve original cron and the original distributed occurrence claim;
uncertain results do not authorize replay or another cycle. Keep public presence
and progress metadata free of transcripts, private identities and session IDs.

## Current release codename — Meiji

Owner decision 2026-11-15: the current Awai OS release codename is **Meiji**.
Manage the product name, version number and release codename separately, following
macOS Tahoe's naming concept. Use `Awai OS Meiji` when a release name is needed.
The source of the current codename is `release.json`; tracking is
[AWAI-2925](https://linear.app/kotobalabs/issue/AWAI-2925).
Future names and any sequence rule require a separate owner decision; do not
infer an era-based sequence or change package versions/runtime architecture IDs
as a side effect of the codename. Record source metadata and deployed UI/image
branding separately.

## Private mail aliases (AWAI-328)

Keep durable principal IDs, verified DID/key bindings, mailbox storage and public
mail addresses separate. For awai.network, issue independent random aliases per
purpose/counterparty, retain the same alias through replies and keep stopped
aliases as permanent tombstones. Do not derive public addresses from profile
names, DIDs or their hashes. Existing bot-* reservations are compatibility data,
not live mailboxes or a grant. Keep the private mapping only in Agent-owned
encrypted Kotobase/AwaiFS; never publish it in fleet artifacts, telemetry or
Linear. Soshiki reads and mutations use fresh canonical broker consent to the
independent owner-authenticated Agent service. Its digest-pinned owner config
must enable identity enrollment for its verified catalog and owner namespace.
CLJC owns principal/profile/DID/epoch binding, structured signature verification,
macOS Keychain custody, recovery and alias policy. Existing MJS is an HTTP/process
transport only; do not reintroduce the removed mail domain implementation there.
Browser/profile/model text cannot create that authority.
Key rotation preserves the principal; replacing a did:key is a new key binding,
not an in-place update to that DID. Address reservation/stop, SMTP routing,
decryption and send grants are separate states and acceptance claims.

For AWAI-2933, the owner service enrolls its verified catalog at startup and
resumes newly registered profiles on reconciliation. Pin the approved Bot ID
allowlist in owner configuration from the digest-verified private manifest;
unsigned reports and request fields cannot widen it. Reuse committed principal
IDs and the existing D7 per-profile/epoch derivation. Scope registration CAS to
`/itonami/identity/v1/`; never reuse occurrence grants or funding keys. Keep the
root secret and recovery credential in owner Keychain items; encrypted seed,
private registry and aliases belong to the owner store. A missing/invalid key
or marker in an initialized namespace is recovery-required, never new identity.
Fixture credential/ledger ports must be explicit and may not be a production
fallback. Native recovery export requires an explicit owner command and a new
target, excludes live credentials, and produces a separate private owner key;
never expose that operation through the browser API. Preserve previous roots,
histories, service configs and recovery evidence. Same-UID host compromise,
independent hardware recovery, portable key import and distributed alias writes
require their own qualification; a local/keychain test does not prove them.

### Meiji recovered production execution (AWAI-2820)

Keep the recovered ledger, original cron phase, node identities and read-only
history disks intact. The recovered owner-side coordinator only wakes the
original ledger schedule; computation runs on enrolled Meiji guests. Do not
describe this as autonomous guest scheduling or fleet-wide liveness. Routine
recording uses its read-only etcd identity; root credentials are maintenance only.
The jacob Kapitsa public-result reviewer is a separate scoped service, not an
expansion of deterministic physics Bot grants. Model text is an artifact, never
a command or capability. Unknown HTTP outcomes stay held. A known pre-HTTP
failure may resume only its original owner/input using explicit reviewed
evidence and a one-time CAS recovery marker; never reset the claim to retry.
Persist model counters with their exact run binding; missing counters remain
unknown. Show output-limited or unqualified review text as a draft. Stale
observations must not imply current execution. Keep private custody backups
encrypted in AwaiVol; a Keychain-dependent decrypt check is not independent
disaster recovery.
