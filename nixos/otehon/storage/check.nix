{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
let
  package = import ./default.nix { inherit pkgs; };
  classpath = "${./src}:${./vendor/apex/src}:${./vendor/apex-car/src}:${./test}";
in
pkgs.runCommand "otehon-storage-hosted-check" {
  nativeBuildInputs = [ pkgs.babashka pkgs.zstd package ];
} ''
  mkdir -p "$out"
  bb --classpath ${classpath} -e "(require '[clojure.test :as t] 'otehon.storage-test 'otehon.pack-store-test)(binding [otehon.storage-test/*output* \"unit\" otehon.pack-store-test/*output* \"pack-unit\"] (let [r (t/run-tests 'otehon.storage-test 'otehon.pack-store-test)] (System/exit (+ (:fail r) (:error r)))))" > "$out/unit-tests.txt"
  FOREST_FIXTURE=${./test/fixtures/forest/sha256-pack.forest.car.zst} bb --classpath ${classpath} -e "(require '[clojure.test :as t] 'otehon.forest-test)(binding [otehon.forest-test/*output* \"forest-unit\"] (let [r (t/run-tests 'otehon.forest-test)] (System/exit (+ (:fail r) (:error r)))))" > "$out/forest-tests.txt"
  FOREST_FIXTURE=${./test/fixtures/forest/sha256-pack.forest.car.zst} bb --classpath ${classpath} ${./test/otehon/forest_crash_runner.clj} run forest-crash > "$out/forest-crash-tests.edn"
  CROSSPACK_FIXTURES=${./test/fixtures/crosspack} bb --classpath ${classpath} ${./test/otehon/crosspack_proof.clj} run crosspack-proof > "$out/crosspack-proof.edn"
  CROSSPACK_FIXTURES=${./test/fixtures/crosspack} bb --classpath ${classpath} ${./test/otehon/atomic_pack_proof.clj} run atomic-pack-proof > "$out/atomic-pack-proof.edn"
  CROSSPACK_FIXTURES=${./test/fixtures/crosspack} bb --classpath ${classpath} ${./test/otehon/atomic_product_proof.clj} run atomic-product-proof > "$out/atomic-product-proof.edn"
  CROSSPACK_FIXTURES=${./test/fixtures/crosspack} bb --classpath ${classpath} ${./test/otehon/logical_product_proof.clj} logical-product-proof > "$out/logical-product-proof.edn"
  CROSSPACK_FIXTURES=${./test/fixtures/crosspack} bb --classpath ${classpath} ${./test/otehon/atomic_logical_proof.clj} run atomic-logical-proof > "$out/atomic-logical-proof.edn"
  AWAI_FILE_INPUT=1 CROSSPACK_FIXTURES=${./test/fixtures/crosspack} bb --classpath ${classpath} ${./test/otehon/atomic_logical_proof.clj} run atomic-logical-file-proof > "$out/atomic-logical-file-proof.edn"
  bb --classpath ${classpath} ${./test/otehon/crash_runner.clj} run crash > "$out/crash-tests.edn"
  bb --classpath ${classpath} ${./test/otehon/pack_recovery_runner.clj} run pack-crash > "$out/pack-crash-tests.edn"
  OTEHON_TEST_ZSTD3=1 bb --classpath ${classpath} ${./test/otehon/pack_recovery_runner.clj} run zpack-crash > "$out/zpack-crash-tests.edn"
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
  otehon-storage pack-put-zstd3 "$PWD/cli-import" zipped pack-crash/multi-leaf.bin > "$out/cli-zpack-put.edn"
  otehon-storage car-export "$PWD/cli-import" zipped zipped.car
  cmp pack-crash/multi-leaf.car zipped.car
  otehon-storage pack-range-verified "$PWD/cli-import" zipped range.bin 65530 22
  dd if=pack-crash/multi-leaf.bin of=expected-range.bin bs=1 skip=65530 count=22 status=none
  cmp expected-range.bin range.bin
  cp roundtrip.car "$out/multi-leaf.car"
  cp roundtrip.bin "$out/multi-leaf.bin"
''
