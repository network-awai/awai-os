#!/usr/bin/env python3
"""Writes test/cases.json and test/scenarios.json from one good order and receipt.

Each negative control changes one field of a good document, so a case cannot pass for a reason
other than the one it names. The JSON files are the shared data, and they are checked in.
usage: python3 test/gen_cases.py
"""
import copy
import json
import os

BUYER = "did:key:zBuyer"
PROVIDER = "did:key:zProvider"
NODE = "did:key:zNode"
OWNER = "did:key:zOwner"
SHA_A = "sha256:" + "a" * 64
SHA_B = "sha256:" + "b" * 64
HMAC = "hmac-sha256:" + "c" * 64
ORDER_CID = "b" + "a" * 58
OTHER_CID = "b" + "c" * 58
OUTPUT_CID = "b" + "d" * 58
HEAD_CID = "b" + "e" * 58
RECEIPT_CID = "b" + "f" * 58

ORDER = {
    "kind": "awai.order/1",
    "work-kind": "compute",
    "buyer": BUYER,
    "provider": PROVIDER,
    "node": NODE,
    "asset": "native/engi/EN",
    "amount": "1",
    "value-class": "devnet",
    "model": {"revision": "rev-1", "digest": SHA_A},
    "max-tokens": 64,
    "expires-at": 2000000000,
    "data-categories": ["prompt"],
    "policy": SHA_B,
    "demand": "owner-internal",
    "nonce": "n-1",
}

RECEIPT = {
    "kind": "awai.work-receipt/1",
    "work-kind": "compute",
    "order": ORDER_CID,
    "provider": PROVIDER,
    "node": NODE,
    "input": HMAC,
    "output": OUTPUT_CID,
    "engine": {"name": "llama.cpp", "version": "0.7.0", "digest": SHA_B},
    "model": {"revision": "rev-1", "digest": SHA_A},
    "measured": {"prompt-tokens": 3, "completion-tokens": 5, "started-at": 100, "finished-at": 101},
    "ledger-head": HEAD_CID,
    "demand": "owner-internal",
    "nonce": "n-1",
    "signer": NODE,
    "signature": "sig",
}

RECEIPT_PINS = {
    "order-cid": ORDER_CID,
    "provider": PROVIDER,
    "node": NODE,
    "model-digest": SHA_A,
    "demand": "owner-internal",
    "nonce": "n-1",
}

ACCEPTANCE = {
    "kind": "awai.acceptance/1",
    "order": ORDER_CID,
    "receipt": RECEIPT_CID,
    "acceptor": OWNER,
    "verdict": "accepted",
    "at": 102,
}

ACCEPTANCE_PINS = {
    "order-cid": ORDER_CID,
    "receipt-cid": RECEIPT_CID,
    "acceptor": OWNER,
    "provider": PROVIDER,
    "node": NODE,
}


def changed(document, path, value):
    """A copy of the document with one field set."""
    out = copy.deepcopy(document)
    target = out
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return out


def without(document, key):
    out = copy.deepcopy(document)
    del out[key]
    return out


def refused(*errors):
    return {"ok": False, "errors": list(errors)}


OK = {"ok": True}


