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

## Durable completion and restart acceptance

The original immediate-stop marker loss is now a regression case. Tauri exposes
only fixed `read`/`complete` operations for a non-secret app-private marker. The
native writer syncs its file, atomically renames it and syncs the directory before
acknowledging; the UI opens Home only after that acknowledgement. Unknown/corrupt
records and I/O failures refuse completion. An existing browser marker migrates
through the same native commit; account verification remains a separate gate.

`--restart=abrupt` force-stops immediately after observing Home, with no background
or flush delay and no pre-stop screenshot delay. The runner verifies the retained
marker/account after relaunch, then actually reboots its guest OS and verifies them
again after app relaunch. Finally it removes only the disposable test account and
checks that completion cannot bypass sign-in. This is process-stop/guest-reboot
evidence, not physical media power-loss qualification or OS default-Home launch.

## Exact-revision operator CI

Actions stays disabled. The bounded Android lane runs on a reviewed Mac using
its already installed SDK35 image, NDK27, JDK21, Rust, Python, Clojure and Node:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME=/Users/junkawasaki/Library/Android/sdk \
ANDROID_NDK_HOME=/Users/junkawasaki/Library/Android/sdk/ndk/27.0.12077973 \
node ci/android/run.mjs --revision=FULL_EXPECTED_COMMIT --model=/absolute/Qwen3-0.6B-Q8_0.gguf
```

The controller refuses an incorrect revision or dirty source. It installs locked
npm dependencies, executes source/Rust/advanced checks, builds the owning shell,
both ARM64 apps and pinned native engine, then runs the full immediate-stop/OS
reboot/inference VM acceptance. Each stage has a 20-minute upper bound. Missing
public model/source/dependencies fail closed; dependencies may be fetched during
bootstrap and this is not an offline/hermetic or distributed-quorum claim.
Result receipts bind revision, artifact/report hashes, stage exits and timestamps.
An operator may project the receipt to the same GitHub commit status only after
verifying success and unchanged PR head. No Actions enablement, scheduler, release
signing or production deployment follows from this lane. PR receipts record the
actual result; a pipeline definition alone is not a pass.
