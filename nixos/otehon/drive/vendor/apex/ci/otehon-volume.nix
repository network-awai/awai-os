{ nixpkgsPath }:
let
  pkgs = import nixpkgsPath { };
  nbb = import ./otehon-nbb.nix { inherit pkgs; };
in assert pkgs.stdenv.hostPlatform.isLinux;
pkgs.runCommand "awai-otehon-volume" {
  nativeBuildInputs = [ pkgs.makeWrapper ];
} ''
  mkdir -p "$out/share/volume" "$out/bin"
  cp -R ${../src} "$out/share/volume/src"
  cp ${../scripts/awaivol.cljc} "$out/share/volume/awaivol.cljc"
  echo '{:paths []}' > "$out/share/volume/nbb.edn"
  makeWrapper ${nbb}/bin/nbb "$out/bin/.volume-runtime" \
    --add-flags "-cp $out/share/volume/src $out/share/volume/awaivol.cljc" \
    --set AWAI_OTEHON_LOCKED 1 \
    --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.curl ]}
  cat > "$out/bin/awai-otehon-volume" <<EOF
  #!${pkgs.runtimeShell}
  set -eu
  umask 077
  [ "\$#" -ge 2 ] || { echo 'usage: awai-otehon-volume COMMAND ROOT ...' >&2; exit 64; }
  volume_root=\$(${pkgs.coreutils}/bin/realpath -m -- "\$2")
  exec ${pkgs.util-linux}/bin/flock --nonblock --conflict-exit-code 75 "\$volume_root.writer.lock" "$out/bin/.volume-runtime" "\$@"
  EOF
  chmod +x "$out/bin/awai-otehon-volume"
''
