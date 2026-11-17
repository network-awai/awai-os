{ pkgs ? import (import ../../ci/nixpkgs.nix) { } }:
pkgs.writeShellApplication {
  name = "itonami-gms";
  runtimeInputs = [ pkgs.babashka ];
  text = ''
    exec bb -cp ${./src} -m itonami.gms.cli "$@"
  '';
}
