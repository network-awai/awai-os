{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "otehon-bot-fleet-check" {
  nativeBuildInputs = [ pkgs.babashka pkgs.nodejs ];
} ''
  mkdir -p "$out"
  bb --classpath ${./.}/src ${./.}/test/bot_fleet/core_test.clj > "$out/core-tests.txt"
  bb --classpath ${./.}/src ${./.}/test/bot_fleet/daily_test.clj > "$out/daily-tests.txt"
  bb --classpath ${./.}/src:${./vm/vendor/itonami/otehon/src}:${../storage}/src:${../storage}/vendor/apex/src:${../storage}/vendor/apex-car/src ${./.}/test/bot_fleet/vm_worker_test.clj > "$out/vm-worker-tests.txt"
  bb --classpath ${./.}/src:${./vm/vendor/itonami/otehon/src}:${../storage}/src:${../storage}/vendor/apex/src:${../storage}/vendor/apex-car/src ${./.}/test/bot_fleet/vm_host_test.clj > "$out/vm-host-tests.txt"
  node --test ${./.}/receipt.test.mjs ${./.}/observe-guest.test.mjs > "$out/receipt-tests.txt"
  node --test ${./.}/resolve-timezones.test.mjs > "$out/timezone-tests.txt"
  node --test ${../shell}/test/soshiki-runtime.test.js > "$out/runtime-view-tests.txt"
  node --test ${../shell}/test/fleet-projection.test.js > "$out/fleet-projection-tests.txt"
  AWAI_STABILIZATION_MODULE=${./stabilization.mjs} node --test ${../shell}/test/stabilization.test.js > "$out/stabilization-tests.txt"
  bb --classpath ${../shell}/src ${../shell}/test/observation_test.clj > "$out/observation-tests.txt"
''
