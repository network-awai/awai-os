# Installer back navigation

Escape invokes the active graphical screen's Back action. Network selection returns to its parent; Wi-Fi password entry returns to the SSID list; a hidden network password returns to SSID entry. Cancelling disk selection returns to network setup. Cancelling erase confirmation returns to disk selection without erasing. Cancelling the registration QR closes its poll and returns to setup choices, preserving an existing local completion or account receipt.

Escape never implies offline-install consent or acknowledges a completion dialog. Busy/progress screens have no Back action; disk formatting and writing cannot be interrupted by this navigation shortcut. The visible Back button and voice Back action share the same backend result.

Validation: 99 Node tests cover routing, network cancellation, registration cancellation, preserved local completion, disk safety and update regression checks. Graphical key routing executes the actual GJS source with GI stubs; native GTK keyboard delivery and physical PC operation remain unverified.

Delivery boundary on 2026-10-08: production stable feed is sequence 4 (source efb39056e3b3abc5b5673b9ec5d55a19b5c3dc20). This navigation change requires a new ISO/NAR release before it is present on USB or downloadable by a Node. A published feed does not establish automatic updates on a physical device; the intended NixOS target and its owner configuration still need verification.
