# Sanka core

The pure core of Sanka (参加), where a person or a bot takes part in the Bot economy, with a receipt
verifier. This is stages V0 and V1 of `network-awai/network-awai-apex` ADR 0027 (AWAI-177). It has
no screen, service, keys or ledger, and it is **not built into the OS image**.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/sanka/core.cljc` | ClojureScript, Babashka and Basilisp, unchanged |
| Shared runner | `test/sanka/runner.cljc` | The same three |
| Platform entry points | `test/run_cases.cljs`, `.clj`, `.lpy` | One each |
| Shared data | `test/cases.json`, `test/scenarios.json` | All of them |
| Data generator | `test/gen_cases.lpy` | Basilisp, only to rewrite the JSON |
| Receipt verifier | `tools/verify_receipt.lpy` | Basilisp with `cryptography` |
| Real order and attacks | `test/live_v1.py` | Python, driving real processes |
| Provider desk (V2) | `provider/desk.cljs` | nbb, on the provider host |
| Order on another Mac (V2) | `test/live_v2.py` | Python, over SSH and an SSH tunnel |
| One order end to end (V5) | `test/live_v5.py` | Python, driving the emulator, the provider host and the EN node |

## What the core decides

- **Orders.** `check-order` refuses unknown fields, an order to yourself, a node as the payee, and
  any `live` order. Only `compute` is open. `storage` and `human` wait for their own gates.
- **Receipts.** `check-receipt` compares a receipt with pins from the order. The fields are a closed
  set, so a prompt or an output has nowhere to go, and the input must be a hash under the order's key.
- **Acceptance.** `check-acceptance` refuses a provider or node judging its own work.
- **States.** `transition` and `walk` follow ADR 0027 D6. A missing fact is not a yes: approval needs
  a person, a reservation needs a known balance, and nothing leaves `submitted` by submitting again.
- **Display.** `balance-view` shows an unknown balance as `unknown`, never as 0. `total` refuses to
  add different assets or value classes.

The core does no hashing or signature checks. The host verifies those and passes the result in as
a pin or a fact, so a host that lies about a fact defeats the core.

## Check

From this directory, `nix/shell.nix` gives Babashka and Basilisp. The pinned nixpkgs has no `nbb`,
so nbb comes from outside the pin.

```bash
nix-shell nix/shell.nix --run 'bb --classpath src:test test/run_cases.clj'
```

```bash
PYTHONDONTWRITEBYTECODE=1 nix-shell nix/shell.nix --run 'PYTHONPATH=src:test basilisp run test/run_cases.lpy'
```

```bash
nbb --classpath src:test test/run_cases.cljs
```

Basilisp writes bytecode beside its sources unless `PYTHONDONTWRITEBYTECODE=1` is set, and the Nix
store is read-only, so it fails without it.

The `Sanka VM gate` workflow runs the first two and then `dapps/sanka/nix/vm-v1.nix`. It is an
Otehon job, not a required check, and the native profile does not depend on it.

The generated JSON is checked in. To change a case, edit `test/gen_cases.lpy` and run `basilisp run test/gen_cases.lpy`.

## Evidence (2026-11-07, Apple M1 Max, macOS host)

Versions: nbb 1.4.208 on Node 26.0.0, Babashka 1.12.218, Basilisp 0.5.1 on Python 3.13.5.

| Check | Result |
| --- | --- |
| 398 cases and 14 scenario pairs on all three | 426 of 426, exit 0 |
| Every state the table can reach | Reached by a scenario, or the run fails |
| One changed expectation | 1 failure on all three, exit 1 |
| Core changed to allow paying before acceptance and to ignore an unknown balance | 5 failures on all three, exit 1 |

Each order, receipt and acceptance case changes one field of a good document. Each scenario pairs a
correct walk with the walk that has to be refused in the same situation.

## Device provider core (AWAI-3115, stages C1a and C1b-1)

`src/sanka/device.cljc` is what an Android phone or PC enforces before it serves one compute order
as a provider ([AWAI-3190](https://linear.app/kotobalabs/issue/AWAI-3190)). It is pure like the core: the host
reads the battery, thermal and network state from Android and passes them in as facts.

| Function | What it decides |
| --- | --- |
| `check-offer` | An `awai.compute-offer/1`: pinned model and engine, amount per order, `simulation` or `devnet` only (`live` is refused), provider and node kept apart, and the device limits (lowest battery, charging required, highest Android thermal status 0–6, metered network allowed, orders per day). Since C1b-1 also the mailbox (`https://` origin with a lowercase host and no port or path, and a 32-hex topic), the X25519 seal key (`x25519:` and 64 hex) and the buyers: 1 to 16 distinct `did:key`, none of them the provider or the node (ADR 0051 D2–D4) |
| `offer-transition` | `draft → offered ⇄ paused`, `withdrawn` and `expired` are final. Publishing and resuming need the fact that the person chose to offer the device |
| `admit-order` | Whether to take an order now, or the first refusal in a fixed order: offer, order, offer state, order against offer, missing device facts, buyer not on the offer's list, missing device facts, already run, expiry, charging, battery, heat, metered network, busy (one order at a time), daily cap. A missing or mistyped fact refuses. An order the host already ran is refused even after it expired; the host may send back the result it kept |
| `receipt-body` | The `awai.work-receipt/1` body the host signs. It refuses an engine other than the offer's and more completion tokens than the order allowed |
| `check-order-envelope` | The opened `awai.compute-order/1`: the offer's CID, the order, its CID, the prompt and the reply (a topic and an X25519 key only). The reply has no origin field, so it can only go back to the offer's mailbox; a reply topic equal to the offer's topic is refused |
| `result-envelope` | The `awai.compute-result/1` the device seals back: the refusal reason, or the output with the signed receipt for this order |
| `check-result-envelope` | The buyer's check of an opened result. A served order's receipt goes through `sanka.core/check-receipt` with the buyer's pins |

