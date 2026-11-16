# Murakumo NixOS

Follow the workspace-level AGENTS.md architecture and Linear tracking rules.

## Awai experience defaults (owner decision 2026-11-16, AWAI-2962)

- Deliver the Awai-defined experience first. Initial setup is not a preference
  questionnaire: do not expose sound, motion, theme or appearance controls on
  welcome/account setup. Put customization in the relevant post-setup settings.
- Use the defined subtle sound/motion and Asa brand defaults without asking.
  Honor OS mute/volume and reduced-motion automatically. User-requested settings
  and accessibility are retained; defaults do not override them.
- Share the logo's atmosphere across entry backgrounds, surfaces and emphasis:
  pale blue, lavender, warm light and restrained red; avoid a boxed logo on an
  unrelated canvas. Reuse shared tokens and components in code and Figma.
- Particle motion uses only shiro #ffffff, ao #1e50a2, aka #bc002d and kuro
  #14110f with alpha. Express depth through density, size and transparency,
  not extra orange/neon hues. Assemble, focus, confirm, transfer and open are
  contextual product motions, not five user-selectable modes. Keep them finite,
  semantic controls immediately usable, and reduced-motion static.
  The current five particle studies are DEFERRED / NOT ADOPTED by the owner
  (2026-11-16): preserve them as design references, do not connect them to the
  default setup or ship the motion lab in the OS image. Resume only on a new
  owner request. Standard non-particle entry UX is a separate review unit.
- Setup collects only what is necessary to proceed. Detect language and an
  existing network when possible. Show choices when action is actually needed,
  preserve consent for external operations, and never infer encryption/recovery
  success from account login or hide a real security failure.
- The intended account-linked protection avoids an additional routine disk
  passphrase. Keep current encryption/key slots until the replacement's unlock,
  recovery, update and rollback gates pass. See AWAI-165 and the experience doc.

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

Screen-bearing apps (kaisha/kaikei class) are taken in as MCP Apps-style
iframes, not as vendored code (ADR 0026 D12; owner decision 2026-11-15,
AWAI-155): `itonami.dapp.v1` operations with `ui://` screens in a sandboxed
iframe over postMessage JSON-RPC, CSP derived from `remoteOperations`, and the
shared `each-operation` consent. No `window.openai`, no server-held business
state, no ChatGPT approval. The Hermes `mcp_servers` route (D14) is for
agent-invoked tools, not for apps with a screen. Implementation is still open;
this records only the intake choice.
