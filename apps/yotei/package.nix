{ lib, rustPlatform, nodejs, pkg-config, wrapGAppsHook3, gtk3, webkitgtk_4_1, openssl }:
rustPlatform.buildRustPackage {
  pname = "itonami-yotei";
  version = "0.2.0";
  src = lib.cleanSourceWith {
    src = ../..;
    filter = path: type: !(builtins.elem (baseNameOf path) [ ".git" ".agent-output" "node_modules" "target" "dist" ]);
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
