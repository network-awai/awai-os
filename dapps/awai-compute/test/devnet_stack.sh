#!/usr/bin/env bash
# AWAI-3115: start the EN devnet node, the HTTPS compute desk, a second desk
# with a short offer TTL (expired-offer control), and a loopback llama.cpp
# engine, with fresh disposable keys per run. Key files live in OUT_DIR
# (mode 0600); evidence copies public values only.
#
# usage (from dapps/awai-compute): test/devnet_stack.sh OUT_DIR MODEL-FILE [ALLOW_ORIGIN]
#   NODE_PORT (18797), DESK_PORT (18796), DESK2_PORT (18798), ENGINE_PORT (18080) overridable.
set -euo pipefail
O=$1; MODEL=$2; ALLOW=${3:-https://tauri.localhost}
NODE_PORT=${NODE_PORT:-18797}; DESK_PORT=${DESK_PORT:-18796}; DESK2_PORT=${DESK2_PORT:-18798}
ENGINE_PORT=${ENGINE_PORT:-18080}
C=awai-en-devnet/awai-3115
EN=../en-devnet
mkdir -p "$O"; O=$(cd "$O" && pwd)
sig(){ (cd $EN && nbb -cp src host/signer.cljs "$@"); }
field(){ python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }

# A CA for this run and a localhost leaf. SHA-256 digest and implicit
# parameters: newer Node/OpenSSL refuses SHA-1 CAs and explicit-parameters
# EC certificates ("CA signature digest algorithm too weak", "Certificate
# public key has explicit ECC parameters").
openssl ecparam -genkey -name prime256v1 -out "$O/ca.key" 2>/dev/null
openssl req -new -x509 -key "$O/ca.key" -days 2 -sha256 -subj "/CN=Awai devnet compute CA $(date +%s)" \
  -out "$O/ca.pem" -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign 2>/dev/null
openssl ecparam -genkey -name prime256v1 -out "$O/desk.key" 2>/dev/null
openssl req -new -key "$O/desk.key" -subj "/CN=localhost" -out "$O/desk.csr" 2>/dev/null
printf 'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' > "$O/desk.ext"
openssl x509 -req -in "$O/desk.csr" -CA "$O/ca.pem" -CAkey "$O/ca.key" -CAcreateserial -sha256 -days 2 -extfile "$O/desk.ext" -out "$O/desk.pem" 2>/dev/null
chmod 600 "$O/ca.key" "$O/desk.key"

S=$(sig keygen "$O/sponsor.pem" | field did)
B=$(sig keygen "$O/bot.pem" | field did)
OP=$(sig keygen "$O/operator.pem" | field did)
P=$(sig keygen "$O/provider.pem" | field did)

# Engine: real llama.cpp on loopback, serving the pinned model file.
(llama-server -m "$MODEL" --host 127.0.0.1 --port "$ENGINE_PORT" -c 2048 --n-gpu-layers 0 >> "$O/engine.log" 2>&1) &
for i in $(seq 1 120); do curl -fs "http://127.0.0.1:$ENGINE_PORT/health" >/dev/null 2>&1 && break; sleep 1; done

(cd $EN && nbb -cp src host/node.cljs init "$O/node" $C "$OP" "$S" "$B" "$P" > /dev/null)
(cd $EN && exec nbb -cp src host/node.cljs serve "$O/node" $NODE_PORT >> "$O/node.log" 2>&1) &
for i in $(seq 1 60); do curl -fs http://127.0.0.1:$NODE_PORT/v1/head >/dev/null 2>&1 && break; sleep 0.5; done

# Sponsor funds the bot once (support path) so it can pay one compute order.
nbb -cp src:$EN/src test/fund.cljs "$O/sponsor.pem" "$O/bot.pem" "http://127.0.0.1:$NODE_PORT" $C "support-fund-01" 1

nbb -cp src:$EN/src host/desk.cljs init "$O/desk" $C "$O/bot.pem" "$O/provider.pem" "http://127.0.0.1:$NODE_PORT" "$ALLOW" "http://127.0.0.1:$ENGINE_PORT" "$MODEL" > /dev/null
(exec nbb -cp src:$EN/src host/desk.cljs serve "$O/desk" $DESK_PORT "$O/desk.pem" "$O/desk.key" >> "$O/desk.log" 2>&1) &
# Second desk with a short offer TTL, only for the expired-offer control.
nbb -cp src:$EN/src host/desk.cljs init "$O/desk2" $C "$O/bot.pem" "$O/provider.pem" "http://127.0.0.1:$NODE_PORT" "$ALLOW" "http://127.0.0.1:$ENGINE_PORT" "$MODEL" 200 > /dev/null
(exec nbb -cp src:$EN/src host/desk.cljs serve "$O/desk2" $DESK2_PORT "$O/desk.pem" "$O/desk.key" >> "$O/desk2.log" 2>&1) &
for i in $(seq 1 60); do curl -s --cacert "$O/ca.pem" -o /dev/null "https://localhost:$DESK_PORT/" && curl -s --cacert "$O/ca.pem" -o /dev/null "https://localhost:$DESK2_PORT/" && break; sleep 0.5; done

python3 -c 'import json,sys;print(json.dumps({"ca":sys.argv[1],"desk":sys.argv[2],"desk2":sys.argv[3],"node":sys.argv[4],"bot":sys.argv[5],"provider":sys.argv[6]}))' \
  "$O/ca.pem" "https://localhost:$DESK_PORT" "https://localhost:$DESK2_PORT" "http://127.0.0.1:$NODE_PORT" "$B" "$P" > "$O/stack.json"
cat "$O/stack.json"
wait
