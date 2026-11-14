# Conditional multi-Pack publication on one host

The optional expected-generation argument on `put-ipld-blocks!` and
`publish-group!` compares the caller's observed store root generation while
holding the same OS writer lock used for WAL/root publication. The comparison
happens before immutable archives are written into the store. A mismatch
returns `:stale-generation` and preserves the committed root; an invalid or
nil explicit generation returns `:invalid-generation`. The original arities
remain unconditional. Callers obtain the generation from the recovered store
root. This is a store-wide generation, so an unrelated store write also makes
an old token stale. It intentionally does not imply distributed consensus,
node fencing, signed basis, retry safety across arbitrary external effects, or
production qualification. Compression/staging occurs before the lock and is
retained even when the later comparison fails; no source is deleted.

On 2026-11-14 JST the macOS arm64 Babashka 1.12.218 storage, Pack, generic
IPLD and writer tests passed 35 tests / 234 assertions. A two-writer race
using the same generation had one successful publication and one stale
rejection, with a single generation advance. The real digest-pinned Forest
compressor also built and published a two-archive group conditionally,
refused nil and stale tokens without changing the root, and published again
with the current generation. This test runs independently of Native and uses
no JVM fallback. The Linux hosted Otehon CI job contains the same real-tool
proof; exact-head CI is reported separately. Filesystem lock correctness is
limited to the tested local filesystem semantics.
