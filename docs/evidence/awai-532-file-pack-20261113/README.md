# AWAI-532: file-backed Forest Pack publication, 2026-11-13

The Otehon file input path checks each bounded Forest Pack without retaining
all Pack byte arrays. It binds the canonical logical manifest to verified leaf
indexes, re-reads each source under the writer lock and checks its length and
SHA-256 before saving the immutable object, then publishes one WAL/root. The
existing maximum of 64 Packs and 900 KiB payload per Pack remains unchanged.
Existing catalog recovery may retain index metadata for committed Packs; this
experiment did not measure peak RSS and is not a GiB-scale qualification.

Local macOS, Babashka 1.12.218, pinned Otehon vendor sources; output directory
is new and isolated from live stores:

```sh
AWAI_FILE_INPUT=1 bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test nixos/otehon/storage/test/otehon/atomic_logical_proof.clj run .agent-output/file-pack-atomic-final-20261113
```

The eight existing writer-kill boundaries passed, with old or new root as
appropriate, retry and a cross-Pack range check. An additional input-mutation
case changed the second copied source after the first immutable object was
synced: publication rejected it as `:forest-changed` and the root was
unchanged. Outputs concluded `{:changed-input :rejected :root-unchanged true
:pass true}` and `{:cases 8 :cross-pack-range true :negative-cases true :pass
true}`. The local output log and stores are retained under `.agent-output`.
Process termination and copied records do not demonstrate host OS cache loss,
power failure, independent nodes, real policy, Native execution or deployed
AwaiVol behavior. Source files must remain accessible throughout the two
passes; incomplete immutable objects may remain as unreferenced orphans.

Existing storage and Pack unit suites also passed locally: 24 tests, 145
assertions, zero failures/errors. `check.nix` now runs the file-input crash
proof in addition to the existing byte-array proof. Nix was not installed on
this macOS host, so the Nix derivation and its CI result were not locally
verified.