```bash
bb --classpath src:test test/run_device_cases.clj
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src:test basilisp run test/run_device_cases.lpy
nbb --classpath src:test test/run_device_cases.cljs
```

`test/device_cases.json` is written by `bb test/gen_device_cases.clj`; its expectations are written by
hand. The receipt round-trip cases add the signer and signature a host would add and run
`sanka.core/check-receipt` on the result.

Evidence (2026-11-18, Apple M1 Max, macOS host; Babashka, Basilisp and nbb from the user's bin and
Homebrew, not `nix/shell.nix`):

| Check | Result |
| --- | --- |
| 93 cases on Babashka, Basilisp and nbb | 93 of 93 on each |
| One changed expectation | 1 failure, exit 1 |
| Core changed to ignore the battery limit and to allow a `live` offer | 4 failures on each, exit 1 |
| Generator run twice | Same file |

C1b-1 evidence (2026-11-22, same host and tools, [AWAI-3757](https://linear.app/kotobalabs/issue/AWAI-3757)):

| Check | Result |
| --- | --- |
| 150 cases on Babashka, Basilisp and nbb | 150 of 150 on each |
| One changed expectation | 1 failure, exit 1 |
| Core changed to ignore the buyer list and the already-run fact, and to accept a reply that names an origin | 4 failures on each, exit 1 |
| Generator run twice | Same file |

The HPKE seal and open, the mailbox and the signatures are the host's (ADR 0051 D3). The receipt
verifier (`tools/verify_receipt.lpy`) accepts only Ed25519 `did:key` signers, while the existing
Android key in `android/sanka` is a Keystore P-256 key. Whether the phone's Keystore can make a
non-exportable Ed25519 node key, or the verifier should also accept P-256, is decided in C1b-3 on
a device.

Not done here: no device, network, key, signature or ledger is involved. The mailbox Worker is
C1b-2 (`deploy/awai-mailbox`), the buyer is C1b-4 (below); the Murakumo provider service (C1b-3)
and on-device evidence are the next units of AWAI-3115.

## Buyer through the mailbox (AWAI-3115, stage C1b-4)

The owner's bot sends one compute order to a device through its offer's mailbox
(`https://mailbox.awai.network`, ADR 0051) and checks the sealed result
([AWAI-3781](https://linear.app/kotobalabs/issue/AWAI-3781)). It runs on nbb (ADR 0026 D3).

| File | What it is |
| --- | --- |
| `host/sanka/hpke.cljs` | HPKE (RFC 9180), base mode: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305, on `node:crypto` |
| `host/sanka/wire.cljs` | What buyer and provider compute the same way: canonical JSON, CIDs, Ed25519 `did:key`, document signatures, sealed messages |
| `host/sanka/buyer.cljs` | `prepare-order` and `read-result` (no I/O), and `post!` and `subscribe!` to the offer's own mailbox |
| `buyer/cli.cljs` | `order ROOT OFFER.json ORDER.json PROMPT.txt` and `wait ROOT ORDER-CID [SECONDS]` |
| `test/host/fake_provider.cljs` | What C1b-3's Murakumo will do with one order, with a given output instead of a model |

### Host protocol

The Murakumo provider service (C1b-3) has to do the same, byte for byte.

| Item | Rule |
| --- | --- |
| Offer and order CIDs | `cid-of(canonical(document))`, CIDv1 dag-json sha2-256 in base32, as the provider desk computes them |
| Sealed message | base64url without padding of the 32-byte encapsulated key followed by the ciphertext. Empty AAD, sequence 0, one HPKE context per message |
| Order `info` | `awai.compute-order/1 <offer-cid>`, sealed to the offer's `seal-key`, posted to the offer's topic |
| Result `info` | `awai.compute-result/1 <offer-cid> <order-cid>`, sealed to the order's reply key, posted to the reply topic on the same origin |
| Plaintext | Canonical JSON of the `awai.compute-order/1` or `awai.compute-result/1` envelope (`sanka.device`) |
| Receipt `input` | `hmac-sha256:` and the hex HMAC-SHA256 of the prompt's UTF-8 bytes, keyed by the order context's `Export("awai.compute-input/1", 32)`. Only buyer and provider can derive the key |
| Receipt `output` | `cid-of(canonical({"content": output, "role": "assistant"}))` |
| Receipt signature | Ed25519 by the node's `did:key` over the canonical receipt without `signature`, as the provider desk signs |
| `x-expires` | The order's `expires-at`, at most one hour ahead |

The buyer refuses before sealing when the offer fails `check-offer`, the order's buyer is not on the
offer, the order or offer has expired, or the envelope fails `check-order-envelope`. A message on
the reply topic that does not open for this order is skipped. A result that opens must pass
`check-result-envelope`, the signature, the output CID and the keyed input hash.

```bash
nbb -cp host test/host/hpke_test.cljs
nbb -cp src:host:test/host test/host/buyer_test.cljs
MAILBOX_LIVE=https://mailbox.awai.network nbb -cp src:host:test/host test/host/buyer_test.cljs
```

The pinned Nix shell has no nbb, so these are not in `scripts/ci/sanka-vm-gate.sh`.

Evidence (2026-11-22, Apple M1 Max, macOS, nbb 1.4.208 on Node 26.0.0):

| Check | Result |
| --- | --- |
| RFC 9180 A.2.1 (shared secret, key, nonce, exporter, three exports, ciphertext, open; both ends) | 0 failures |
| Buyer and fake provider, in memory | 25 of 25 |
| Once more through the live `mailbox.awai.network` | 29 of 29 |
| `buyer/cli.cljs order` and `wait` through the live mailbox, with a fake provider process | Both exit 0. Files are mode 0600, the reply key is removed after the result is read, no stored file holds the prompt |
| Python `cryptography` 3.11 checks an nbb-signed receipt the way `tools/verify_receipt.lpy` does | Verifies; a changed receipt does not |
| Buyer changed to skip the signature, the output, the input or the buyer list, or not to cap `x-expires` | Each fails exactly its check |
| HPKE changed to label `HPKE-v2` | 15 vector failures. The round trip still passes, since both ends share the code: the RFC vector is what guards interoperability |

Not done here: the owner's approval of the order and the en-devnet acceptance (ADR 0027), a
device, and a model. The provider in these tests is a fake.

## A real order (stage V1)

`test/live_v1.py` starts `llama-server` and the Hy gateway from
`network-awai/cloud-kotoba-desktop` (`gateway-hy/kotoba_gateway/orders.hy`), runs an order, and then
tries to break it. `tools/verify_receipt.lpy` shares no code with the gateway. It works out the CIDs,
the keyed input hash and the signature itself.

Evidence: [`docs/evidence/sanka-v1-20261107.json`](../../docs/evidence/sanka-v1-20261107.json), from
llama.cpp 0.7.0 and `stories15M-q4_0.gguf` on an Apple M1 Max, on the macOS host.

| Check | Result |
| --- | --- |
| Whole run | 29 of 29 checks |
| The verifier accepts the real receipt, and agrees with the gateway on both CIDs | Yes |
| A changed output, padded measurement, forged signature, other request, wrong key, other order, or receipt carrying the prompt | Each refused by the verifier |
| A used or unknown key, another model, a live order, another node, or an engine serving another file | Each refused by the gateway |
| A restart | The receipt reads back the same, and the key stays spent |
| Files the provider keeps | No prompt, output or key |
| Gateway changed to lie about the output and keep plain text | 3 checks fail, exit 1 |

The demand class is `replay`, because this is a test and not real demand. The order has no value and
moves nothing. The model is a small test model, so its text is not a useful answer.

### In a NixOS VM (2026-11-07, GitHub Actions)

`dapps/sanka/nix/vm-v1.nix` runs the same harness in a NixOS VM with no network, on an x86_64 GitHub
Actions runner with KVM. The gateway is pinned to `cloud-kotoba-desktop` `1f8fe2b`, and the engine is
nixpkgs llama.cpp 9190, not the 0.7.0 used on the host.

Evidence: [`docs/evidence/sanka-v1-vm-20261107.json`](../../docs/evidence/sanka-v1-vm-20261107.json),
from [run 42351054943](https://github.com/network-awai/awai-os/actions/runs/42351054943).

| Check | Result |
| --- | --- |
| Babashka and Basilisp on Nix | 426 of 426 each |
| The VM reaches `huggingface.co` | No |
| Whole run | 29 of 29 checks, 24 completion tokens |
| Gateway changed to lie about the output and keep plain text | 3 checks fail, exit 1 |
| VM step | 861 seconds |

Each run takes about 410 seconds, although the measured inference is under a second. Where the time
goes is not measured.

### What V1 does not show

- No Otehon image was built. The VM is a test machine, not a complete Awai Node, and it is x86_64,
  while the earlier Otehon VMs were aarch64.
- The gateway checks file digests and the path the engine reports. It does not attest what the engine
  really ran, and a dishonest provider could fake a receipt.
- One order allows one call, so a Hermes turn that makes several calls does not fit yet (V2).
- Everything ran on one machine under one operator, so nothing here shows independence.

## Not verified or not implemented

- The macOS evidence above used tools from Homebrew, the user's bin directory and a local `uv`
  environment, not `nix/shell.nix`.
- nbb is not in CI, because the pinned nixpkgs has no `nbb`.
- No screen, signer or ledger uses this core yet. Only the verifier does.

## An order on another Mac (stage V2, AWAI-3103)

The V1 gateway's repository (`network-awai/cloud-kotoba-desktop`) now returns 404 on GitHub, so
`dapps/sanka/nix/vm-v1.nix` can no longer fetch it. V2 adds `provider/desk.cljs`, an nbb desk with
the same receipt format, and runs it on a separate provider Mac (owner decision 2026-11-17: the
provider is a Mac, the buyer later an AOSP VM). See [`provider/README.md`](provider/README.md).

`test/live_v2.py` plays the buyer from another host. It registers each order through the
operator's command over SSH, calls the loopback-only desk through an SSH tunnel, checks the receipt
with `tools/verify_receipt.lpy`, and then tries to break it.

Evidence: [`docs/evidence/sanka-v2-20261118.json`](../../docs/evidence/sanka-v2-20261118.json).
Provider `benjamin` (Darwin arm64, 10 CPUs, 16 GiB). Engine: llama.cpp `9581154a` (the Android
Murakumo pin), built from the verified archive without OpenSSL/curl. Model: Qwen3 0.6B Q8_0, SHA256
`9465e63a…`. Both digests were re-checked on the provider.

| Check | Result |
| --- | --- |
| Whole run | 28 of 28 checks |
| A real answer (25 prompt and 12 completion tokens, measured by the desk) | Names Tokyo; only its hash is in the evidence |
| The independent verifier accepts the receipt | Yes |
| A used, missing, unknown or other order's key; another route | Each refused by the desk |
| Another model, node or provider; a live or expired order; the node as payee; a reused key; a duplicate order | Each refused at registration |
| A changed output or request, the wrong key, a forged signature, another order | Each refused by the verifier |
| Files the provider keeps | No prompt, output or key |
| Desk changed to lie about the output and never spend the key | 3 checks fail, exit 1 |

The demand class is `owner-internal` and the value class `devnet`, but nothing is reserved, signed
or settled yet: the buyer is this harness on a Mac, not Hermes on the AOSP VM, and there is no
signer or ledger in the loop. The wall time (0.18 s for one request through the tunnel) is one
sample, not a latency measurement.

## One owner order end to end (stage V5, AWAI-3141)

`test/live_v5.py` joins V2 (provider desk), V3b (EN node and signers) and V4 (owner cards) with one
real order. The request is the owner's own, chosen on 2026-11-18; the evidence keeps only its hash.

| Where | What runs |
| --- | --- |
| This Mac | EN devnet node, sponsor key, the bot's signer with the owner key enrolled |
| AOSP emulator | Sanka order and acceptance cards (`android/sanka`) |
| benjamin | llama-server, the provider desk, the provider operator's key |

Evidence: [`docs/evidence/sanka-v5-20261118.json`](../../docs/evidence/sanka-v5-20261118.json).

| Step | Result |
| --- | --- |
| Approve tap on the order card → reservation | Yes |
| The provider operator registers the same order; the desk answers through an SSH tunnel | Yes (36 prompt, 59 completion tokens measured by the desk) |
| The independent verifier accepts the real receipt | Yes |
| Accept tap on the acceptance card (a changed answer gets no buttons) | Yes |
| Settlement counter-signed on benjamin, finalized; a second submission refused | Yes |
| Node restart reads back the same head; signer, ledger and journal reconcile | Yes |
| Second order with the desk stopped: no answer, reservation released, nothing paid | Yes |
| Whole run | 19 of 19 checks |

This is one closed internal transaction on a devnet: not revenue, a market, autonomous operation or
distributed finality. The Accept tap came from the harness, not from the owner judging the answer.
Hermes did not propose the order.

