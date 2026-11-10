{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
let
  package = import ./default.nix { inherit pkgs; };
  classpath = "${./src}:${./vendor/apex/src}:${./vendor/apex-car/src}:${./test}";
in
pkgs.runCommand "otehon-storage-hosted-check" {
  nativeBuildInputs = [ pkgs.babashka package ];
} ''
  mkdir -p "$out"
  bb --classpath ${classpath} -e "(require '[clojure.test :as t] 'otehon.storage-test 'otehon.pack-store-test)(binding [otehon.storage-test/*output* \"unit\" otehon.pack-store-test/*output* \"pack-unit\"] (let [r (t/run-tests 'otehon.storage-test 'otehon.pack-store-test)] (System/exit (+ (:fail r) (:error r)))))" > "$out/unit-tests.txt"
  bb --classpath ${classpath} ${./test/otehon/crash_runner.clj} run crash > "$out/crash-tests.edn"
  bb --classpath ${classpath} ${./test/otehon/pack_recovery_runner.clj} run pack-crash > "$out/pack-crash-tests.edn"
  otehon-storage init "$PWD/cli-store"
  otehon-storage put "$PWD/cli-store" cli value
  otehon-storage checkpoint "$PWD/cli-store"
  otehon-storage read "$PWD/cli-store" > "$out/cli-read.edn"
  bb -e '(require (quote [clojure.edn :as edn])) (when-not (= {"cli" "value"} (:state (edn/read-string (slurp "${placeholder "out"}/cli-read.edn")))) (System/exit 1))'
  otehon-storage pack-put "$PWD/cli-store" binary pack-crash/multi-leaf.bin > "$out/cli-pack-put.edn"
  otehon-storage pack-checkpoint "$PWD/cli-store"
  otehon-storage pack-get "$PWD/cli-store" binary roundtrip.bin
  cmp pack-crash/multi-leaf.bin roundtrip.bin
  otehon-storage car-export "$PWD/cli-store" binary roundtrip.car
  cmp pack-crash/multi-leaf.car roundtrip.car
  otehon-storage init "$PWD/cli-import"
  otehon-storage car-import "$PWD/cli-import" imported roundtrip.car
  otehon-storage pack-recover "$PWD/cli-import" > "$out/cli-pack-recover.edn"
  otehon-storage pack-get "$PWD/cli-import" imported imported.bin
  cmp pack-crash/multi-leaf.bin imported.bin
  cp roundtrip.car "$out/multi-leaf.car"
  cp roundtrip.bin "$out/multi-leaf.bin"
''
