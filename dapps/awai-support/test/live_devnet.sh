#!/usr/bin/env bash
# AWAI-3169: one support to Awai Network LLC's awai-support bot on the EN devnet, end to end on
# one host: consent card -> approval of that card -> sponsor and bot each sign with their own key
# -> the node finalizes -> balance and journal read back -> receipt. Plus negative controls where
# nothing may reach the node.
#
# The approval is a scripted answer; the on-device consent screen is AWAI-3170. Nothing here is
# money, a donation or revenue: value-class devnet, single-operator finality.
#
# usage (from dapps/awai-support): test/live_devnet.sh OUT_DIR
# Exit 0 only when every check passes.
set -uo pipefail
O=$1; PORT=${PORT:-18793}; U=http://127.0.0.1:$PORT; C=awai-en-devnet/awai-3169
EN=../en-devnet
sup(){ nbb -cp src:$EN/src host/support.cljs "$@"; }
sig(){ (cd $EN && nbb -cp src host/signer.cljs "$@"); }
node(){ (cd $EN && nbb -cp src host/node.cljs "$@"); }
field(){ python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('$1'))"; }
mkdir -p "$O"; O=$(cd "$O" && pwd); PASS=0; TOTAL=0; RESULTS=$O/checks.jsonl; : > "$RESULTS"
check(){ set -- "$1" "$2" "${3:-}"
  TOTAL=$((TOTAL+1)); if [ "$2" = 0 ]; then PASS=$((PASS+1)); echo "PASS $1"; ok=true; else echo "FAIL $1  $3"; ok=false; fi
  python3 -c 'import json,sys;print(json.dumps({"check":sys.argv[1],"passed":sys.argv[2]=="true","detail":sys.argv[3]}))' "$1" "$ok" "$3" >> "$RESULTS"; }
is(){ [ "$1" = "$2" ] && echo 0 || echo 1; }
height(){ curl -s $U/v1/head | field height; }
answer(){ python3 -c 'import json,sys;c=json.load(open(sys.argv[1]));json.dump({"approved":sys.argv[2]=="yes","card":c},open(sys.argv[3],"w"))' "$@"; }

curl -fs $U/v1/head >/dev/null && { echo "port $PORT already serving" >&2; exit 2; }
S=$(sig keygen "$O/sponsor.pem" | field did)
B=$(sig keygen "$O/awai-support-bot.pem" | field did)
OP=$(sig keygen "$O/operator.pem" | field did)
P=$(sig keygen "$O/provider.pem" | field did)
node init "$O/node" $C "$OP" "$S" "$B" "$P" > /dev/null
node serve "$O/node" $PORT >> "$O/node.log" 2>&1 &
for i in $(seq 1 40); do curl -fs $U/v1/head >/dev/null && break; sleep 0.5; done
trap 'pkill -f "host/node.cljs serve $O/node $PORT"' EXIT

# The card names the recipient and devnet before anything is signed.
sup card en-devnet $C "$S" "$B" 1 support-1 600000 > "$O/card.json"
r=$(python3 -c "import json;c=json.load(open('$O/card.json'));print(c['recipient']['legal-name'],c['value-class'],c['wording'])")
check "the card names Awai Network LLC, devnet and support wording" "$(is "$r" "Awai Network LLC :devnet :support")" "$r"
r=$(sup card card $C "$S" "$B" 1 support-x 600000 | field cause)
check "the card route is not offered yet" "$(is "$r" :route-unavailable)" "$r"

