#!/bin/sh
# Local hosted JVM oracle: fresh private PostgreSQL cluster and retained output.
set -eu
[ "$#" -eq 3 ] || [ "$#" -eq 4 ] || { echo 'usage: check NEW_BASE NEW_SHORT_SOCKET PINNED_FOREST_TOOL [prolly|policy|receipt]' >&2; exit 2; }
base=$1 socket=$2 tool=$3
mode=${4:-prolly}
case "$mode" in
  prolly) oracle=nixos/otehon/storage/oracle/postgres_witness_prolly.clj ;;
  receipt) oracle=nixos/otehon/storage/oracle/postgres_witness_receipt.clj ;;
  policy) oracle=nixos/otehon/storage/oracle/postgres_witness_policy.clj ;;
  *) echo 'unknown oracle mode' >&2; exit 2 ;;
esac
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGOPTIONS PGTARGETSESSIONATTRS PGSSLMODE
mkdir "$base" "$socket"
chmod 700 "$socket"
if [ "$mode" = policy ] || [ "$mode" = receipt ]; then
  IPLD_POLICY_FIXTURE=nixos/otehon/storage/test/fixtures/prolly-forest/policy.forest
  export IPLD_POLICY_FIXTURE
  printf '%s  %s\n' 0ea6a8f7b6d2086a2a6565f9a787fcac316d7bb18b5856cdb6bf935df477b0ed "$IPLD_POLICY_FIXTURE" | shasum -a 256 -c > "$base/policy-hash.log"
fi
# The two overrides are pinned to the bounded decoder revision; the rest of
# the adapted oracle classpath must match the recorded 200-file manifest.
printf '%s  %s\n' \
  b597c060b56766a56d94f367ed1bc7c59ec8d086a93ac85037867bb701ec33ab .agent-output/bounded-closure/classpath/cbor/core.cljc \
  2ebb52cd066e71bc43446dfe62ceaab6569e7b59a3c93b10bd37f266bc9450e8 .agent-output/bounded-closure/classpath/ipld/core.cljc \
  e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f "$tool" | shasum -a 256 -c > "$base/override-hashes.log"
jq -r '.classpath | to_entries[] | "\(.value)  .agent-output/policy-forest/classpath/\(.key)"' nixos/otehon/storage/oracle/prolly_forest_writer_inputs.json | shasum -a 256 -c > "$base/classpath-hashes.log"
initdb -D "$base/data" --auth=trust --no-locale --encoding=UTF8 > "$base/initdb.log"
stop() { pg_ctl -D "$base/data" -m fast -w stop >/dev/null 2>&1 || :; }
trap stop EXIT HUP INT TERM
start() { pg_ctl -D "$base/data" -l "$base/server.log" -o "-k $socket -h '' -p 55449" -w start >/dev/null; }
start
printf '[awai_prolly_test]\nhost=%s\nport=55449\ndbname=postgres\nconnect_timeout=3\n' "$socket" > "$base/service.conf"
chmod 600 "$base/service.conf"
mkdir "$base/proof"
export PGSERVICEFILE="$base/service.conf" PG_PROLLY_OUTPUT="$base/proof" PG_WITNESS_PSQL="$(command -v psql)" PG_WITNESS_SERVICE=awai_prolly_test FOREST_TOOL="$tool"
psql -X -q -v ON_ERROR_STOP=1 -d 'service=awai_prolly_test' -c 'CREATE SCHEMA awai_witness; CREATE TABLE awai_witness.root (store_id text PRIMARY KEY, root bytea NOT NULL, pending bytea);'
if [ "$mode" = receipt ]; then
  jq -r 'to_entries[] | .key as $root | .value | to_entries[] | "\(.value)  \($root)/\(.key)"' nixos/otehon/storage/oracle/postgres_witness_receipt_inputs.json | shasum -a 256 -c > "$base/receipt-classpath-hashes.log"
  deps='{:paths [".agent-output/bounded-closure/classpath" "nixos/otehon/storage/src" "nixos/otehon/storage/vendor/apex/src" "nixos/otehon/storage/vendor/apex-car/src" "nixos/otehon/storage/vendor/kotobase-storage/src" ".agent-output/signed-receipt-adapted" ".agent-output/policy-forest/classpath" ".agent-output/receipt-sink/classpath"]}'
else
  deps='{:paths [".agent-output/bounded-closure/classpath" "nixos/otehon/storage/src" "nixos/otehon/storage/vendor/apex/src" "nixos/otehon/storage/vendor/apex-car/src" "nixos/otehon/storage/vendor/kotobase-storage/src" ".agent-output/policy-forest/classpath"]}'
fi
clojure -Sdeps "$deps" -M "$oracle" write
pg_ctl -D "$base/data" -m fast -w stop >/dev/null
start
clojure -Sdeps "$deps" -M "$oracle" read
stop
trap - EXIT HUP INT TERM
