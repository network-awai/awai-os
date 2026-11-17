# Awai device-local inference handoff v1

`client.js` exports `createInferenceClient({invoke})` with `info()`, `open()` and `generate({prompt,modality:'text',maxTokens})`. It performs no fetch, model download, approval persistence or remote fallback. Native Tauri hosts expose **only** `awai_local_inference` through the Android `InferenceClientPlugin`; see the concrete integration in `apps/itonami`.

Android consumers need the `network.awai.permission.LOCAL_INFERENCE` uses-permission, package visibility for `network.awai.murakumo`, the shared Android source directory and a scoped Tauri command/capability. The provider checks caller package **and** signature, and each generation opens its native confirmation. Explicit Activity results bind schema/requestId/engine/modality and byte bounds. A native permission alone does not auto-approve a request. Readiness uses the signature-protected read-only provider; it never infers a model is loaded from app installation.

The currently admitted app IDs include Itonami, Gaka/Mangaka and Dougaka/Animeka/Ongakuka. This is eligibility, **not evidence that all those apps are packaged, integrated or accepted**. This engine currently implements text. Creative apps can use it for text/prompt assistance; image/video/audio synthesis must refuse or use a separately implemented, explicitly selected actual backend. No returned text may be relabeled as generated media.

For the isolated Nix shell build closure, `nixos/otehon/shell/vendor/awai-inference-client.js` is an exact copy with a SHA256 pin, regenerated into its source tree by `sync-vendor.mjs`. The canonical Kotoba consent broker remains independently pinned and unchanged. This adapter does not validate external descriptors, grant operations or replace the broker. Keep SDK and vendor bytes equal when changing the source.

Text generation is local host computation. External model/runtime acquisition, profile transfer, remote inference, app iframe transport and Awai FS sync retain their own canonical declarations/consent/verification. These are not supplied by this package. The current app has a native SAF import for the exact pinned model and no network permission.
