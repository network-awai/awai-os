# Group, receipt ref and nonce ref process-kill proof — 2026-11-15

`atomic_nonce_crash_proof.clj` extends the existing file-group/ref process-kill test with a staged synthetic marker and conditional nonce ref in the same `put-many` transaction. It uses two prebuilt small Forest files, not a canonical Kotobase nonce marker or actual governed authorization. The verifier checks both candidate blocks; the host remains responsible for marker semantics.

On macOS ARM with Babashka 1.12.218, seven independent child processes were forcibly killed at the second Forest file half-write and rename, WAL half-write and rename, and root half-write, rename and directory-sync boundaries. For the first five, a fresh verifier saw no group, receipt ref or nonce ref; retry from that empty state published all three. For root rename and directory-sync, it saw all three and both complete Packs; a new receipt ref using the same nonce was refused as `:nonce-replayed`, left the root unchanged and did not create that ref. The prior state was empty, so this is not a test of fallback from a corrupt published root to an older nonempty root.

Local command from the repository root:

```
IPLD_SPLIT_FIXTURES="$PWD/nixos/otehon/storage/test/fixtures/prolly-forest/split" bb --classpath 'nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/vendor/kotobase-storage/src' nixos/otehon/storage/test/otehon/atomic_nonce_crash_proof.clj run "$PWD/.agent-output/atomic-nonce-crash-20261115"
```

Test source SHA-256 `44d7682ef5ffbbfda878c21ba6c7935b300ac3088903ed5f97ce1cfaa430685a`; fixture 0 `2c509ae8839e54978f316118638615c2094f2459fc0b9f296280793843fb0e42`, fixture 1 `8da589a71005286b0cee6f78fd68ed467226330f8610a64cb6c9de11145580c1`. Task-owned resulting stores are retained in `.agent-output`. Nix was unavailable locally; `check.nix` now invokes the same proof and the exact-head CI result must be checked separately.

These are real process kills with the host OS and its caches still running. They do not establish sudden OS cache loss, physical power failure, distributed fencing, production identity or Native writing. The staged marker is intentionally synthetic; separate hosted corpus tests cover the canonical marker bytes.
