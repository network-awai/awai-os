# Awai PIN RRO — AWAI-2997

Code-free, mutable appearance overlay for the **exact admitted SystemUI APK** in `target.json`.
Its original classes, view IDs, input target, digits, accessibility traversal and emergency include remain native. No DEX, permission, service, receiver, credential implementation or PIN text is introduced. Portrait adjusts the two existing native PIN layouts; landscape retains upstream layout. Native prompt/error/timeout behavior remains the installed implementation. Figma's six dots are illustrative, never a replacement for the live password view.

Reference: [Figma normal/error/waiting](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=231-1448).
Keys:80dp square, horizontal gaps24dp, vertical gaps16dp, side padding24dp. Background uses the unchanged original image with an87% light/dark scrim, scaled as a square to the pinned portrait height before center crop. Native delete/enter buttons and status labels remain native; the request's background/key placement is the target, not a replacement authenticator.

`upstream/` preserves the Apache-2.0 Lineage/AOSP layout source at framework revision22de88b7b8eb979c816669c7963dee66ae4953cd, obtained from the device's own `/product/etc/build-manifest.xml`, not branch HEAD. Upstream license notices remain intact. `build.py` validates the exact target APK, original artwork and upstream layout digests, then checks all view IDs/classes and native input bindings. The RRO is linked as a resource-only shared library so its internal resource IDs do not collide with the target's0x7f IDs. The device resource probe verified both layouts' native root/input IDs and internal background resolution, then rendered the native drawable.

```
python3 android/systemui-pin/build.py --systemui TARGET.apk --framework FRAMEWORK-RES.apk
python3 android/systemui-pin/probe/build.py
```

The probe is a separate temporary instrumentation APK. Resource mode reads only public OS APK resources and renders the decorative background; it does not execute SystemUI authentication. Geometry mode reads only allowlisted key resource names/classes/bounds/enabled flags and never reads node text or password nodes. It does not suppress existing accessibility services.

## Deployment boundary

A normal app install was independently rejected by PackageManager because the target exposes no overlayable group and the signing certificate differs. Do not bypass that check or re-sign SystemUI. AOSP permits preinstalled system-image overlays in this case. The reviewed candidate may be placed disabled under `/system_ext/overlay/AwaiPin/` through Recovery, after verifying the target partition/APK hash and existing verity state. Do not alter SystemUI.apk, its certificate, boot/vbmeta, userdata, lock settings, encryption, Gatekeeper or keystore. No root module/service is installed. Disable the mutable overlay from normal Android before removal; the Recovery rollback removes only this exact added APK/directory after a digest check.

The older `lockscreen-design-qualification-20261116.md` statement that a matching signed SystemUI/platform rebuild is required was an earlier assumption. Source and device inspection identified the preinstalled RRO alternative. That document's original observations remain historical evidence; it has not been silently rewritten. Recovery placement, cold restart, physical background/key placement and existing-PIN unlock are now qualified in device-qualification-20261117.md. App-content readback remains unconfirmed.

Sources: [AOSP RRO restrictions](https://source.android.com/docs/core/runtime/rros), [pinned native PIN view](https://github.com/LineageOS/android_frameworks_base/blob/22de88b7b8eb979c816669c7963dee66ae4953cd/packages/SystemUI/res-keyguard/layout/keyguard_pin_view.xml).
