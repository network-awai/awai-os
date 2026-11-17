# Unattended hardware QA (AWAI-3030)

Normal Itonami authentication remains unchanged. Real-owner enrollment is a
separate acceptance test. Debug/regression never needs the owner to approve a
relay request or sign a phone challenge.

`prepare-qa.mjs` copies committed product sources and their verified owning-UI
bundle into task output. It derives **network.itonami.app.qa** and
**network.awai.murakumo.qa**, test-only labelled apps, without changing the product
sources. Only identity, label, permission/authority and caller boundaries differ.
No authentication bypass, test signer or accepted-account flag is packaged.
QA apps have no INTERNET permission and share a dedicated QA signing identity
that differs from the normal development signer. JNI class namespaces stay the
same; Android application IDs, UIDs, WebView storage and native files are isolated.
The host-only fixture uses fresh random software wallet/passkey signatures and
the exact production device-key/verifier modules inside the verified QA process.

Prepare native libraries/UI from the owning source as for normal builds, then:

```sh
node android/test/prepare-qa.mjs --target=aarch64
node android/test/prepare-qa.mjs --target=x86_64
```

Each prints a `QA_MANIFEST` path. JDK21, Android SDK/NDK27 and installed locked
Node dependencies must be supplied through their normal environment variables.
The derived-build receipt binds product revision, transformed source hashes,
recipe digest, APK digests and separate QA signer. Private QA signing material
stays in `.agent-output/qa-signing/`; do not publish or commit it. Normal builds
are not changed. Failed staging can resume only with its matching ownership
marker via `--resume=/absolute/isolated-qa-...`.

First run an independently created disposable ARM64 emulator:

```sh
node android/test/run-qa-device.mjs --serial=emulator-5574 --mode=owned-emulator --manifest=/absolute/ARM64/manifest.json --model=/absolute/Qwen3-0.6B-Q8_0.gguf
```

The runner refuses an occupied serial and creates a new AVD; it never reuses the
owner-linked VM. The actual AOSP system HOME/provisioner settles its initial
state before baseline capture; no shell write to provisioning flags is used.

After exclusive physical handoff and preserving real app data:

```sh
node android/test/run-qa-device.mjs --serial=10.77.0.2:5555 --mode=physical-6600h --manifest=/absolute/X86_64/manifest.json --model=/absolute/Qwen3-0.6B-Q8_0.gguf --boot-route=/absolute/active-route.json --boot-manifest=/absolute/artifacts.json
```

Admission checks the explicit serial/MAC, actual APK manifest/testOnly/network
permissions/digest/signer and product-source-tree equality. Software fixtures are
injected only after PID/cmdline checks in QA apps. Only previously marked QA data
can be reset; a pre-existing unowned QA package refuses execution. Never run
fixture/reset commands on the normal app IDs. No Wi-Fi, PIN or provisioning flags
are set. A physical reboot affects the real OS and requires a verified persistent
boot route/server; the test does not qualify an offline EFI installation.
Before app mutation, physical admission checks the recorded active TFTP path,
all three pinned artifact hashes, direct LAN link/address and static HTTP HEAD
responses. The file route is checked again immediately before reboot. Missing
or collected boot directories refuse admission. Reboot timestamps and old/new
boot IDs distinguish an app failure from a device that never returns. This
preflight cannot guarantee firmware boot order, DHCP health or recovery from
physical link/power loss; those remain separately observed infrastructure gates.

The test drives signature rejection/acceptance, Trust/Finish, immediate force-stop
without a flush delay, real OS reboot/relaunch, actual Core/native inference
confirmation denial then generation, model release and sign-in refusal after the
QA proof is removed. Native confirmation buttons are selected by **QA package and
resource ID**, not another app's dialog. Screenshots capture only the QA WebView
and carry a QA watermark. Private UI XML stays in a shell-private file, not public
storage. Normal app-state hashes, five physical peer/encrypted-store witnesses and
provisioning values must match afterward. Output reports/logs stay private in
`.agent-output/qa-device-*/`; publish only curated result/digest summaries.

Evidence is **QA-derived** on the named runtime. It is not hardware Passkey
registration, real-owner consent, physical power-loss qualification, production
signing or proof that the normal owner profile has completed enrollment.
