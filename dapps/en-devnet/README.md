# EN devnet ledger core (.cljc Otehon)

The settlement half of the D1 first vertical
([ADR 0027](https://github.com/network-awai/network-awai-apex/blob/main/docs/adr/0027-first-bot-economy-slice-on-otehon.md)
V3), tracked on [AWAI-3101](https://linear.app/kotobalabs/issue/AWAI-3101).
Same saifu pattern as D1, Sanka and reward-loop: one pure core, one shared
case file, two runners. It holds no keys, performs no I/O, moves nothing of
value, and is **not built into the OS image**.

Owner decision (2026-11-17): V3 uses a new minimal EN devnet ledger in this
repository. `kotoba-lang/en` and `kotoba-lang/engi` return 404 on GitHub; the
local `kotoba-lang/en` checkout is a semantic reference only (net-zero,
never below a declared credit floor), not a dependency.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/en_devnet/core.cljc` | Babashka and Basilisp, unchanged |
| Shared cases | `test/cases.json` (37 cases) | Both |
| Case generator | `test/gen_cases.clj` | Babashka. Expectations are hand-written; the core only builds signed inputs |
| Babashka runner | `test/run_cases.clj` | `bb --classpath` |
| Basilisp runner | `test/run_cases.lpy` | `basilisp run` |
| nbb runner | `test/run_cases.cljs` | `nbb --classpath src`, the same runtime as the host layer |
| Node and signers (V3b) | `host/`, `src/en_devnet/host.cljs` | nbb. See [`host/README.md`](host/README.md) |

## What the core decides

- **Genesis.** A chain id under `awai-en-devnet/` (separate from the JUN-168
  validator), `value-class :devnet`, fee cap 0, and accounts with a role
  (`sponsor`, `bot`, `provider`) and a credit floor ≤ 0. Every account opens
  at 0; an opening balance is refused. `adr0027-genesis` fixes the ADR D5
  amounts: sponsor floor -2, bot floor 0, provider floor 0. The sponsor may
  fund only the bot, and the bot may pay only the provider operator. A node
  id is not an account (JUN-28).
- **Transfers.** `:funding` (sponsor → bot) and `:settlement` (bot →
  provider, with Order and Acceptance CIDs and a reserved amount). The first
  refusal is named in a fixed order: `wrong-chain`, `not-devnet`,
  `bad-kind`, `bad-amount`, `fee-over-cap`, `self-transfer`,
  `unknown-account`, `receiver-not-allowlisted`, `bad-expiry`, `expired`,
  `bad-nonce`, `duplicate-nonce` (per spender), `duplicate-transfer`,
  `missing-acceptance`, `missing-reservation`, `over-reservation`,
  `missing-spender-signature`, `missing-receiver-signature` (one-sided
  binding), `foreign-signature`, `unverified-signature`,
  `payload-mismatch`, `below-floor`. A refused transfer leaves the ledger
  unchanged.
- **Signatures.** `signing-payload` is the exact ordered field vector
  (including the chain id) that both parties sign. The host verifies each
  signature over its encoding and passes `{:signer :verified :payload}`;
  the core checks that both parties and only they signed this payload. It
  never computes or verifies a signature itself.
- **Finality.** The single operator's append order. A finalized transfer
  gets the next height and `:finality :single-operator-devnet`. This is
  not BFT or distributed finality.
- **Balances.** A known account returns its balance and floor. An unknown
  account returns `{:known? false}`, never 0. Balances always sum to zero.
- **Accounting (ADR 0027 D7).** Entries derive from finalized log entries
  only. A settlement gives the buyer `provider-expense` and the provider
  `earned-en`; funding gives `credit-extended` and `credit-received`.
  `earned-summary` excludes `owner-internal` demand from the external
  figure. None of these is revenue, cash or a deposit.
- **Three-way reconciliation.** Signer records, ledger log and journal must
  agree. `missing-on-ledger`, `amount-mismatch`, `journal-mismatch`,
  `unexpected-on-ledger` and `journal-without-ledger` stop with
  `:stop true`; nothing is adjusted to match.

## Check

```bash
cd dapps/en-devnet
bb --classpath src:test test/run_cases.clj
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src basilisp run test/run_cases.lpy
nbb --classpath src test/run_cases.cljs
# Regenerate the shared cases after changing an expectation in gen_cases.clj:
bb --classpath src:test test/gen_cases.clj
```

`scripts/ci/sanka-vm-gate.sh cases` runs both through `nix/shell.nix`.

## Evidence (2026-11-17, Apple M1 Max, task worktree)

| Check | Result |
| --- | --- |
| Shared cases on Babashka v1.12.218 | 37 of 37 |
| Shared cases on Basilisp 0.5.1 | 37 of 37 |
| One broken expectation (`owner-internal-excluded` 1 → 0) | 1 failure on each runner, exit 1 |
| Floor check removed from the core | 3 failures on each runner, exit 1 |
| `test/cases.json` sha256 | `81212b8a98ee6600e11e8298bdcb76253ac3309419e1476f7dc2d6c919eaca67` |
| `src/en_devnet/core.cljc` sha256 | `06bcc06ba8914450405129ba3bfbf122d84a81b85cdd31d396a11e069511ad9e` |

Single machine run with locally installed tools, not through `nix-shell`
(Nix is not installed on this host). Repository Actions is disabled, so no
CI result is claimed.

## Node and signers on two hosts (V3b, AWAI-3121)

`host/` adds an nbb node and signers around this core; see [`host/README.md`](host/README.md).
`test/live_v3b.sh` runs the node, the sponsor key and the bot's signer on one Mac, and the provider
operator's key on `benjamin`, where it is created and signs over SSH.

Evidence: [`docs/evidence/en-devnet-v3b-20261118.json`](../../docs/evidence/en-devnet-v3b-20261118.json).

| Check | Result |
| --- | --- |
| Whole run | 20 of 20 checks |
| Fund, reserve, propose, counter-sign on the provider host, finalize | Yes |
| Node restart: same head; signer, ledger and journal reconcile | Yes |
| Unknown balance, unfunded bot, over policy, held unit, receiver outside allowlist | Each refused by the signer |
| Bot signature alone, signatures over other content, a second submission, an expired settlement | Each refused by the node |
| Provider key asked to sign a transfer it is not party to | Refused |
| Submission with no answer | Held as ambiguous, resolved from the log by reconcile, not resubmitted |
| Tampered log | The node refuses to start |
| Node changed to accept any signature | The harness fails, exit 1 (see evidence) |

## Not implemented

- Key custody beyond 0600 files (hardware keystore, passkey, ADR 0021 signer service).
- A trusted clock, replication of the node's log, and more than one operator.
- Wiring to the D1 reservation ledger (`dapps/d1/src/d1/reservation.cljc`).
- Binding the settlement to the V2 receipt and an acceptance signed on the AOSP buyer, and the
  confirmation card (V4).
- The two-node run (V5) and any real-asset settlement (V6, separate owner approval).
- A Native `.kotoba` implementation (ADR 0027 D12).