def order_cases():
    rows = [
        (ORDER, OK),
        (changed(ORDER, ["prompt"], "secret"), refused("order/unknown-field")),
        (changed(ORDER, ["kind"], "awai.order/2"), refused("order/kind")),
        (changed(ORDER, ["work-kind"], "mining"), refused("order/work-kind")),
        (changed(ORDER, ["work-kind"], "storage"), refused("order/work-kind-not-open")),
        (changed(ORDER, ["work-kind"], "human"), refused("order/work-kind-not-open")),
        (changed(ORDER, ["buyer"], "0xabc"), refused("order/buyer")),
        (changed(ORDER, ["provider"], "nope"), refused("order/provider")),
        (changed(ORDER, ["node"], "did:web:x"), refused("order/node")),
        (changed(ORDER, ["buyer"], PROVIDER), refused("order/self-dealing")),
        (changed(ORDER, ["node"], PROVIDER), refused("order/node-as-payee")),
        (changed(ORDER, ["asset"], ""), refused("order/asset")),
        (changed(ORDER, ["amount"], "0"), refused("order/amount")),
        (changed(ORDER, ["amount"], "1.5"), refused("order/amount")),
        (changed(ORDER, ["amount"], 1), refused("order/amount")),
        (changed(ORDER, ["value-class"], "real"), refused("order/value-class")),
        (changed(ORDER, ["value-class"], "live"), refused("order/live-not-approved")),
        (changed(ORDER, ["model", "digest"], "sha256:short"), refused("order/model")),
        (changed(ORDER, ["max-tokens"], 0), refused("order/max-tokens")),
        (changed(ORDER, ["max-tokens"], True), refused("order/max-tokens")),
        (changed(ORDER, ["expires-at"], -1), refused("order/expires-at")),
        (changed(ORDER, ["data-categories"], []), refused("order/data-categories")),
        (changed(ORDER, ["policy"], "x"), refused("order/policy")),
        (changed(ORDER, ["demand"], "synthetic"), refused("order/demand")),
        (changed(ORDER, ["nonce"], ""), refused("order/nonce")),
        (without(ORDER, "nonce"), refused("order/nonce")),
    ]
    return [{"fn": "check-order", "args": [order], "expect": expect} for order, expect in rows]


def receipt_cases():
    rows = [
        (RECEIPT, OK),
        # A body cannot ride along in a receipt.
        (changed(RECEIPT, ["prompt"], "secret"), refused("receipt/unknown-field")),
        (changed(RECEIPT, ["output-text"], "secret"), refused("receipt/unknown-field")),
        (changed(RECEIPT, ["kind"], "itonami.agent-step-receipt/2"), refused("receipt/kind")),
        (changed(RECEIPT, ["work-kind"], "human"), refused("receipt/work-kind")),
        (changed(RECEIPT, ["order"], OTHER_CID), refused("receipt/other-order")),
        (changed(RECEIPT, ["order"], "nope"), refused("receipt/order", "receipt/other-order")),
        (changed(RECEIPT, ["provider"], BUYER), refused("receipt/provider")),
        (changed(RECEIPT, ["node"], BUYER), refused("receipt/node")),
        (changed(RECEIPT, ["signer"], BUYER), refused("receipt/signer")),
        (changed(RECEIPT, ["signature"], ""), refused("receipt/signature")),
        (changed(RECEIPT, ["input"], SHA_A), refused("receipt/input")),
        (changed(RECEIPT, ["output"], "nope"), refused("receipt/output")),
        (changed(RECEIPT, ["engine", "digest"], "x"), refused("receipt/engine")),
        (changed(RECEIPT, ["model", "digest"], SHA_B), refused("receipt/other-model")),
        (changed(RECEIPT, ["measured", "prompt-tokens"], -1), refused("receipt/measured")),
        (changed(RECEIPT, ["measured", "finished-at"], 99), refused("receipt/measured")),
        (changed(RECEIPT, ["ledger-head"], ""), refused("receipt/ledger-head")),
        (changed(RECEIPT, ["demand"], "external"), refused("receipt/demand")),
        (changed(RECEIPT, ["nonce"], "n-2"), refused("receipt/nonce")),
    ]
    return [
        {"fn": "check-receipt", "args": [receipt, RECEIPT_PINS], "expect": expect}
        for receipt, expect in rows
    ]


