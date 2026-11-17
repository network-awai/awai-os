{ pkgs, sources ? builtins.fromJSON (builtins.readFile ./native-sources.json), liveSession ? false }:
let
  fetch = name: pkgs.fetchurl { inherit (sources.${name}) url sha256; };
  compiler = fetch "compiler";
in pkgs.runCommand "murakumo-nixos-native-workspace-0.1.0" {
  nativeBuildInputs = [ pkgs.coreutils pkgs.gnused ];
  # These are source/artifact pins, not a mutable release channel.
  passthru.sourcePins = sources;
} ''
  mkdir -p $out/bin $out/share/murakumo-workspace
  cp ${compiler} ./amu
  chmod 500 ./amu
  export KEXE_ALLOW=35,37,38,39
  export KEXE_CAP_RESOURCES_35=$NIX_BUILD_TOP
  cp ${fetch "nodeMonitor"} ./monitor.kotoba
  ./amu compile "$NIX_BUILD_TOP/monitor.kotoba" --target x86_64-linux \
    --output "$NIX_BUILD_TOP/monitor.elf" --format static
  cp monitor.elf $out/bin/murakumo-node-monitor
  chmod 555 $out/bin/murakumo-node-monitor
  for app in kaikei dandori; do
    printf '(ns murakumo.%s-browser (:export [main]))\n' "$app" > "$app.kotoba"
    case "$app" in
      kaikei) sed '1,/]))$/d' ${fetch "kaikei"} >> "$app.kotoba" ;;
      dandori) sed '1,/]))$/d' ${fetch "dandori"} >> "$app.kotoba" ;;
    esac
    cat ${archive/nixos/native/entry-input.kotoba} >> "$app.kotoba"
    case "$app" in
      kaikei) cat ${archive/nixos/native/kaikei-entry.kotoba} >> "$app.kotoba" ;;
      dandori) cat ${archive/nixos/native/dandori-entry.kotoba} >> "$app.kotoba" ;;
    esac
    ./amu compile "$NIX_BUILD_TOP/$app.kotoba" --target wasm32-browser \
      --output "$NIX_BUILD_TOP/$app.wasm"
    cp "$app.wasm" $out/share/murakumo-workspace/
  done
  cp ${../../desktop/index.html} $out/share/murakumo-workspace/index.html
  cp ${../../desktop/desktop.css} $out/share/murakumo-workspace/desktop.css
  cp ${../../desktop/desktop.js} $out/share/murakumo-workspace/desktop.js
  cp ${fetch "wasmHost"} $out/share/murakumo-workspace/wasm-host.js
  cp ${fetch "clientRuntime"} $out/share/murakumo-workspace/kotoba-client-runtime.js
  cd $out/share/murakumo-workspace
  kaikei_sha=$(sha256sum kaikei.wasm | cut -d' ' -f1)
  dandori_sha=$(sha256sum dandori.wasm | cut -d' ' -f1)
  printf 'export const deviceProfile = Object.freeze({"liveSession":${if liveSession then "true" else "false"}});\nexport const artifactPins = Object.freeze({"kaikei.wasm":"%s","dandori.wasm":"%s"});\n' \
    "$kaikei_sha" "$dandori_sha" > artifact-pins.js
  sha256sum * > $out/share/asset-sha256.txt
''
