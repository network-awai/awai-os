# Atomic Forest group and Datalog oracle — 2026-11-13

Base awai-os `947030edfbb1da103d3062c526a9eea921bf375c`; macOS arm64;
Babashka 1.12.218, zstd 1.5.7; synthetic 4 × 512 KiB Forest fixtures from
PR #111. No user files or production state were modified.

## Atomic publication primitive: Otehon test harness

`test/otehon/atomic_pack_proof.clj` validates four Forest archives, then calls
`store/transact!` once. Its before-publish hook writes the four immutable
objects while holding the same writer lock; one WAL/root update then publishes
one test-only group value containing their physical digests. This uses real
Otehon primitives but does **not** implement a production multi-pack file API,
canonical logical manifest binding or a general transactional filesystem.

Eight actual force-kill (exit 137) positions were exercised: first object half
written, third object renamed, fourth object directory-synced, WAL half written
and renamed, root half written, renamed and directory-synced. The old root was
observed at all positions before root rename; the complete new group was
observed after root rename. In a separate process, copied durable records were
recovered and all four expected object digests and Forest archives checked;
retry after death succeeded. This is process-stop evidence only: copying files
is not an OS-cache reset, filesystem crash or actual power loss.

Reproduce from repo root with a new output path:

```sh
CROSSPACK_FIXTURES="$PWD/nixos/otehon/storage/test/fixtures/crosspack" \
  bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test \
  nixos/otehon/storage/test/otehon/atomic_pack_proof.clj run .agent-output/atomic-proof-new
```

## Real Datalog evaluator: one-off local oracle, not CI/runtime

Node v26.0.0 / nbb 1.4.208 ran unmodified Kotoba monorepo `.cljk` sources at
revision `05fc7c5c62ca0e44fc9d7539fe9834ec9a6b0b14`, copied as `.cljc` for
this one-off local measurement. No download occurred. `datalog.core/q` really
executed a four-clause join against **97 in-memory datoms** made from the
synthetic cross-Pack proof manifest. Its visibility predicate hid the CID
attribute in the negative control, yielding no rows.

The selected root was
`bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny` and block CID
`bafkreidxq3azg4pwxcuurzkrmjha3uuzhstmefbzx6dw6z5bjaqya64mra`. A separate
Babashka 1.12.218 process consumed the query result and recovered the same
65,536 bytes from the zpack and Forest stores, verifying the CID.

The in-memory Datalog index is rebuilt from test data; the process handoff and
physical pack selection are harness code. This does not verify a persisted
Kotobase Prolly source, signed commit basis, real policy, revocation, durable
query receipt, or a live query service. It does not qualify Native.

Inputs/outputs are `input.json` and `result.json`; scripts are `query.cljs`
and `verify.clj` in this directory. Exact local commands used disposable source
copies at `.agent-output/datalog-oracle/` and the stores from the PR #111
cross-pack proof at `.agent-output/crosspack-proof-2/`:

```sh
nbb --classpath .agent-output/datalog-oracle .agent-output/datalog-oracle/query.cljs
bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src .agent-output/datalog-oracle/verify.clj
```

Source-copy SHA-256 (`.cljk` bytes were unchanged, only extension changed):

```text
datalog/core.cljc       8edee6288688d139a63c8b37ed3c79c7b77022a223eba540c43013e9ff42aefa
datalog/index.cljc      2e3de7d5a2a1aeab588c7051dd4facdae94e399784637897f174ec3f292e0407
datalog/query.cljc      31a3a5697b6931a32372c1619c996a0ab8ec91b7a0ff8517d5f97b7f477d83ad
datalog/singleton.cljc  ad398e11e33ec8a316c827cec528bec9695c3a9a0619c2f52ab6f4e71636697f
datom/source.cljc       88c2f88200b719cd8c6f575e307ad96b897e4ae0f37d427167febb8b8f76d2be
kotoba/lang/coll.cljc   6880ecaf27a40f6385a5861d6b04ea31456c69d745964a97f513acfded86041e
kotoba/lang/text.cljc   4f62e846a620ec49f5c84a69f6788b97cff4e53d4248beb02b4b41434d58a55b
input.json              680e19872e541b00c00bdaaff69992a18fcafcc519caccbe3482882107a47017
result.json             1e7712e4e9b6d5feea3b6bc0ba180607aeb8c01408b88838a15c62579eb241a1
```

The oracle scripts are evidence only; neither nbb nor these reference sources
were added to the Native gate, build, packaging or execution path.

## Native logical-file primitive on actual macOS arm64

On the same date, the existing `lib/kotoba.awaiFs/test/values.kotoba` from
Kotoba revision `05fc7c5c62ca0e44fc9d7539fe9834ec9a6b0b14` was compiled and
executed on macOS arm64. Its test exercises valid leaf verification, wrong and
missing bytes, file/profile version refusal, excess chunk count, malformed
bytes and size refusal. The final Native process returned exit 0.

The ordinary Amu checkout binaries did not match the pinned input digests.
Exact bytes were recovered into task scratch from Amu Git revision
`ce982703375bedc0039b61b1a821407d228ea98a`, hash-checked and verified with
`codesign --verify --strict`:

```text
amu-full-root.macho        369fc624cf5236b3f4a9dba2021bb057223bd1179736c882123506dee4fda082
kotoba-packager-root.macho 7691467cf64ec5116de3534579a8383b4b0b17198e12a21076145afbc4bce31e
values.kotoba              a1f2edd7c6b00591e36c241bf5e81d297420ccdca32a16be3b63925cb49cb934
native-source.ksl          b9ae94a7b38a4c64ba3994de2b658b6b867e26b1dd0e72083110556d67c8e737
program.kseed              6328e8ab13208651ec8909b5f8cfdf34538f4e20a3b0f05d69f4afff1d7fc6df
program.raw                403e15d32613c82537174c33851ba4b6c36eed1476ed183986bce9e62a1c41e6
program.macho              f5cf96e6c3d513f01584135a3d07b202ab9391744aa04aa012a8cf7eec12e598
```

With FD 3 open to the staged source directory and `PATH=/nonexistent LANG=C`,
commands were `amu-full-root.macho compile /src/corpus.kotoba --target
 aarch64-macos --output program.kseed --source-path /src --source-lock
 source.ksl --source-lock-sha256 <the digest above>`, `amu-full-root.macho
extract-native program.kseed --symbol main --output program.raw`, and
`kotoba-packager-root.macho program-unsigned.macho program.raw
fs2-cli-stdio-general 71480`. The generated artifact was ad-hoc signed and
executed; all commands exited 0. `native-source.ksl` records every source
input; the extracted `main` offset was 71480 and length 73589.

This is a small primitive and negative-control execution. It does not execute
the 2 MiB proof's logical manifest, the Forest adapter, native I/O, multi-Pack
recovery, or physical power failure, and is not production qualification.
