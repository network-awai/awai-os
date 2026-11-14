#!/bin/sh
# Task-owned throwaway Unix-socket cluster only. Never connect to an existing DB.
set -eu
[ "$#" -eq 5 ] || [ "$#" -eq 6 ] || { echo 'usage: check BASE SOCKET CLASSPATH PROOF FIXTURES [CRASH]' >&2; exit 2; }
base=$1 socket=$2 classpath=$3 proof=$4 fixtures=$5
crash=${6:-nixos/otehon/storage/oracle/postgres_witness_crash.clj}
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGOPTIONS PGTARGETSESSIONATTRS PGSSLMODE
mkdir "$base" "$socket"
chmod 700 "$socket"
initdb -D "$base/data" --auth=trust --no-locale --encoding=UTF8 > "$base/initdb.log"
stop() { pg_ctl -D "$base/data" -m fast -w stop >/dev/null 2>&1 || :; }
trap stop EXIT HUP INT TERM
start() { pg_ctl -D "$base/data" -l "$base/server.log" -o "-k $socket -h '' -p 55449" -w start >/dev/null; }
start
printf '[awai_witness_test]\nhost=%s\nport=55449\ndbname=postgres\nconnect_timeout=3\n' "$socket" > "$base/service.conf"
chmod 600 "$base/service.conf"
export PGSERVICEFILE="$base/service.conf" PG_WITNESS_PSQL="$(command -v psql)" PG_WITNESS_SERVICE=awai_witness_test
export PG_WITNESS_PROOF="$base/proof" CROSSPACK_FIXTURES="$fixtures"
mkdir "$PG_WITNESS_PROOF"
psql -X -q -v ON_ERROR_STOP=1 -d 'service=awai_witness_test' -c 'CREATE SCHEMA awai_witness; CREATE TABLE awai_witness.root (store_id text PRIMARY KEY, root bytea NOT NULL);'
env PGHOST=/nonexistent PGPORT=1 PGOPTIONS='-c default_transaction_read_only=on' bb --classpath "$classpath" "$proof" setup
pg_ctl -D "$base/data" -m fast -w stop >/dev/null
bb --classpath "$classpath" "$proof" down
start
bb --classpath "$classpath" "$proof" verify
bb --classpath "$classpath" "$crash" run
pg_ctl -D "$base/data" -m fast -w stop >/dev/null
start
bb --classpath "$classpath" "$crash" verify
stop
trap - EXIT HUP INT TERM