def acceptance_cases():
    rows = [
        (ACCEPTANCE, ACCEPTANCE_PINS, OK),
        (changed(ACCEPTANCE, ["verdict"], "rejected"), ACCEPTANCE_PINS, OK),
        (changed(ACCEPTANCE, ["body"], "x"), ACCEPTANCE_PINS, refused("acceptance/unknown-field")),
        (changed(ACCEPTANCE, ["kind"], "x"), ACCEPTANCE_PINS, refused("acceptance/kind")),
        (changed(ACCEPTANCE, ["order"], OTHER_CID), ACCEPTANCE_PINS, refused("acceptance/other-order")),
        (changed(ACCEPTANCE, ["receipt"], OTHER_CID), ACCEPTANCE_PINS, refused("acceptance/other-receipt")),
        (changed(ACCEPTANCE, ["acceptor"], BUYER), ACCEPTANCE_PINS, refused("acceptance/acceptor")),
        (
            changed(ACCEPTANCE, ["acceptor"], PROVIDER),
            changed(ACCEPTANCE_PINS, ["acceptor"], PROVIDER),
            refused("acceptance/self-judged"),
        ),
        (
            changed(ACCEPTANCE, ["acceptor"], NODE),
            changed(ACCEPTANCE_PINS, ["acceptor"], NODE),
            refused("acceptance/self-judged"),
        ),
        (changed(ACCEPTANCE, ["verdict"], "maybe"), ACCEPTANCE_PINS, refused("acceptance/verdict")),
        (changed(ACCEPTANCE, ["at"], 0), ACCEPTANCE_PINS, refused("acceptance/at")),
    ]
    return [
        {"fn": "check-acceptance", "args": [acceptance, pins], "expect": expect}
        for acceptance, pins, expect in rows
    ]


FACTS = {
    "approve": {"human-approved": True},
    "reserve": {"balance-known": True, "available": "1", "amount": "1"},
    "start": {"reservation-persisted": True},
    "receipt": {"receipt-verified": True},
    "accept": {"acceptance-verified": True},
    "submit": {"amount": "1", "reserved": "1"},
    "record": {"readback-match": True},
}

# Every state, and every event the table allows from it.
TABLE = {
    "proposed": {"approve": "approved", "deny": "denied"},
    "approved": {"reserve": "reserved", "refuse": "refused"},
    "reserved": {"start": "executing", "expire": "expired"},
    "executing": {"receipt": "receipted", "fail": "failed", "expire": "expired"},
    "receipted": {"accept": "accepted", "reject": "rejected", "expire": "expired"},
    "accepted": {"submit": "submitted", "release": "released"},
    "submitted": {"finalize": "finalized", "lose-response": "ambiguous"},
    "ambiguous": {"reconcile-finalized": "finalized", "reconcile-absent": "released"},
    "finalized": {"record": "recorded"},
}
TERMINAL = ["denied", "refused", "expired", "failed", "rejected", "released", "recorded"]
RESERVATION = {
    "proposed": "none", "approved": "none", "denied": "none", "refused": "none",
    "reserved": "held", "executing": "held", "receipted": "held", "accepted": "held",
    "submitted": "held", "ambiguous": "held",
    "expired": "released", "failed": "released", "rejected": "released", "released": "released",
    "finalized": "spent", "recorded": "spent",
}
ALL_EVENTS = sorted({event for events in TABLE.values() for event in events})


