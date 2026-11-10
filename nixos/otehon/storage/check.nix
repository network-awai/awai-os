{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
let
  package = import ./default.nix { inherit pkgs; };
  classpath = "${./src}:${./vendor/apex/src}:${./test}";
in
pkgs.runCommand "otehon-storage-hosted-check" {
  nativeBuildInputs = [ pkgs.babashka package ];
} ''
  mkdir -p "$out"
  bb --classpath ${classpath} -e "(require '[clojure.test :as t] 'otehon.storage-test)(binding [otehon.storage-test/*output* \"unit\"] (let [r (t/run-tests 'otehon.storage-test)] (System/exit (+ (:fail r) (:error r)))))" > "$out/unit-tests.txt"
  bb --classpath ${classpath} ${./test/otehon/crash_runner.clj} run crash > "$out/crash-tests.edn"
  otehon-storage init "$PWD/cli-store"
  otehon-storage put "$PWD/cli-store" cli value
  otehon-storage checkpoint "$PWD/cli-store"
  otehon-storage read "$PWD/cli-store" > "$out/cli-read.edn"
  bb -e '(require (quote [clojure.edn :as edn])) (when-not (= {"cli" "value"} (:state (edn/read-string (slurp "${placeholder "out"}/cli-read.edn")))) (System/exit 1))'
''
