{ pkgs }:
let
  upstream = ./vendor/apex;
  pin = builtins.fromJSON (builtins.readFile (upstream + "/source.json"));
  verified = builtins.all (name:
    builtins.hashFile "sha256" (upstream + "/${name}") == pin.files.${name}
  ) (builtins.attrNames pin.files);
  nbb = import (upstream + "/ci/otehon-nbb.nix") { inherit pkgs; };
in assert verified;
pkgs.runCommand "awai-otehon-drive-volume" { nativeBuildInputs = [ pkgs.makeWrapper ]; } ''
  mkdir -p "$out/share/volume" "$out/bin"
  cp -R ${upstream}/src "$out/share/volume/src"
  cp ${upstream}/scripts/awaivol.cljc "$out/share/volume/awaivol.cljc"
  echo '{:paths []}' > "$out/share/volume/nbb.edn"
  makeWrapper ${nbb}/bin/nbb "$out/bin/.volume-runtime" \
    --add-flags "-cp $out/share/volume/src $out/share/volume/awaivol.cljc" \
    --set AWAI_OTEHON_LOCKED 1 --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.curl ]}
  cat > "$out/bin/awai-otehon-volume" <<EOF
  #!${pkgs.runtimeShell}
  set -eu
  umask 077
  [ "\$#" -ge 2 ] || exit 64
  volume_root=\$(${pkgs.coreutils}/bin/realpath -m -- "\$2")
  exec ${pkgs.util-linux}/bin/flock --nonblock --conflict-exit-code 75 "\$volume_root.writer.lock" "$out/bin/.volume-runtime" "\$@"
  EOF
  chmod +x "$out/bin/awai-otehon-volume"
''