def transition_cases():
    cases = []
    for state, events in TABLE.items():
        for event in ALL_EVENTS:
            facts = FACTS.get(event, {})
            if event in events:
                expect = {"state": events[event]}
            else:
                expect = {"state": state, "error": "transition/invalid"}
            cases.append({"fn": "transition", "args": [state, event, facts], "expect": expect})
    for state in TERMINAL:
        for event in ALL_EVENTS:
            cases.append({
                "fn": "transition",
                "args": [state, event, FACTS.get(event, {})],
                "expect": {"state": state, "error": "transition/invalid"},
            })
    guards = [
        ("proposed", "approve", {}, "approve/not-human"),
        ("proposed", "approve", {"human-approved": False}, "approve/not-human"),
        ("proposed", "approve", {"human-approved": "true"}, "approve/not-human"),
        ("approved", "reserve", {}, "reserve/balance-unknown"),
        ("approved", "reserve", {"balance-known": False, "available": "0", "amount": "1"},
         "reserve/balance-unknown"),
        ("approved", "reserve", {"balance-known": True, "amount": "1"}, "reserve/amount-unknown"),
        ("approved", "reserve", {"balance-known": True, "available": "0", "amount": "1"},
         "reserve/over-available"),
        ("approved", "reserve", {"balance-known": True, "available": "9", "amount": "10"},
         "reserve/over-available"),
        ("reserved", "start", {}, "start/not-persisted"),
        ("executing", "receipt", {}, "receipt/not-verified"),
        ("receipted", "accept", {}, "accept/not-verified"),
        ("accepted", "submit", {"amount": "2", "reserved": "1"}, "submit/over-reservation"),
        ("accepted", "submit", {}, "submit/over-reservation"),
        ("finalized", "record", {}, "record/readback-mismatch"),
        ("finalized", "record", {"readback-match": False}, "record/readback-mismatch"),
    ]
    for state, event, facts, error in guards:
        cases.append({
            "fn": "transition",
            "args": [state, event, facts],
            "expect": {"state": state, "error": error},
        })
    # A large amount compares as digits, not as a rounded float.
    big = "9007199254740993"
    cases.append({
        "fn": "transition",
        "args": ["approved", "reserve", {"balance-known": True, "available": "9007199254740992", "amount": big}],
        "expect": {"state": "approved", "error": "reserve/over-available"},
    })
    cases.append({
        "fn": "transition",
        "args": ["approved", "reserve", {"balance-known": True, "available": "010", "amount": "9"}],
        "expect": {"state": "reserved"},
    })
    cases.append({"fn": "transition", "args": ["nope", "approve", {}],
                  "expect": {"state": "nope", "error": "transition/invalid"}})
    return cases


def state_cases():
    cases = []
    for state, held in RESERVATION.items():
        cases.append({"fn": "reservation", "args": [state], "expect": held})
        cases.append({"fn": "terminal?", "args": [state], "expect": state in TERMINAL})
    cases.append({"fn": "reservation", "args": ["nope"], "expect": None})
    cases.append({"fn": "terminal?", "args": ["nope"], "expect": False})
    return cases


def line(raw, known=True, asset="native/engi/EN", value_class="devnet"):
    return {"asset": asset, "value-class": value_class, "known": known, "raw": raw}


def balance_cases():
    en = "native/engi/EN"
    view = lambda text, known: {"text": text, "known": known, "asset": en, "value-class": "devnet"}
    rows = [
        (line("5"), view("5", True)),
        (line("007"), view("7", True)),
        (line("0"), view("0", True)),
        # Unknown stays unknown: it never reads as zero.
        (line("0", known=False), view("unknown", False)),
        (line(None, known=False), view("unknown", False)),
        ({"asset": en, "value-class": "devnet"}, view("unknown", False)),
        (line("1.5"), view("unknown", False)),
        (line("5", value_class="real"), {"error": "balance/value-class"}),
        (line("5", asset=""), {"error": "balance/asset"}),
    ]
    cases = [{"fn": "balance-view", "args": [row], "expect": expect} for row, expect in rows]
    totals = [
        ([line("2"), line("3")], {"raw": "5", "asset": en, "value-class": "devnet"}),
        ([line("999"), line("1")], {"raw": "1000", "asset": en, "value-class": "devnet"}),
        # Above 2^53: a float would round this.
        ([line("9007199254740993"), line("1")],
         {"raw": "9007199254740994", "asset": en, "value-class": "devnet"}),
        ([], {"error": "total/empty"}),
        ([line("2"), line("3", value_class="live")], {"error": "total/mixed"}),
        ([line("2"), line("3", value_class="simulation")], {"error": "total/mixed"}),
        ([line("2"), line("3", asset="native/murakumo/KUMO")], {"error": "total/mixed"}),
        ([line("2"), line("3", known=False)], {"error": "total/unknown"}),
    ]
    cases += [{"fn": "total", "args": [lines], "expect": expect} for lines, expect in totals]
    return cases


def step(event, facts=None):
    return {"event": event, "facts": FACTS.get(event, {}) if facts is None else facts}


TO_RESERVED = [step("approve"), step("reserve")]
TO_EXECUTING = TO_RESERVED + [step("start")]
TO_RECEIPTED = TO_EXECUTING + [step("receipt")]
TO_ACCEPTED = TO_RECEIPTED + [step("accept")]
TO_SUBMITTED = TO_ACCEPTED + [step("submit")]


