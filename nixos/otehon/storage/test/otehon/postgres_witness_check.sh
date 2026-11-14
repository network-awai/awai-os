#!/bin/sh
# Task-owned throwaway Unix-socket cluster only. Never connect to an existing DB.
set -eu
[ "$#" -ge 5 ] && [ "$#" -le 7 ] || { echo 'usage: check BASE SOCKET CLASSPATH PROOF FIXTURES [CRASH [DB_INTERRUPT]]' >&2; exit 2; }
base=$1 socket=$2 classpath=$3 proof=$4 fixtures=$5
crash=${6:-nixos/otehon/storage/oracle/postgres_witness_crash.clj}
db_interrupt=${7:-nixos/otehon/storage/oracle/postgres_witness_db_interrupt.clj}
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGOPTIONS PGTARGETSESSIONATTRS PGSSLMODE
mkdir "$base" "$socket"
chmod 700 "$socket"
initdb -D "$base/data" --auth=trust --no-locale --encoding=UTF8 > "$base/initdb.log"
stop() { pg_ctl -D "$base/data" -m fast -w stop >/dev/null 2>&1 || :; }
fault_pid=
cleanup() { if [ -n "$fault_pid" ]; then kill "$fault_pid" 2>/dev/null || :; wait "$fault_pid" 2>/dev/null || :; fi; stop; }
trap cleanup EXIT HUP INT TERM
start() { pg_ctl -D "$base/data" -l "$base/server.log" -o "-k $socket -h '' -p 55449" -w start >/dev/null; }
start
printf '[awai_witness_test]\nhost=%s\nport=55449\ndbname=postgres\nconnect_timeout=3\n' "$socket" > "$base/service.conf"
chmod 600 "$base/service.conf"
export PGSERVICEFILE="$base/service.conf" PG_WITNESS_PSQL="$(command -v psql)" PG_WITNESS_SERVICE=awai_witness_test
export PG_WITNESS_PROOF="$base/proof" CROSSPACK_FIXTURES="$fixtures"
mkdir "$PG_WITNESS_PROOF"
psql -X -q -v ON_ERROR_STOP=1 -d 'service=awai_witness_test' -c 'CREATE SCHEMA awai_witness; CREATE TABLE awai_witness.root (store_id text PRIMARY KEY, root bytea NOT NULL, pending bytea);'
env PGHOST=/nonexistent PGPORT=1 PGOPTIONS='-c default_transaction_read_only=on' bb --classpath "$classpath" "$proof" setup
pg_ctl -D "$base/data" -m fast -w stop >/dev/null
bb --classpath "$classpath" "$proof" down
start
bb --classpath "$classpath" "$proof" verify
bb --classpath "$classpath" "$crash" run
pg_ctl -D "$base/data" -m fast -w stop >/dev/null
start
bb --classpath "$classpath" "$crash" verify
bb --classpath "$classpath" "$crash" reconcile
bb --classpath "$classpath" "$db_interrupt" prepare
psql -X -q -v ON_ERROR_STOP=1 -d 'service=awai_witness_test' <<'SQL'
CREATE FUNCTION awai_witness.pause_test_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_sleep(120); RETURN NEW; END $$;
CREATE TRIGGER pause_test_update BEFORE UPDATE ON awai_witness.root
  FOR EACH ROW WHEN (OLD.store_id = repeat('9',64) AND OLD.pending IS NOT NULL AND NEW.pending IS NULL AND NEW.root IS DISTINCT FROM OLD.root)
  EXECUTE FUNCTION awai_witness.pause_test_update();
SQL
bb --classpath "$classpath" "$db_interrupt" write > "$base/interrupted-writer.log" 2>&1 &
fault_pid=$!
i=0
while :; do
  waiting=$(psql -X -q -A -t -v ON_ERROR_STOP=1 -d 'service=awai_witness_test' -c "SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE '%UPDATE awai_witness.root%' AND position(repeat('9',64) in query)>0;")
  [ "$waiting" = 1 ] && break
  i=$((i + 1)); [ "$i" -lt 200 ] || { echo 'witness update did not reach trigger' >&2; exit 1; }
  sleep 0.2
done
printf '{:mode :db-update-wait :observed true}\n'
pg_ctl -D "$base/data" -m immediate -w stop >/dev/null
wait "$fault_pid"
fault_pid=
cat "$base/interrupted-writer.log"
start
bb --classpath "$classpath" "$db_interrupt" verify
psql -X -q -v ON_ERROR_STOP=1 -d 'service=awai_witness_test' -c 'DROP TRIGGER pause_test_update ON awai_witness.root;'
bb --classpath "$classpath" "$db_interrupt" reconcile
stop
trap - EXIT HUP INT TERM
