# Awai Peer runtime (Otehon)

Shared libp2p transport carrier for Tauri v3 dapps. Extracted from the Aozora
explicit-peer candidate; see PROVENANCE.md. This is not Kotoba/Amu Native.

The transport verifies literal IPv4/PeerID scope, authenticated QUIC or TCP/Noise,
standard ping/Bitswap, fixed protocol/action, deadlines and bounded public blocks.
The opaque snapshot adapter admits SHA2-256 and BLAKE3-256 CIDs, matching the
existing WNFS CLJC profile. It does not replace WNFS with a Rust implementation,
interpret a root capability, grant writer authority, find the latest tree or
claim post-quantum admission. The owning CLJC API creates/reads private trees.

`DiskStore::import_car` requires an explicitly trusted root and preserves all
CARv1 ciphertext blocks by CID, verifies bytes before no-clobber storage, and
writes a content-addressed snapshot block list. Corruption, duplicate blocks,
wrong/missing roots, oversized frames and unknown codecs/hashes fail. Output
CAR export refuses existing files and verifies the complete block set first.
Incomplete imports may leave verified immutable blocks, never an adopted root.

Limits: 256 KiB/block, 10000 CAR blocks, 256 MiB/CAR, at most four manifest
roots, and 256 KiB/manifest. The block-list limit may reject a smaller CAR with
many blocks. No implicit root update or garbage collection is performed.

```sh
cargo test --manifest-path packages/awai-peer/Cargo.toml
```

Development status: extracted transport and opaque local snapshot adapter are
checked. Continuous receive, NAT traversal, pin/query, app integration and actual
separate-device acceptance are tracked in AWAI-3001; do not infer them from these
local tests. Host capabilities never substitute for canonical fresh consent.

## Explicit Yataverse pin/query provider

`/awai/yataverse/1.0.0` is an Awai-specific libp2p CBOR protocol, not an HTTP
Pinning Service API or an already-deployed Yataverse service. Request and response
frames are capped at 260 KiB; fixed actions are put/get/pin/query. A provider grant
binds authenticated sender PeerID, exact snapshot CID, total bytes and expiry
(maximum six hours). Unknown peers, snapshots, extra fields, unsupported blocks,
wrong bytes and quota/expiry violations are refused. No root capability/key is
sent. Pin/query re-verify every listed stored block and sign a receipt with the
provider transport key. Receipt verification binds signature, PeerID, snapshot
and expiry. This is observed custody and a bounded retention promise; it is not
independent multi-node durability or a post-quantum admission signature.

CLI administration is explicit operator work, not a browser consent substitute:

```sh
cargo build --manifest-path packages/awai-peer/Cargo.toml
peer=packages/awai-peer/target/debug/awai-peer
"$peer" identity .agent-output/sender
"$peer" snapshot-import .agent-output/source snapshot.car '<trusted-WNFS-root>'
# grants.json: [{"peer_id":"<sender-PeerID>","snapshot":"<snapshot-CID>",
#               "max_bytes":1048576,"expires_at":<unix-time-within-six-hours>}]
"$peer" provider .agent-output/provider .agent-output/grants.json /ip4/127.0.0.1/tcp/0
"$peer" sync-push .agent-output/sender .agent-output/source '<provider-address>' '<snapshot-CID>'
"$peer" pin-query .agent-output/sender .agent-output/source '<provider-address>' '<snapshot-CID>'
"$peer" sync-pull .agent-output/sender .agent-output/restored '<provider-address>' '<snapshot-CID>' .agent-output/new.car
```

Provider grants must originate from the selected provider's local approval;
a sender's approval never grants provider storage. Storage remains immutable
across provider restarts, with no automatic GC/root adoption. Grants must be
supplied explicitly on restart. The CLI is separate from app operations, which
must enter through the canonical broker. Existing HTTPS Yataverse tenant/grant
APIs are not silently invoked or bypassed by this protocol.
