{ lib, rustPlatform, nodejs, pkg-config, wrapGAppsHook3, gtk3, webkitgtk_4_1, openssl }:
rustPlatform.buildRustPackage {
  pname = "itonami-yotei";
  version = "0.2.0";
  # Explicit source set excludes Android/Gradle caches and all unrelated WIP.
  src = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ./src ./scripts ./test
      ./src-tauri/Cargo.toml ./src-tauri/Cargo.lock ./src-tauri/build.rs
      ./src-tauri/src ./src-tauri/capabilities ./src-tauri/icons ./src-tauri/tauri.conf.json
      ../../packages/awai-shell/host.js ../../packages/awai-shell/test
      ../../android/client/generated/domain.js
      ../../android/contracts/src/itonami/store/domain.cljc
      ../../android/client/assets/android-v2-icon-calendar.svg
      ../../otehon/shell/vendor/PINS.json
      ../../otehon/shell/vendor/kotoba-client-runtime.js
      ../../otehon/shell/vendor/kotoba-client-consent.css
    ];
  };
  cargoRoot = "apps/yotei/src-tauri";
  buildAndTestSubdir = "apps/yotei/src-tauri";
  cargoLock.lockFile = ./src-tauri/Cargo.lock;
  nativeBuildInputs = [ nodejs pkg-config wrapGAppsHook3 ];
  buildInputs = [ gtk3 webkitgtk_4_1 openssl ];
  preBuild = ''
    node apps/yotei/scripts/build.mjs
    node --test packages/awai-shell/test/*.test.mjs apps/yotei/test/*.test.mjs
  '';
  buildFeatures = [ "custom-protocol" ];
  postInstall = ''
    mkdir -p $out/share/applications $out/share/icons/hicolor/128x128/apps
    cp apps/yotei/src-tauri/icons/128x128.png $out/share/icons/hicolor/128x128/apps/network.itonami.yotei.png
    cat > $out/share/applications/network.itonami.yotei.desktop <<DESKTOP
    [Desktop Entry]
    Name=Yotei
    Exec=$out/bin/yotei
    Icon=network.itonami.yotei
    Type=Application
    Categories=Office;Calendar;
    DESKTOP
  '';
  meta = { description = "Yotei independent local calendar on Awai Shell / Tauri v3"; mainProgram = "yotei"; platforms = lib.platforms.linux; };
}
