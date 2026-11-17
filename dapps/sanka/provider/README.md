# Sanka provider desk (ADR 0027 V2)

`desk.cljs` serves paid-inference orders on a provider host. One order's key opens exactly one call
to a local llama.cpp server, and the result is an `awai.work-receipt/1` signed by this node's
Ed25519 key. Tracking: [AWAI-3103](https://linear.app/kotobalabs/issue/AWAI-3103).

It replaces, for V2, the V1 Hy gateway in `network-awai/cloud-kotoba-desktop`
(`gateway-hy/kotoba_gateway/orders.hy`), whose GitHub repository now returns 404. It keeps the V1
receipt format, so `../tools/verify_receipt.lpy` checks its receipts without sharing any code.

It runs on nbb, which ADR 0026 D3 allows on the Otehon execution path. Its order check reuses
`sanka.core/check-order`.

## Differences from V1

- **Registration is a command on the provider host**, run by the provider operator (for example
  over SSH). There is no HTTP route for it, so a buyer who reaches the listener cannot register
  orders.
- **The listener binds `127.0.0.1` only.** A buyer reaches it through an SSH tunnel (or, later, an
  authenticated tailnet route), never through an open port.
- **Init refuses a non-loopback upstream** and a node key that equals the provider (JUN-28).
- Ledger: one block per order, plus a signed head. The receipt's `ledger-head` is that block's CID.

## Operator steps (provider host)

```bash
R=~/github/workspaces/claude/awai-3103          # task folder; nothing outside it is touched
bin/llama-server -m $R/models/Qwen3-0.6B-Q8_0.gguf --host 127.0.0.1 --port 18787 -c 2048 -t 4 --no-webui
cd $R/sanka
nbb -cp src provider/desk.cljs init $R/root PROVIDER-DID $R/bin/llama-server ENGINE-REVISION \
    $R/models/Qwen3-0.6B-Q8_0.gguf MODEL-REVISION http://127.0.0.1:18787
nbb -cp src provider/desk.cljs serve $R/root 18788
nbb -cp src provider/desk.cljs register $R/root - KEY-SHA256 < order.json   # one per order
nbb -cp src provider/desk.cljs receipt $R/root ORDER-CID
```

Start llama-server with an absolute `-m` path: the desk compares the path the engine reports with
the model file whose digest it took.

## Routes

| Route | Opens with | Result |
| --- | --- | --- |
| `POST /v1/chat/completions` | `Authorization: Bearer <order key>` | One call, at most the order's `max-tokens`. `X-Awai-Order` and `X-Awai-Receipt` headers |
| `GET /v1/orders/<cid>/receipt` | That order's key | The stored signed receipt |
| Anything else | — | `not_found`. An order's key opens nothing else |

Refusal codes: `order_key`, `order_used`, `order_expired`, `serving_changed`,
`upstream_unavailable`, `upstream_model_mismatch`, `upstream_failed`, `order_failed`,
`receipt_pending`, `not_found`. Registration codes: `order_invalid` (fails `sanka.core`),
`order_work_kind`, `order_value_class`, `order_provider`, `order_node`, `order_model`,
`order_expired`, `order_key`, `order_exists`, `order_key_used`.

## What the provider keeps

`node.pem` (mode 0600), `config.json` (pins and file stamps), `keys/<sha256 of key>` → order CID,
`orders/<cid>/{order.json,claim,receipt.json,head.json[,failed.json]}`, `blocks/<cid>`. There is no
prompt, no output text and no key. A run on benjamin found neither the prompt nor the answer in
the store.

## Not shown

- A dishonest provider can still fake a receipt. The desk checks file digests and the path the
  engine reports; it does not attest what the engine ran.
- If delivering the reply fails after the key is spent, the receipt exists but the buyer has no
  output. This was observed once before a fix to the response encoder. Re-delivery is not
  implemented.
- Hermes, the AOSP buyer, the signer, the devnet ledger and settlement (V3–V5).
