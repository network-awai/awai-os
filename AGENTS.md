# Awai OS

Follow the workspace-level AGENTS.md architecture and Linear tracking rules.

## Repository layout

| Path | Contents |
| --- | --- |
| `android/` | Awai OS on Android AOSP: Home, Store, setup, SystemUI overlays, desktop PC work |
| `apps/` | Existing in-tree integrations and pointers to independent app repositories |
| `dapps/` | Otehon dapps (D1, reward loop, Saifu, Sanka, Wellbecoming) |
| `otehon/` | Itonami shell UI shared with Android, and Otehon fleet sources: Meiji, Bot fleet, Soshiki, storage |
| `packages/`, `store/`, `distribution/`, `deploy/` | Shared packages, signed catalog, distribution Worker, awai.link relay |
| `ci/`, `scripts/`, `tests/` | Active checks and operator tools |
| `docs/` | Decisions, design and dated evidence (`docs/evidence/` is a record; never rewrite it) |
| `archive/` | Deprecated material kept for history; not built, not an install path |

## Product app ownership

Keep each product app in its owning repository. Its source, native host, tests,
package identity and releases are owned there. Awai OS owns AOSP integration,
Home, package discovery, Store catalog and distribution verification. Use
pinned, signed artifacts for OS integrations that need an app binary. See
[app ownership](docs/app-ownership.md) for the migration and consumer contract.

## Product OS direction — Android AOSP (owner decision 2026-11-17)

