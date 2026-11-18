# Android hosts for Bunsho, Hyokeisan and Zuhyo

Build each browser candidate from its owning repository using its pinned Amu
compiler and browser build instructions. Then run from the Awai OS root:

```sh
(cd packages/awai-ui && npm ci && npm run build)
node apps/office-android/prepare.mjs bunsho BROWSER_BUILD KOTOBA_REPO .agent-output/bunsho
cd .agent-output/bunsho
npm ci
npm run tauri -- android init --ci
mkdir -p src-tauri/icons
cp src-tauri/gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png src-tauri/icons/icon.png
npm run tauri -- android build --apk --target x86_64 --debug
```

Repeat with `hyokeisan` and `zuhyo` and separate output directories. Use
`aarch64` for ARM Android. Each app has its own launcher and WebView storage.
The host packages the existing editor and binds the Wasm bundle to the browser
build receipt. It copies the digest-pinned canonical Kotoba runtime and
declares no external operations. Build only from trusted source checkouts.

These are offline development APKs. Publishing signed packages and saving
Office snapshots directly to Drive require separate integration. Browser
candidate storage does not migrate automatically into the Android app.
