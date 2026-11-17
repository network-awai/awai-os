# Readable Awai shell docks — 2026-11-17

JUN-1340 repairs the shared UI migration while retaining Core/Apps/System and the left/right dock membership and handlers. Existing button decoration incorrectly matched nonexistent device-dock/node-dock classes, making the real dock-button/account-button primary actions while their child text retained low-contrast legacy colors. Flex shrink collapsed ordinary words, and fixed overlays covered the account/composer.

Figma design before implementation: file umqCqP5KSjLWh9fhCI1HaN, existing baseline216:476 unchanged; dock detail277:891(Light),277:923(Dark),277:954(390phone). Reused Android v2 tonal Button198:1261 and its existing tokens/Noto Sans JP14/52px. Local Desktop Figma was used after the connector required reauthentication; no baseline/library source was replaced.

The owning adapter now classifies actual dock/account controls as tonal, close controls as text. A reserved grid footer contains left/right dock groups; labels/values inherit a legible foreground, preserve words and wrap at the button level. At small widths the groups occupy successive rows. The footer includes safe-area padding, panels anchor above it, and main/account/composer use the remaining row rather than being covered. Same buttons, routes, expanded-state attributes and React event handlers; no domain, auth, external-operation or permission change.

Modern Web Guidance: form-factor-adaptation, accessibility and color. Native button keyboard behavior retained; minimum52px height, no fixed text height, minimum4.5:1 normal text contrast to be measured for all themes, focus outline retained. Container row geometry, keyboard operation and actual device acceptance follow below; compile/tests alone do not qualify them.
