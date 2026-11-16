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
