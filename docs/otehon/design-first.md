# Awai Otehon: Figma design first

Owner decision: 2026-11-16. Tracking: [AWAI-538](https://linear.app/kotobalabs/issue/AWAI-538).

## Baseline and authority

[Baseline v1](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=216-476)
preserves the original Otehon desktop composition from awai-os `392792f`.
The editable master is node `216:475`; the review instance is `216:476` on
page `215:2`. [ui-baseline.json](ui-baseline.json) pins source and local build bytes.
The reference viewport is 1920 × 1113. It contains 90 editable text layers,
a reusable shell component and 87 bindings to existing brand variables.

This is an isolated local rendering with generated test identity and synthetic
service status. It contains no owner's wallet, keys or conversations. It is not
a screenshot of a restored physical desktop, proof of connectivity, model
availability or accepted product behavior. Physical restoration remains pending.
Earlier desktop proposals remain historical references. The separate Bots/Apps
layout in file `EFljF3PXOrrVNM2v9Wdis1` is not the baseline.

The owner selected Figma as the source of truth for UI composition. Code is the
source of evidence for implemented behavior. Report differences explicitly;
do not silently replace the design with whatever the latest code renders.

## Preserve these boundaries

- Upper-left product name: Awai. Keep Core / Apps / System navigation, current
  context selection and the existing account entry.
- Keep the Manimani conversation and right-hand activity area; keep account and
  node docks and the top-right network status. Preserve existing theme behavior,
  fonts and brand tokens. Do not introduce a second desktop shell.
- Add owned Bots and Bot creation within the existing Bot workspace. Add Gaka
  and the other creative apps within Apps. Model download/load/release and
  Awai FS results belong to their existing work context or detail panel.
- First-run setup offers the defined experience. Sound and motion preferences
  belong in later settings; respect mute and reduced-motion accessibility.
  Particle motion remains deferred.
- Preserve back navigation, failure/retry and offline states. Distinguish Wi-Fi
  association, Internet connectivity and relay connectivity.
- Show temporary versus persistent sessions accurately. Do not erase account
  linkage merely as an incidental effect of a candidate feature. Do not invent
  authenticated state or bypass signature verification to reproduce a screen.

## Change sequence

1. Read the pinned baseline and relevant source. Identify only the affected
   surfaces and states; record the Figma node links in the existing Linear issue.
2. In Figma, create a clearly named proposal alongside the baseline. Reuse its
   shell and tokens. Include loading, empty, busy, error, retry, denied and success
   states that the feature actually needs. Keep the baseline unchanged.
3. Compare the proposal with the baseline. Ordinary additions inside the existing
   structure can proceed under the owner's task authorization. A change to the
   navigation, shell composition, first-run steps or visual identity requires an
   explicit owner design decision before implementation/deployment.
4. Implement the linked proposal in the existing `.cljc`/ClojureScript surfaces.
   Preserve browser-owned state and the canonical operation-consent broker.
   Figma does not authorize external operations, erase disks or grant capabilities.
5. Render the candidate at the reference viewport and the physical device's
   viewport. Compare regions, hierarchy, text, spacing and tokens; explain any
   intentional differences. Exercise the affected flow and rejection paths.
6. Record Figma nodes, source commit, artifact digest, rendered evidence and check
   results in the PR. A passing build does not prove visual fidelity. Label any
   missing comparison as unverified, never as passing.
7. Before changing the active 6600H desktop, retain the prior artifact and use a
   separate preview. Do not reuse or copy the owner's identity for design fixtures.
   Verify physical screen, input, back navigation and state persistence separately.
   Update Linear and the existing feature spreadsheet with observed outcomes.

## PR review evidence

- Baseline and proposal node URLs; affected states and unchanged shell boundaries.
- Before/after renders with viewport, source revision and artifact digest.
- Functional checks and actual physical acceptance (or an explicit pending state).
- Confirmation that existing keys/state and operation consent were preserved.

This is a review and delivery contract, not an automated pixel-diff gate. No such
CI gate is claimed by this change. Baseline promotion needs an explicit owner
design decision; do not automatically recapture changed code over the baseline.
