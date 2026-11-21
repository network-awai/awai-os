# Awai mailbox

`mailbox.awai.network` carries sealed compute orders to an Android provider, and sealed results back to the
buyer ([ADR 0051](https://github.com/network-awai/network-awai-apex/blob/main/docs/adr/0051-compute-orders-to-android-providers-by-mailbox.md)
D2, [AWAI-3766](https://linear.app/kotobalabs/issue/AWAI-3766)). The phone and the buyer only connect out to it.
It is a remote protocol service, apart from any app origin.

**Not deployed.** The Worker and its custom domain do not exist yet. `deploy.sh` refuses to run until the owner
approves the deploy (ADR 0051, open decision 1) and `AWAI_MAILBOX_DEPLOY_APPROVED=yes` is set.

| Route | What it does |
| --- | --- |
| `POST /<topic>` | Stores one base64url body for the topic and passes it to open streams |
| `GET /<topic>/json` | An NDJSON stream: `open`, the live messages, then new ones and a keepalive every 30 s. It closes after 15 minutes; the phone reconnects |

| Rule | Value |
| --- | --- |
| Topic | 32 lowercase hex digits (128 random bits, written in the offer or in the order's reply) |
| Body | base64url only, 64 characters to 64 KiB. A JSON prompt or any other plaintext is refused before it is stored |
| Lifetime | The sender's `x-expires` (unix seconds, in the future), at most one hour. Without it, one hour |
| Messages per topic | 16 live messages |
| Kept | The ciphertext and its expiry. No log, account, address or header |
| CORS | None: no browser page is a client |

The same two ntfy routes as `relay.awai.network`, with limits for orders instead of link answers. The mailbox
cannot tell an order from a result and opens neither; `sanka.device` checks what the host opened.

```bash
node --test test/mailbox.test.mjs
```

The tests run the Worker in Node with an in-memory Durable Object and mocked timers. `MAILBOX_WORKER=<file>`
runs them against another worker file.

Evidence (2026-11-22, Apple M1 Max, macOS, Node 26.0.0, wrangler 4.103.0):

| Check | Result |
| --- | --- |
| `node --test test/mailbox.test.mjs` | 11 of 11 |
| Worker changed to take any body | Fails "only base64url ciphertext is stored" |
| … to keep the sender's address | Fails "the store holds the ciphertext and its expiry, and nothing else" |
| … to keep a message past one hour | Fails "the sender's expiry is kept, clamped to one hour" |
| … to deliver expired messages | Fails "an expired message is not delivered" |
| … to send a CORS header | Fails "no CORS header is sent" |
| … to hold 17 messages | Fails "a topic holds at most 16 live messages" |
| `wrangler deploy --dry-run` | Builds, 4.09 KiB, binding `TOPIC` |
| `wrangler dev --local` (workerd) | Ciphertext 200, JSON prompt 400, bad topic 404, past expiry 400, OPTIONS 405, the stream returns the message, no CORS header |

Not done here: the deploy and the DNS name, the HPKE seal in the hosts, and any device. The Murakumo provider
service (C1b-3) and the buyer side (C1b-4) use this mailbox.
