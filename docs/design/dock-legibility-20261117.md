# Readable Awai shell docks — 2026-11-17

JUN-1340 repairs the shared UI migration while retaining Core/Apps/System and the left/right dock membership and handlers. Existing button decoration incorrectly matched nonexistent device-dock/node-dock classes, making the real dock-button/account-button primary actions while their child text retained low-contrast legacy colors. Flex shrink collapsed ordinary words, and fixed overlays covered the account/composer.

Figma design before implementation: file umqCqP5KSjLWh9fhCI1HaN, existing baseline216:476 unchanged; dock detail277:891(Light),277:923(Dark),277:954(390phone). Reused Android v2 tonal Button198:1261 and its existing tokens/Noto Sans JP14/52px. Local Desktop Figma was used after the connector required reauthentication; no baseline/library source was replaced.

The owning adapter now classifies actual dock/account controls as tonal, close controls as text. A reserved grid footer contains left/right dock groups; labels/values inherit a legible foreground, preserve words and wrap at the button level. At small widths the groups occupy successive rows. The footer includes safe-area padding, panels anchor above it, and main/account/composer use the remaining row rather than being covered. Same buttons, routes, expanded-state attributes and React event handlers; no domain, auth, external-operation or permission change.

Modern Web Guidance: form-factor-adaptation, accessibility and color. Native button keyboard behavior retained; minimum52px height, no fixed text height, minimum4.5:1 normal text contrast to be measured for all themes, focus outline retained. Container row geometry, keyboard operation and actual device acceptance follow below; compile/tests alone do not qualify them.

## Runtime verification

Physical Awai Android API37 x86_64 / Ryzen7735HS, display1920x1200: seven tonal dock controls pass bounds, label clipping, mutual overlap and reserved-main-row checks. Minimum text contrast is6.392:1 in Asa/Hiru and7.836:1 in Yoru. All seven panels open/close within desktop bounds; native Enter on focused Wallet opens its panel. WebView metric emulation at390px,320px and320px with200% root text also passes. These are viewport checks on the physical device, not a separate phone or TalkBack certification. Visual screenshots were inspected against the existing tonal Figma detail states.

[Desktop](evidence/jun-1340/dock-desktop-final.png) · [390px](evidence/jun-1340/dock-phone-390.png) · [Measurements](evidence/jun-1340/dock-check.json). The enlarged320px footer takes additional height; the remaining main region scrolls.

Normal network.itonami.app was updated in place with its matching existing developer signer. The installed APK was pulled back and exactly matches SHA25633db8f2f6eb72de6420f420879bfe21ca1b2df7f38a848ffad352d5db115b613,32884535bytes. Both normal apps' noncache private-file hashes match before/after the install, before first launch. No clear/uninstall, owner authentication, PIN change or reboot. Post-auth UI checks use separately signed test-only QA packages without INTERNET permission; they do not claim authentication as the real owner.

Shell tests108PASS; shared UI tests7PASS; shell HTTP build, Itonami packaging, serial Android normal/QA builds succeeded. Early parallel builds collided in shared Kotlin cache; final serial builds passed without changing global cache/config. First keyboard probes using CDP key events did not activate; the final native Android Enter check did. Failed logs are preserved privately.

Normal installed APK, actual QA behavior, source tests and merge are separate evidence. Unique raw reports, fixture signing dependencies and build failures remain in the task worktree; no cleanup deletion.
