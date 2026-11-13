# Awai interface principles

Owner request: 2026-11-13. Tracking: AWAI-2860. Applies to Awai OS and bundled
apps, including Soshiki. The architecture, authorization and consent contract
in workspace AGENTS.md remains authoritative.

## Content before commentary

A screen should lead with its subject, current state and useful actions. Use
familiar controls, a clear selected state, grouping and direct feedback.
Permanent tutorial paragraphs, internal terminology, implementation caveats
and explanations of the layout do not belong in the normal working view.
Keep engineering rationale and qualification boundaries in project documents.
A short empty-state action may guide the first use; it should disappear once
there is useful content.

Show secondary facts in a labeled disclosure or inspector. Label the control
with what opens, such as “Run details” or “Source schedules.” Prefer structured
facts to prose: label, value, timestamp and source. Do not replace paragraphs
with an equally dense collection of badges or tooltips.

## Keep decisions honest

Unknown, not measured, stale, held and failed are distinct states. Keep the
current state visible as a short label and pair color or motion with text.
Configured jobs are not uptime or successful business outcomes. A confirmed
receipt is historical evidence, not an execution heartbeat. Preserve those
meanings without repeating cautionary prose across every card.

Display actionable errors near the affected control. Preserve the required
operation-consent disclosure immediately before an external operation; explain
its endpoint, operation and data categories there. Do not hide a decision's
consequences behind optional help or infer authority from Circle membership.

## Language as a component

- Store interface copy behind stable semantic keys. Keep Japanese and English
  key and named-placeholder sets aligned.
- Translate complete messages. Avoid concatenating a quantity, unit and verb
  in a fixed source-language order.
- Use familiar, concrete action labels. Avoid implementation vocabulary and
  language-specific abbreviations in primary controls.
- Format dates, numbers and plural messages by locale. Keep time zone/source
  available where it changes the interpretation.
- Allow text to wrap and containers to grow. Test longer English labels and
  Japanese line breaking at phone and tablet widths; do not shrink labels to
  fit a fixed box.
- Keep imported names, profile purposes and user messages as content. A UI
  language switch must not rewrite that content.

## Interaction and accessibility

Provide visible focus, selected and expanded states. Controls need accessible
names, comfortable targets and keyboard operation. Do not rely on hover-only
help, unlabeled icons, color alone or animation alone. Honor reduced motion.
Use logical reading order and logical CSS properties where possible so a later
right-to-left locale does not require a new information architecture.

The main view should answer “what is here, what is happening, what can I do?”
without a tutorial. Its inspector can answer “why, when, where, and with what
proof?” when the person asks.

## Reference and interpretation

[Apple HIG: Writing](https://developer.apple.com/design/human-interface-guidelines/writing)
recommends familiar, concise language, action-oriented labels and writing with
accessibility/localization in mind. [Apple HIG: Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)
recommends revealing secondary detail when relevant. We apply these principles;
we do not reproduce an Apple visual asset or claim platform certification.

[Nintendo's Kirby and the Forgotten Land developer interview](https://www.nintendo.com/jp/interview/arzga/04.html)
describes designing UI in English to account for longer localized text and
sharing detailed context with localization teams while exposing only necessary
information during play. This is a concrete product example, not a published
Nintendo-wide design-system specification. Awai's interpretation is to keep
translation context in the dictionary/docs and validate expanded text early.

## Current implementation coverage

AWAI-2860 applies these rules to Soshiki's primary fleet overview, Circle map,
activity inspector, Goal cards and shared header. Japanese and English UI copy
for these surfaces lives in `ui-copy.js`; the language preference is a local
UI setting. This is not a claim that all legacy organization editors, bundled
apps or imported profile content are translated. Bot conversation/state storage
is owned by the parent implementation; these rules do not move it into the
browser or redefine persistence.
