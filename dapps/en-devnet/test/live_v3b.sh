#!/usr/bin/env bash
# ADR 0027 V3b (AWAI-3121): the EN devnet node and signers on two real hosts.
#
# This host runs the single-operator node, the sponsor key and the bot's signer. The provider
# operator's key is created on PROVIDER_HOST and signs there over SSH; it never leaves that host.
# The order and acceptance CIDs are synthetic labels: binding them to a real receipt and acceptance
# is V5. Nothing here is money, revenue or a reward.
#
# usage (from dapps/en-devnet): test/live_v3b.sh PROVIDER_HOST REMOTE_DIR OUT_DIR
# Exit 0 only when every check passes.
set -uo pipefail
HOST=$1; REMOTE=$2; O=$3
PORT=18791; U=http://127.0.0.1:$PORT; C=awai-en-devnet/adr0027-v3b
n(){ nbb -cp src "$@"; }
field(){ python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('$1'))"; }
remote(){ ssh -o BatchMode=yes "$HOST" "export PATH=/opt/homebrew/bin:\$PATH; cd $REMOTE && nbb -cp src $*"; }
mkdir -p "$O"; PASS=0; TOTAL=0; RESULTS=$O/checks.jsonl; : > "$RESULTS"
PK=provider-$(date +%s).pem   # a fresh provider key per run, on the provider host
check(){ # name, condition-result (0 = pass), detail
  set -- "$1" "$2" "${3:-}"
  TOTAL=$((TOTAL+1)); if [ "$2" = 0 ]; then PASS=$((PASS+1)); echo "PASS $1"; ok=true; else echo "FAIL $1  $3"; ok=false; fi
  python3 -c 'import json,sys;print(json.dumps({"check":sys.argv[1],"passed":sys.argv[2]=="true","detail":sys.argv[3]}))' "$1" "$ok" "$3" >> "$RESULTS"; }
is(){ [ "$1" = "$2" ] && echo 0 || echo 1; }
start_node(){ curl -fs $U/v1/head >/dev/null && { echo "port $PORT already serving" >&2; exit 2; }
  n host/node.cljs serve "$O/node" $PORT >> "$O/node.log" 2>&1 & for i in $(seq 1 40); do curl -fs $U/v1/head >/dev/null && return; sleep 0.5; done; echo "node did not start" >&2; exit 2; }
stop_node(){ pkill -f "host/node.cljs serve $O/node $PORT"; for i in $(seq 1 20); do curl -fs $U/v1/head >/dev/null || return 0; sleep 0.5; done; echo "node did not stop" >&2; exit 2; }

mkdir -p "$O"
# Keys: three here, the provider operator's on the provider host.
S=$(n host/signer.cljs keygen "$O/sponsor.pem" | field did)
B=$(n host/signer.cljs keygen "$O/bot.pem" | field did)
OP=$(n host/signer.cljs keygen "$O/operator.pem" | field did)
P=$(remote host/signer.cljs keygen $PK | field did)
check "the provider key is made on the provider host" "$(case $P in did:key:z*) echo 0;; *) echo 1;; esac)" "$P"
check "the provider key file stays on the provider host" "$(test -e "$O/$PK" && echo 1 || echo 0)"

n host/node.cljs init "$O/node" $C "$OP" "$S" "$B" "$P" > /dev/null
n host/signer.cljs init "$O/bot-signer" "$O/bot.pem" $C 1 "$P" > /dev/null

# Unknown balance: the node is not running yet.
r=$(n host/signer.cljs reserve "$O/bot-signer" $U order-unknown 1 | field cause)
check "no reservation while the balance is unknown" "$(is "$r" :balance-unknown)" "$r"
start_node
r=$(n host/signer.cljs reserve "$O/bot-signer" $U order-early 1 | field cause)
check "no reservation before the bot is funded" "$(is "$r" :insufficient)" "$r"

fund(){ n host/signer.cljs funding $C "$S" "$B" "$1" "$(openssl rand -hex 6)" 600000 | n host/signer.cljs sign "$O/sponsor.pem" | n host/signer.cljs sign "$O/bot.pem"; }
r=$(fund fund-1 | n host/signer.cljs submit - $U | field finalized)
check "the sponsor funds the bot with one unit" "$(is "$r" True)" "$r"
r=$(n host/signer.cljs funding $C "$S" "$B" fund-x "$(openssl rand -hex 6)" 600000 | remote host/signer.cljs sign $PK | field cause)
check "the provider key refuses to sign a transfer it is not party to" "$(is "$r" :not-a-party)" "$r"

r=$(n host/signer.cljs reserve "$O/bot-signer" $U order-a 2 | field cause)
check "a reservation above the policy maximum is refused" "$(is "$r" :over-policy)" "$r"
r=$(n host/signer.cljs reserve "$O/bot-signer" $U order-a 1 | field state)
check "the bot reserves one unit for order A, persisted before signing" "$(is "$r" :reserved)" "$r"
r=$(n host/signer.cljs reserve "$O/bot-signer" $U order-b 1 | field cause)
check "a second reservation cannot spend the held unit" "$(is "$r" :insufficient)" "$r"
r=$(n host/signer.cljs propose "$O/bot-signer" order-a acceptance-a "$S" 600000 | field cause)
check "the signer refuses a receiver outside its allowlist" "$(is "$r" :receiver-not-allowlisted)" "$r"

