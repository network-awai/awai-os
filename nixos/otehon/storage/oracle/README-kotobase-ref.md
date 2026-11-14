# Otehon Kotobase ref port — local hosted boundary

`otehon.kotobase-ref/open-ref-store` implements the existing Kotobase
`IRefStore` and capability protocols; it is not an `IBlockStore`. It stores
canonical supported CID strings under namespaced Otehon metadata keys.
Compare-and-set of the expected CID and WAL/root update occur under the same
local OS writer lock. A mismatch returns the current CID and store generation
without changing the WAL or root. A busy lock may throw `:writer-busy`;
callers may retry after re-reading. An I/O exception during publication can be
ambiguous and must be resolved by readback. A degraded root refuses both ref
reads and writes rather than returning an older recovered ref silently.

The declared capability is conservatively `:single-writer-ref`: this does
not grant distributed fencing or establish network-filesystem lock behavior.
The protocol compares CIDs, not generation tokens, so an A→B→A sequence is
not distinguished by CAS. The reported version is the whole-store generation
and can advance on unrelated writes. A ref may name an absent block; callers
must compose this ref port with an independently qualified immutable block
provider and publish blocks before their ref. It does not authenticate a
commit or prove signed basis, content retention, multi-node safety or
production qualification.

The vendored protocol module is byte-identical to
`kotoba-lang/kotobase-storage` revision
`ce8640e24ee2b1b8a15129b7a71f020a22f979a8`,
`src/kotobase/storage/core.cljk`, SHA-256
`4ce94d0eb58ade7bc6afca48c946bf3eb79f7918a844b52ec911c1c0c37adef5`.
Only its extension is changed to `.cljc` for this hosted Otehon runtime; Nix
checks the pin. No protocol is redefined in the adapter.

On 2026-11-14 JST, local Babashka 1.12.218 ran the ref-specific tests:
4 tests / 23 assertions including stale and invalid values, degraded roots,
concurrent updates, reopening and composition with a test-only in-memory
block provider. A separate two-process race had one successful CAS and one
refusal; a third process read back the winning CID. The broader storage,
Pack, IPLD and ref suite before the final degraded-root addition passed 37
tests / 249 assertions. Nix hosted CI includes the tests and process proof;
its exact-head result is tracked separately. The block provider in the
composition test is an in-memory fixture, not a durable Forest adapter.