def pair(name, ok_events, ok_state, ok_reservation, refused_events, refused_state, error, reservation):
    """A correct walk, and the walk that has to be refused in the same situation."""
    return {
        "name": name,
        "ok": {"events": ok_events, "expect": {"state": ok_state, "reservation": ok_reservation}},
        "refused": {
            "events": refused_events,
            "expect": {"state": refused_state, "error": error, "reservation": reservation},
        },
    }


def scenarios():
    return [
        pair("the whole order", TO_SUBMITTED + [step("finalize"), step("record")], "recorded", "spent",
             TO_SUBMITTED + [step("finalize"), step("record", {})], "finalized",
             "record/readback-mismatch", "spent"),
        pair("a person says no and nothing is sent", [step("deny")], "denied", "none",
             [step("deny"), step("reserve")], "denied", "transition/invalid", "none"),
        pair("a bot cannot approve for a person", [step("approve")], "approved", "none",
             [step("approve", {})], "proposed", "approve/not-human", "none"),
        pair("an unknown balance is refused", [step("approve"), step("refuse")], "refused", "none",
             [step("approve"), step("reserve", {"balance-known": False, "available": "0", "amount": "1"})],
             "approved", "reserve/balance-unknown", "none"),
        pair("the reservation is saved before the work", TO_EXECUTING, "executing", "held",
             TO_RESERVED + [step("start", {})], "reserved", "start/not-persisted", "held"),
        pair("work can run out of time before it starts", TO_RESERVED + [step("expire")], "expired", "released",
             TO_RESERVED + [step("expire"), step("start")], "expired", "transition/invalid", "released"),
        pair("a failed job pays nothing", TO_EXECUTING + [step("fail")], "failed", "released",
             TO_EXECUTING + [step("fail"), step("receipt")], "failed", "transition/invalid", "released"),
        pair("a receipt has to verify", TO_RECEIPTED, "receipted", "held",
             TO_EXECUTING + [step("receipt", {})], "executing", "receipt/not-verified", "held"),
        pair("rejected work pays nothing", TO_RECEIPTED + [step("reject")], "rejected", "released",
             TO_RECEIPTED + [step("reject"), step("submit")], "rejected", "transition/invalid", "released"),
        pair("no payment without acceptance", TO_ACCEPTED, "accepted", "held",
             TO_RECEIPTED + [step("submit")], "receipted", "transition/invalid", "held"),
        pair("an acceptance has to verify", TO_ACCEPTED, "accepted", "held",
             TO_RECEIPTED + [step("accept", {})], "receipted", "accept/not-verified", "held"),
        pair("accepted work can still be released", TO_ACCEPTED + [step("release")], "released", "released",
             TO_ACCEPTED + [step("submit", {"amount": "2", "reserved": "1"})], "accepted",
             "submit/over-reservation", "held"),
        pair("a lost response is looked up and not sent again",
             TO_SUBMITTED + [step("lose-response"), step("reconcile-finalized"), step("record")],
             "recorded", "spent",
             TO_SUBMITTED + [step("lose-response"), step("submit")], "ambiguous", "transition/invalid", "held"),
        pair("a transfer that never landed is released",
             TO_SUBMITTED + [step("lose-response"), step("reconcile-absent")], "released", "released",
             TO_SUBMITTED + [step("submit")], "submitted", "transition/invalid", "held"),
    ]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    cases = (order_cases() + receipt_cases() + acceptance_cases() + transition_cases()
             + state_cases() + balance_cases())
    for name, data in (("cases.json", cases), ("scenarios.json", scenarios())):
        with open(os.path.join(here, name), "w", encoding="utf-8") as out:
            out.write("[\n")
            out.write(",\n".join(json.dumps(row, ensure_ascii=False) for row in data))
            out.write("\n]\n")
    print(f"{len(cases)} cases, {len(scenarios())} scenario pairs")


if __name__ == "__main__":
    main()