n host/signer.cljs propose "$O/bot-signer" order-a acceptance-a "$P" 600000 > "$O/tx-a.json"
# Someone relaying the bot-signed tx before the provider counter-signs: no signer state involved.
r=$(n host/signer.cljs submit - $U < "$O/tx-a.json" | field cause)
check "the node refuses the bot's signature alone (one-sided binding)" "$(is "$r" :missing-receiver-signature)" "$r"
remote host/signer.cljs sign $PK < "$O/tx-a.json" > "$O/tx-a-both.json"
python3 - "$O/tx-a-both.json" "$O/tx-a-changed.json" <<'EOF'
import json,sys; t=json.load(open(sys.argv[1])); t["acceptance"]="acceptance-other"; json.dump(t,open(sys.argv[2],"w"))
EOF
r=$(n host/signer.cljs submit - $U < "$O/tx-a-changed.json" | field cause)
check "the node refuses signatures over other content" "$(is "$r" :unverified-signature)" "$r"
r=$(n host/signer.cljs submit "$O/bot-signer" $U < "$O/tx-a-both.json")
check "the two-party settlement finalizes" "$(is "$(echo "$r" | field finalized)" True)" "$r"
r=$(n host/signer.cljs submit - $U < "$O/tx-a-both.json" | field cause)
check "the same settlement cannot finalize twice" "$(is "$r" :duplicate-nonce)" "$r"

# Restart: the node rebuilds from its log and reads back the same head.
head1=$(curl -s $U/v1/head); stop_node; start_node; head2=$(curl -s $U/v1/head)
check "after a restart the node reads back the same head" "$(is "$head1" "$head2")" "$head2"
r=$(n host/signer.cljs reconcile "$O/bot-signer" $U | field match)
check "signer, ledger and journal reconcile" "$(is "$r" True)" "$r"

# Expiry and an ambiguous submission, on a second funded unit.
fund fund-2 | n host/signer.cljs submit - $U > /dev/null
n host/signer.cljs reserve "$O/bot-signer" $U order-b 1 > /dev/null
n host/signer.cljs propose "$O/bot-signer" order-b acceptance-b "$P" 1 | remote host/signer.cljs sign $PK > "$O/tx-b.json"
r=$(n host/signer.cljs submit "$O/bot-signer" $U < "$O/tx-b.json" | field cause)
check "an expired settlement is refused and its reservation released" "$(is "$r" :expired)" "$r"
n host/signer.cljs reserve "$O/bot-signer" $U order-c 1 > /dev/null
n host/signer.cljs propose "$O/bot-signer" order-c acceptance-c "$P" 600000 | remote host/signer.cljs sign $PK > "$O/tx-c.json"
stop_node
r=$(n host/signer.cljs submit "$O/bot-signer" $U < "$O/tx-c.json" | field ambiguous)
check "a submission with no answer is held as ambiguous" "$(is "$r" True)" "$r"
start_node
r=$(n host/signer.cljs reconcile "$O/bot-signer" $U | field match)
c=$(python3 -c "import json;print(json.load(open('$O/bot-signer/reservations/order-c.json'))['state'])")
check "reconcile resolves the ambiguous one from the log without resubmitting" "$( [ "$r" = True ] && [ "$c" = :released ] && echo 0 || echo 1)" "$r $c"

# Tampered log: a copy with one changed amount must not start.
cp -R "$O/node" "$O/node-tampered"
python3 - "$O/node-tampered/log.jsonl" <<'EOF'
import sys; p=sys.argv[1]; s=open(p).read(); open(p,"w").write(s.replace('"amount":1','"amount":2',1))
EOF
r=$(n host/node.cljs check "$O/node-tampered" | field cause)
check "a node with a tampered log refuses to start" "$(is "$r" "log chain broken")" "$r"

final=$(curl -s $U/v1/head); journal=$(curl -s $U/v1/journal)
balances=$(n host/node.cljs check "$O/node")
stop_node
python3 - "$O" "$PASS" "$TOTAL" "$HOST" "$S" "$B" "$P" "$OP" "$final" "$journal" "$balances" <<'EOF'
import json,sys
o,p,t,host,s,b,pr,op,final,journal,bal=sys.argv[1:]
checks=[json.loads(l) for l in open(o+"/checks.jsonl")]
ev={"schema":"awai.en-devnet.v3b-evidence/1","issue":"AWAI-3121","chain-id":"awai-en-devnet/adr0027-v3b",
    "value-class":"devnet","finality":"single-operator-devnet","provider-host":host,
    "roles":{"sponsor":s,"bot":b,"provider-operator":pr,"node-operator":op},
    "head":json.loads(final),"journal":json.loads(journal),"node-check":json.loads(bal),
    "checks":checks,"passed":int(p),"total":int(t)}
json.dump(ev,open(o+"/evidence.json","w"),indent=2); print(f"{p} of {t} checks")
EOF
[ "$PASS" = "$TOTAL" ]
