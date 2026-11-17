# AWAI-2997 physical PIN RRO — 2026-11-17 JST

Chat01a1e187-0e12-7813-b500-73aa77f2a03e. Base883fa89; exact admitted SystemUI/artwork/build-manifest hashes and source revision are in target.json. Hardware identifier/credential/private payloads omitted.

## Implemented and observed

- Figma rest231:1473, error231:1524, waiting231:1574. The request's original-art background and native keypad placement use a resource-only mutable RRO:80dp keys,24dp horizontal and16dp vertical gaps. Native prompt, live password display, retry/timeout and emergency components remain the original installed implementation. Native delete/enter icons remain native, rather than the prototype's text labels. No custom authenticator, PIN collection, DEX or new overlay permission.
- Device `/product/etc/build-manifest.xml` binds frameworks/base to22de88b7b8eb979c816669c7963dee66ae4953cd. Original SystemUI SHA-256 e2f43a18f0e9cfeee1131120f718ab127544c39f0de3bd7729aad39f152b0a4a and Lineage signer59988fff31e2f85fbaddc5b37704be97d1c5b7db72a4fb2ed5f07b58ccf20ccf are unchanged.
- SDK build/signature and all native view ID/class/input-binding checks passed; wrong-target build was rejected. Ordinary APK installation was rejected by the expected signature/no-overlayable policy. No bypass was used.
- On-device ResourcesLoader probe resolved both layouts' native root and input IDs, independently resolved the RRO namespace, and rendered the native background. RRO is linked as a shared resource library to avoid0x7f namespace collision.
- Recovery ADB and Mount /system provided the existing logical mappings. Only `/system_ext/overlay/AwaiPin/AwaiPinOverlay.apk` was added with the existing vendor_overlay_file label. Source/destination and original SystemUI hashes were checked; mount restored read-only/unmounted. No userdata/credential, boot/vbmeta or original APK write; no persistent root service/module.
- Recovery's reduced toolset lacks awk: the first placement attempt stopped before remount/write; the utility now uses shell field splitting. Mount /system caused ADB reauthorization; owner re-enabled Recovery ADB. Failures are preserved in raw evidence.
- First normal boot registered the RRO disabled. Activation selected both `res/layout-port/awai_pin_*.xml` resources, but the owner initially saw cached appearance; old PIN still unlocked. A subsequent normal reboot retained the enabled overlay and the owner **confirmed new background/key placement and successful unlock with the existing PIN**.
- Cold boot_completed1 and12 SystemUI PID samples at2-second intervals were stable. Overlay artifact SHA-256 ef3b34a6d5b5d7b872d1d3043bd7ab4a2d2bda8e9422a6d4c06756b8804c0ce2 (1197011 bytes). The package was admitted from the system_ext path, not installed as a privileged data app.
- Before/after checks match Home/Store/Yotei/SystemUI UIDs and versions, file encryption, lockscreen enabled, slot_b and existing verity-disabled/orange state. The owner has **not yet confirmed app-content retention** (answer: not yet known). Metadata/no-data-write evidence is not full app-content verification.

## Scope and remaining acceptance

Native error/lockout logic and input state were not replaced and no failed PIN attempt or emergency call was induced. Full biometric/SIM/emergency/lockout/200%-text qualification remains unmeasured. The geometry-only accessibility probe returned no allowlisted key nodes; that is unavailable automated geometry evidence, not a passing pixel comparison. Physical appearance and existing-PIN acceptance come from the owner's direct confirmation. No screenshot protection was disabled.

App-content readback remains an operational follow-up. The code change does not justify claiming every private application datum was checked. No data wipe/restore, signing-key migration, boot trust downgrade, root package or encryption change was performed. Future SystemUI/OTA revisions need a new pin/admission; do not blindly reapply this exact overlay to another build/slot.

## Rollback and evidence

Normal Android: `adb -s DEVICE shell cmd overlay disable --user 0 network.awai.systemui.pin`, followed by normal reboot to discard cached views. For removal, enter Recovery, enable ADB, mount system mappings and run `recovery.py --serial DEVICE --apk QUALIFIED_APK --action remove`; it checks exact slot, verity state, artifact/target hashes and removes only the introduced APK/directory. No unattended generic partition command is provided.

Raw build/probe/install/activation logs, decorative background render, baseline/readbacks and the unmodified target APK are retained privately in the task evidence. No exact-head CI claim; GitHub Actions owner-disabled. Provider/model/settings attribution, token forecast/actual counters, estimate/unit, active/wait elapsed and cost are unknown. Native runtime observation window is not issue velocity.