# Negative controls: none of these may reach the node.
h0=$(height)
answer "$O/card.json" no "$O/answer-no.json"
r=$(sup decide "$O/card.json" "$O/answer-no.json"); rc=$?
check "a denied card produces no transfer" "$( [ "$rc" = 3 ] && [ "$(echo "$r" | field cause)" = :denied ] && echo 0 || echo 1)" "$r rc=$rc"
python3 - "$O/card.json" "$O/answer-other.json" <<'EOF'
import json,sys; c=json.load(open(sys.argv[1])); c["amount"]=2; json.dump({"approved":True,"card":c},open(sys.argv[2],"w"))
EOF
r=$(sup decide "$O/card.json" "$O/answer-other.json" | field cause)
check "approving a different amount produces no transfer" "$(is "$r" :card-mismatch)" "$r"
check "the node is unchanged after the refusals" "$(is "$(height)" "$h0")" "$h0"
r=$(sup decide "$O/card.json" "$O/answer-no.json" | sig sign "$O/sponsor.pem" | field cause)
check "a refusal piped onward is not signable" "$( [ -n "$r" ] && [ "$r" != None ] && echo 0 || echo 1)" "$r"

# The approved support.
curl -s "$U/v1/accounts/$B" > "$O/before.json"
answer "$O/card.json" yes "$O/answer-yes.json"
sup decide "$O/card.json" "$O/answer-yes.json" > "$O/tx.json"
sig sign "$O/sponsor.pem" < "$O/tx.json" > "$O/tx-sponsor.json"
r=$(sig submit - $U < "$O/tx-sponsor.json" | field cause)
check "the sponsor's signature alone does not finalize" "$(is "$r" :missing-receiver-signature)" "$r"
sig sign "$O/awai-support-bot.pem" < "$O/tx-sponsor.json" > "$O/tx-both.json"
sig submit - $U < "$O/tx-both.json" > "$O/decision.json"
check "the two-party support transfer finalizes" "$(is "$(field finalized < "$O/decision.json")" True)" "$(cat "$O/decision.json")"
r=$(sig submit - $U < "$O/tx-both.json" | field cause)
check "the same support cannot finalize twice" "$(is "$r" :duplicate-nonce)" "$r"
curl -s "$U/v1/accounts/$B" > "$O/after.json"
curl -s "$U/v1/journal" > "$O/journal.json"
sup receipt "$O/card.json" "$O/decision.json" "$O/before.json" "$O/after.json" "$O/journal.json" > "$O/receipt.json"
check "the bot's balance and journal read back as received" "$(is "$(field received < "$O/receipt.json")" True)" "$(cat "$O/receipt.json")"
r=$(curl -s $U/v1/head | field net-zero)
check "balances still sum to zero" "$(is "$r" True)" "$r"

# Restart: the node rebuilds from its log and still shows the receipt.
head1=$(curl -s $U/v1/head); pkill -f "host/node.cljs serve $O/node $PORT"
for i in $(seq 1 20); do curl -fs $U/v1/head >/dev/null || break; sleep 0.5; done
node serve "$O/node" $PORT >> "$O/node.log" 2>&1 &
for i in $(seq 1 40); do curl -fs $U/v1/head >/dev/null && break; sleep 0.5; done
head2=$(curl -s $U/v1/head)
check "after a restart the node reads back the same head" "$(is "$head1" "$head2")" "$head2"

python3 - "$O" "$PASS" "$TOTAL" "$S" "$B" "$OP" "$head2" <<'EOF'
import json,sys
o,p,t,s,b,op,head=sys.argv[1:]
ev={"schema":"awai.support-devnet-evidence/1","issue":"AWAI-3169","parent":"AWAI-3112",
    "recipient":"Awai Network LLC","wording":"support (寄付 wording undecided)",
    "chain-id":"awai-en-devnet/awai-3169","value-class":"devnet","finality":"single-operator-devnet",
    "approval":"scripted answer; on-device consent screen is AWAI-3170",
    "roles":{"sponsor":s,"awai-support-bot":b,"node-operator":op},
    "card":json.load(open(o+"/card.json")),"decision":json.load(open(o+"/decision.json")),
    "receipt":json.load(open(o+"/receipt.json")),"journal":json.load(open(o+"/journal.json")),
    "head":json.loads(head),"checks":[json.loads(l) for l in open(o+"/checks.jsonl")],
    "passed":int(p),"total":int(t)}
json.dump(ev,open(o+"/evidence.json","w"),indent=2,ensure_ascii=False); print(f"{p} of {t} checks")
EOF
[ "$PASS" = "$TOTAL" ]
