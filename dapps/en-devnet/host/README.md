# EN devnet node and signers (ADR 0027 V3b)

The host layer around `en-devnet.core`. It runs on nbb, which ADR 0026 D3 allows on the Otehon
execution path. Tracking: [AWAI-3121](https://linear.app/kotobalabs/issue/AWAI-3121).

The value class is always `devnet` and finality is the single operator's append order. Nothing
here is money, revenue, a deposit or a reward, and it is not distributed finality.

| File | Role |
| --- | --- |
| `../src/en_devnet/host.cljs` | Wire encoding, canonical JSON, Ed25519 `did:key`, signatures over the payload bytes |
| `node.cljs` | The single-operator node: `init`, `serve` (loopback only), `check` |
| `signer.cljs` | Key files, funding txs, the bot's signer (`init`, `reserve`, `propose`, `submit`, `reconcile`), and `sign` for any party |
| `../test/live_v3b.sh` | The two-host run and its refusals |

## Node

- The core decides every transfer. The node only turns each wire signature `{signer, sig}` into
  the core's `{signer, verified, payload}`, by verifying Ed25519 over
  `canonical(core/signing-payload tx)`.
- Each finalized transfer is appended to `log.jsonl` as `{seq, prev, now-ms, tx, hash}` and
  fsynced before the node answers. `hash` is the SHA-256 of the canonical entry without `hash`, and
  `prev` chains the entries.
- On start (and with `check`), the node verifies the chain and replays every entry through the core
  with its recorded time, re-verifying the signatures. A broken chain, a bad signature or an entry
  that no longer finalizes stops the node. Nothing is skipped or repaired.
- Routes: `GET /v1/head`, `GET /v1/accounts/<did>` (an unknown account answers `known? false`, never
  0), `GET /v1/log`, `GET /v1/journal`, `POST /v1/transfers`.

## Signers

- One key file per role (sponsor, bot, provider operator, node operator), mode 0600. `sign` signs
  only as the tx's spender or receiver.
- The bot's signer holds a policy: a maximum per order and a receiver allowlist.
  - `reserve` asks the node for the bot's balance. If the node cannot answer, it refuses with
    `balance-unknown`. It writes `reservations/<order>.json` exclusively before anything is signed.
  - `propose` signs a settlement for a reserved order and marks it `signed`.
  - `submit` records `finalized`, or `released` on a refusal. With no answer it records `ambiguous`
    and never resubmits.
  - `reconcile` resolves ambiguous reservations from the node's log, then runs the core's three-way
    check (signer records, ledger log, journal).
  - `release` frees a reservation that was never signed, for example when the provider is down.
    It sends nothing to the node and pays nothing. A signed or ambiguous reservation is never
    released this way (V5, AWAI-3141).
- The provider operator counter-signs on its own host, for example
  `ssh provider 'nbb -cp src host/signer.cljs sign provider.pem' < tx.json`, so the key stays there.

## Not shown

- Key custody beyond a 0600 file: no hardware keystore, passkey or ADR 0021 signer policy service.
- An agent being unable to read the key is not tested. The key file is only kept outside any
  prompt.
- The order and acceptance CIDs in the V3b run are labels. Binding them to the V2 receipt and to an
  acceptance signed on the AOSP buyer is V4–V5.
- One node, one operator, no replication of the log.
