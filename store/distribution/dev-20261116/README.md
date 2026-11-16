# Itonami Store development distribution

Immutable development Yotei APK and signed catalog envelope for AWAI-2977. The catalog revision is 100, app versionCode 4 / 0.1.3. Envelope signature covers the exact UTF-8 `raw` string. The trusted host pins the public key independently; a key inside downloaded metadata is never accepted. Artifacts must be selected using this directory's exact Git commit, with digest verification and fresh canonical download consent, followed by independent native/OS install confirmation.

This uses the existing Android debug publisher identity and 30-day metadata expiry. It is a development preview, not production key management, revocation, multi-publisher release or Google Play compatibility. Public distribution contains no user state, credentials or private signing key. Native Nix/Waydroid installation and selected sync remain separate work. NixOS browser Yotei is bundled with the shared client.
