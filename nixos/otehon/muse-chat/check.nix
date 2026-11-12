{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "otehon-muse-conversation-check" {
  nativeBuildInputs = [ pkgs.babashka ];
} ''
  mkdir -p "$out"
  bb -cp ${./src}:${./test} ${./test/muse_chat/core_test.clj} > "$out/tests.txt"
''
