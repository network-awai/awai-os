# Shared Itonami Store client

This opt-in NixOS module uses the exact static browser client and compiled `.cljc` domain shipped in the Android hosts. It serves only static files on loopback and provides a Chromium desktop entry. No app-origin handler, per-user API or Android bridge is exposed. The browser version enables the already bundled Yotei web app in local browser state; it does not install APKs, Waydroid images or native Nix packages.

Create a fresh export after the Android build:

```sh
python3 android/export-web.py .agent-output/android .agent-output/shared-web
node otehon/itonami-store/verify-bundle.mjs .agent-output/shared-web
```

Import `module.nix`, enable `services.awai-itonami-store.enable`, and set `services.awai-itonami-store.bundle` to an immutable copy of that export. The Nix build verifies every declared asset digest and refuses extra files and symlinks before copying the static bundle. Bundle trust and catalog public-key distribution remain part of release review; a self-contained hash manifest is not independent publisher authentication.

This development export uses the Android debug identity and a 30-day catalog expiry. Keep the browser data directory to preserve local Yotei state. No network sync or Google Play API compatibility is claimed. Browser operation was checked in Chrome on macOS; a NixOS module evaluation/build/boot remains unverified on this host, which has no Nix executable. This module is not enabled in existing images or deployed to existing nodes.