Awai OS uses Android AOSP as its product OS for phones and desktop PCs.
See [the accepted platform decision](docs/otehon/aosp-platform-decision-20261117.md)
and [AWAI-3007](https://linear.app/kotobalabs/issue/AWAI-3007). It does not change
Kotoba/Amu/AIUEOS Native qualification rules.

- Present the product only as **Awai OS** (release name `Awai OS Meiji`). Upstream
  community device trees may supply device bring-up and patches, but their
  distribution names and logos are not product branding, UI copy or
  architecture. Keep upstream license notices and pinned source references
  intact. Never relabel a third-party prebuilt image as an Awai ROM: Awai
  branding ships only in Awai's own source-built, signed release. Google Play
  services and third-party PC images are not required architecture.
- AOSP owns the OS lifecycle, permissions, connectivity, locale, screen lock,
  Keystore/storage protection and update integration.
- Phone and desktop share the Android setup state model and Figma-first UX.
  Adapt layout, keyboard/mouse/touch and hardware capabilities. Itonami remains
  an app: retain account authentication but omit repeated OS setup steps.
- Itonami is the bot runtime and its bots; Manimani is its default bot. Awai Home
  is the entry and centres on the conversation with Manimani; a swipe reaches the
  classic home. The earlier rule to preserve the Itonami Core / Apps / System
  composition is withdrawn (owner decision 2026-11-22, AWAI-3770): OS state and
  settings belong to Android and Awai OS, and apps are separate APKs reached
  through Home and Store. See
  [the responsibilities record](docs/otehon/home-itonami-manimani-responsibilities-20261122.md);
  its open items stay proposals until decided.
  Keep shared domain/policy in `.cljc`/CLJS Otehon code; native Android and pinned
  Tauri v3 adapters expose bounded platform operations. A Rust/Java adapter is
  not a new authority, consent broker or second application shell.
- Device PIN, Awai account, wallet, phone enrollment and encrypted profile
  restore are distinct. Never infer signed enrollment from connectivity or a
  completed screen; never import private keys to reproduce a design fixture.
  AOSP alone does not establish PC hardware-backed key custody or FBE recovery.
- Test source/build, Android VM, each actual device and persistent reboot
  separately. Privileged SetupWizard/SystemUI, signed ROM/OTA, rollback and
  recovery require their own evidence. An APK or RAM Live boot is not a ROM,
  persistent install, encryption qualification or accepted device release.

## Deprecated: NixOS install route and Murakumo installer

The NixOS desktop boot/install route, the Murakumo NixOS installer, the native
NixOS preview and the old Awai Node setup are deprecated (owner decision
2026-11-17) and live in [`archive/nixos/`](archive/nixos/README.md) with their
[former agent rules](archive/nixos/AGENTS.md). Do not offer them for new
installs, wire active code to `archive/`, or re-add their workflows.

- Cleanup of the old 6600H Nix files on devices follows the
  [deprecation runbook](docs/otehon/nixos-route-deprecation-20261117.md): inventory,
  encrypted preservation and dependency checks first. Preserve credentials,
  keys, profiles and active Android images. The old Nix p2 filesystem also holds
  Android's live image directory; never infer permission to wipe it.
- The Otehon NixOS profiles and modules (desktop, installer, netboot, media,
  update, backup, Bot/Meiji guest VMs, k3s, component NixOS modules and their
  VM checks) are archived in [`archive/nixos/otehon/`](archive/nixos/otehon).
  Their path references were rewritten and resolve, but they are not evaluated
  or built here. Any redeploy of an existing Nix host or guest from them is a
  deliberate maintenance action on archived code; running hosts, guests and
  fleets are unaffected by the move, and no service shutdown or repartition
  follows from it. `otehon/` keeps the shell, fleet and component sources and
  their non-NixOS Nix package checks.
- Use Android SDK/build and emulator/device checks for Android; a NixOS VM gate
  does not qualify Android. The Otehon fleet may use `.cljc`, clj/JVM, cljs,
  nbb and Babashka pinned with Nix (ADR 0026 D18); keep them out of Native.

## Awai Otehon UI: Figma design first (AWAI-538)

For Awai OS and Otehon UI work, follow [the design-first contract](docs/otehon/design-first.md).
Design affected states in Figma before changing UI code, then compare rendered
screens and verify on the target Android device or emulator. The earlier
requirement to preserve the Core / Apps / System navigation, Manimani workspace
and docks, and to implement only within the existing shell, is withdrawn (owner
decision 2026-11-22, AWAI-3770; see Product OS direction above). The
[pinned baseline](docs/otehon/ui-baseline.json) records the former Otehon
desktop composition as history; it does not constrain new screens. Do not treat
a fixture as physical acceptance.
This owner-selected Figma contract controls visual composition; source code and
tests remain evidence of actual behavior, not proof that the design is accepted.

## Otehon dapp intake (AWAI-155)

Screen-bearing apps (kaisha/kaikei class) are taken in as MCP Apps-style
iframes, not as vendored code (ADR 0026 D12; owner decision 2026-11-15,
AWAI-155): `itonami.dapp.v1` operations with `ui://` screens in a sandboxed
iframe over postMessage JSON-RPC, CSP derived from `remoteOperations`, and the
shared `each-operation` consent. No `window.openai`, no server-held business
state, no ChatGPT approval. The Hermes `mcp_servers` route (D14) is for
agent-invoked tools, not for apps with a screen. Implementation is still open;
this records only the intake choice.

## Terms: Itonami dapp and Awai app (owner decision 2026-11-21, JUN-1416)

Both follow the Awai OS specification. An **Itonami dapp** also follows the
Itonami Agent bot specification: it has an AI agent bot profile, has a
decentralized wallet and a DID, and operates autonomously. An **Awai app**
(Awai OS app) is a Tauri app without a bot; it may still expose MCP, API and
similar interfaces. Classify by whether a bot profile exists: a Tauri app that
gains one becomes an Itonami dapp and must then meet the wallet, DID and
autonomy requirements. Use these names in new documents, issues and lists. Do
not rename existing identifiers (Itonami Store, `itonami.dapp.v1`, dapp carrier,
repository names) for this reason alone. The distinction changes no permission,
consent, distribution or key-custody contract. Canonical text:
`network-awai/network-awai-apex` `docs/itonami-dapp-distribution-index.md` §0.

## In-app storage on Awai Android and Itonami dapps (AWAI-3386)

Follow [the shared app storage contract](docs/otehon/app-storage.md). Use
AwaiFS/WNFS for private snapshots, Kotobase for basis-bound graph queries,
and Yataverse for verified ciphertext blocks over the applicable Awai
Network transport. Reuse the owning SDKs and app-scoped host capabilities.
Keep private indexing and key custody within the authorized client. Route
external browser operations through the canonical Kotoba broker and fresh
per-operation consent. The current bounded Drive owner-store profile and the
WNFS migration have separate readback and release evidence.

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
  adapters in `.cljc` under `otehon/meiji/src/`; desktop views and the
  local IPC client live in `otehon/shell/src/meiji/` so the existing Nix
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

Apply [the shared UI rules](docs/design/interface-principles.md) and the
[Awai design system](docs/design/awai-design-system.md) (tokens, components and
shared rules, AWAI-3402) to Awai OS and its bundled apps. Prefer recognizable controls, hierarchy, selection feedback
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
