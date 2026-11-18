#!/usr/bin/env bash
# AWAI-3170: start an EN devnet node and the HTTPS support desk on loopback, with a CA made for this
# run only. The CA key never leaves OUT_DIR. Prints the paths the caller needs, then waits.
#
# usage (from dapps/awai-support): test/devnet_stack.sh OUT_DIR [ALLOW_ORIGIN]
#   NODE_PORT (default 18796) and DESK_PORT (default 18795) can be overridden; REUSE_CA_DIR reuses a CA; DESK_SCRIPT swaps the desk (mutation checks).
set -euo pipefail
O=$1; ALLOW=${2:-https://tauri.localhost}
NODE_PORT=${NODE_PORT:-18796}; DESK_PORT=${DESK_PORT:-18795}; C=awai-en-devnet/awai-3170
EN=../en-devnet
mkdir -p "$O"; O=$(cd "$O" && pwd)
sig(){ (cd $EN && nbb -cp src host/signer.cljs "$@"); }
field(){ python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }

# A CA for this run (or REUSE_CA_DIR's, so an APK built for it keeps working) and a localhost leaf.
if [ -n "${REUSE_CA_DIR:-}" ]; then cp "$REUSE_CA_DIR/ca.pem" "$REUSE_CA_DIR/ca.key" "$O/"; else
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 2 -subj "/CN=Awai devnet support CA $(date +%s)" \
  -keyout "$O/ca.key" -out "$O/ca.pem" -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign 2>/dev/null; fi
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/CN=localhost" -keyout "$O/desk.key" -out "$O/desk.csr" 2>/dev/null
printf 'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' > "$O/desk.ext"
openssl x509 -req -in "$O/desk.csr" -CA "$O/ca.pem" -CAkey "$O/ca.key" -CAcreateserial -days 2 -extfile "$O/desk.ext" -out "$O/desk.pem" 2>/dev/null
chmod 600 "$O"/*.key

S=$(sig keygen "$O/sponsor.pem" | field did)
B=$(sig keygen "$O/awai-support-bot.pem" | field did)
OP=$(sig keygen "$O/operator.pem" | field did)
P=$(sig keygen "$O/provider.pem" | field did)
(cd $EN && nbb -cp src host/node.cljs init "$O/node" $C "$OP" "$S" "$B" "$P" > /dev/null)
(cd $EN && exec nbb -cp src host/node.cljs serve "$O/node" $NODE_PORT >> "$O/node.log" 2>&1) &
nbb -cp src:$EN/src ${DESK_SCRIPT:-host/desk.cljs} init "$O/desk" $C "$O/sponsor.pem" "$O/awai-support-bot.pem" "http://127.0.0.1:$NODE_PORT" "$ALLOW" > /dev/null
(exec nbb -cp src:$EN/src ${DESK_SCRIPT:-host/desk.cljs} serve "$O/desk" $DESK_PORT "$O/desk.pem" "$O/desk.key" >> "$O/desk.log" 2>&1) &
for i in $(seq 1 60); do
  curl -fs http://127.0.0.1:$NODE_PORT/v1/head >/dev/null && curl -s --cacert "$O/ca.pem" -o /dev/null https://localhost:$DESK_PORT/ && break
  sleep 0.5
done
python3 -c 'import json,sys;print(json.dumps({"ca":sys.argv[1],"desk":sys.argv[2],"node":sys.argv[3],"sponsor":sys.argv[4],"bot":sys.argv[5]}))' \
  "$O/ca.pem" "https://localhost:$DESK_PORT" "http://127.0.0.1:$NODE_PORT" "$S" "$B" > "$O/stack.json"
cat "$O/stack.json"
wait
