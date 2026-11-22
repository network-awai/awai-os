# Shirohan on Awai Android

This APK runs the Shirohan plate engine from `cloud-itonami/app-itonami-shirohan`.
The build reads immutable source from Git and compiles it to ClojureScript for
the Android WebView. The workbench imports SVG, PNG, JPEG and WebP using the
Android document picker. It generates white underbase and spot plates in a worker
and saves SVG films in `Download/Shirohan`. For raster artwork, spot plates are
optional. The packaged client declares zero external operations and the APK
requests zero Android permissions.

```sh
python3 android/shirohan/build.py --source-repo /path/to/app-itonami-shirohan \
  --out .agent-output/shirohan-build
```

Use an empty output directory, a source checkout containing the pinned commit,
Clojure CLI, and the SDK and development signing identity described in
[`android/README.md`](../README.md). The builder prints the signed APK digest
and signer. Put that exact `shirohan.apk` in the directory passed to
`android/build.py --local-apps-dir` for a bundled development Store build.
The online Store uses the same package ID and independently verifies the
catalog signature, APK digest, package, version and signer before installation.

The Android workbench provides SVG plate export. The web workbench also has PDF,
PSD, cut-line and mockup export and its own inference integrations.
