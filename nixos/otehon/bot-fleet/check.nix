{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "otehon-bot-fleet-check" {
  nativeBuildInputs = [ pkgs.babashka pkgs.nodejs ];
} ''
  mkdir -p "$out"
  bb --classpath ${./.}/src ${./.}/test/bot_fleet/core_test.clj > "$out/core-tests.txt"
  node --test ${./.}/receipt.test.mjs ${./.}/observe-guest.test.mjs > "$out/receipt-tests.txt"
  node --test ${../shell}/test/soshiki-runtime.test.js > "$out/runtime-view-tests.txt"
  bb --classpath ${../shell}/src ${../shell}/test/observation_test.clj > "$out/observation-tests.txt"
''
