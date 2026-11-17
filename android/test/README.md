# Unattended Android authentication regression (AWAI-3011)

Run from the repository root on an Apple Silicon development Mac with the installed
AOSP API 35 arm64 system image, Android SDK, Node, and the owning shell's locked
`npm ci` dependencies:

```sh
node --test android/test/emulator-scope.test.mjs
npm run test:inference --prefix nixos/otehon/shell
node android/test/run-auth-emulator.mjs --apk=/absolute/path/to/itonami-arm64.apk
```

To include the actual local inference UI (no human authentication), supply the
previously built provider APK and public pinned GGUF already present locally:

```sh
node android/test/run-auth-emulator.mjs --apk=/absolute/itonami-arm64.apk --provider=/absolute/murakumo-arm64.apk --model=/absolute/Qwen3-0.6B-Q8_0.gguf
```

This seeds only the public model fixture into the disposable provider's private
storage; the normal native Load still verifies its digest. It drives the actual
Core panel, denial and fresh confirmation dialogs, real llama.cpp generation,
and release. It does **not** claim SAF import or model-download coverage.

The runner creates a **new, disposable AVD** for each invocation. It refuses an
occupied port; use `--port=5574` to select another even emulator port. It checks the
AVD name, emulator hardware, emulator property, exact serial and locally created
ownership marker before installing anything. It never reuses the owner-linked
`Awai_Setup_API35` VM and rejects physical USB/network serials. All device commands
specify the owned emulator serial. It does not modify 6600H, Moto, Nix, NVMe or ESP.

The **unchanged normal APK** runs in a separate Android installation/storage
boundary. No test signing key, accepted-account flag or test authentication
endpoint is compiled into the app. A host-only CDP fixture imports the exact
production device-key, signature and session modules, generates a new nonexportable
device key in this VM, and receives signatures from random software wallet/passkey
keys held only by the Node test process. Failed verification cannot save a session.
The fixture disappears on reload/restart, which the runner checks. No owner key,
profile, session, PIN or AVD data is copied. Cellular and Wi-Fi are disabled before
first app launch; the real relay and browser-operation consent are not invoked.

Coverage: rejected signature, other-device binding, expiry, passkey origin/user
verification; valid wallet and software-passkey signatures; actual trust/completion
buttons and authenticated shell; retained proof revalidation after process restart.
This tests a software authenticator, **not** hardware WebAuthn enrollment, actual
phone transport, production relay availability or the owner's final acceptance.
Inference-engine, Home/PIN and physical-device acceptance have separate evidence.

Each run writes APK digest, source revision, per-case results, timing, scope,
screenshot and emulator logs below `.agent-output/qa-*/`. Failures return a nonzero
exit status and retain diagnosis data. Test keys and complete proof payloads are
not included in reports. The newly started emulator is stopped at the end; its AVD
and artifacts are preserved, never automatically deleted. Review these separately
before cleanup. GitHub Actions remains owner-disabled; a local pass is not CI.

## Durability boundary discovered by the test

Immediate `am force-stop` after the completion click reproduced loss of the recent
`otehon.setup.v1` localStorage write while the earlier verified account proof
survived. This is an observed abrupt-process-stop gap, not evidence that a new
owner signature is needed. The normal-lifecycle case backgrounds the app for 6.5
seconds before process restart and records that boundary explicitly. Use `--restart=abrupt` to run the failing immediate-stop reproducer instead of
the normal background lifecycle. Neither
case qualifies OS cache loss or physical power interruption. Follow up under the
existing AWAI-3004 setup work; do not replace this evidence with a mocked result.
