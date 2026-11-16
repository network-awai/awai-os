# Awai phone-link design proposal

Owner request, 2026-11-16: bring `awai.network/link` into the Awai brand world.
Tracking: [AWAI-538](https://linear.app/kotobalabs/issue/AWAI-538).

[Figma flow](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=220-2)
uses the original Awai logo, Noto Sans JP and existing buttons. Blue and warm red
light extend into the white background; the content stays editable.

| State | Figma node | Behavior to preserve |
| --- | --- | --- |
| Compare code | `220:2` | Confirm matching PC code before enabling authentication |
| Authenticate | `220:25` | Passkey primary; wallet alternative; explicitly label new key registration |
| Deliver link | `220:48` | Actual asynchronous delivery state; no premature success |
| Complete | `220:66` | Return to the PC; link success does not grant later operation consent |
| Expired | `220:83` | Ask for a fresh PC code; preserve existing account and keys |
| Relay failure | `220:100` | Separate network failure from invalid authentication; allow retry |

All mobile frames are 393 × 852, with 54 editable text layers and five existing
button instances across the flow. The confirmation code is an illustrative
fixture, not a real link. Code comparison, signature verification and fresh
relay-operation consent remain mandatory. Secrets stay on the person's device.

Source surfaces: `shell/src/link/main.cljs`, `shell/src/shell/styles/link.cljc`.
This is a design proposal, not a public deployment or an authentication change.
Desktop-responsive layout and real-device accessibility are still unverified.
Follow the shared [design-first workflow](design-first.md) before implementation.
