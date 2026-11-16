# AWAI-531 cross-pack proof — 2026-11-13

Otehon source base: awai-os `945e51db6a01042dad4c6e67b089e26efd247a70`.
Local macOS arm64, Babashka 1.12.218 and zstd 1.5.7. Inputs are generated
synthetic data, not user files. The CI-integrated proof uses Otehon, not Native.

The runner creates 2,097,152 bytes, fixes 32 × 65,536-byte logical chunks,
and stores the same chunks in four 524,288-byte physical Packs. One store uses
existing zpack, another stores the four independently Forest-0.39-generated
archives byte-for-byte. Both use a harness-owned metadata pointer published
only after the four individual Pack transactions. This is an experiment, not
an atomic multi-pack file writer or a user-facing filesystem.

The canonical DAG-CBOR logical-file encoder is checked against the pinned
`binary-boundary` common corpus bytes/CID; then it constructs a 32-chunk
logical file. Forest and zpack stores independently recover in separate fresh
processes with an empty process-local cache. They produced:

- logical file CID: `bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny`;
- identical 32 logical block CIDs and complete file SHA-256
  `c2b720ebf73bceced9d7b9677c6b1540891fe50815ad43b1ec78a26e0f55ebbc`;
- four equal ranges, including two crossing Pack boundaries;
- 32 direct Forest CID-to-frame block lookups with revalidation;
- refusal when a published Forest Pack was missing or corrupted, without
  changing the observed published root; moved and altered test bytes restored.

The fresh-process proof does not kill the writer during a multi-pack transaction,
validate real physical power loss or OS cache loss, or implement scalable
catalog bootstrap, authorization, Datomic query, or a production adapter. An
individual Otehon Pack remains limited to 900 KiB data / 1 MiB CAR and a
bounded Forest profile. No benchmark or performance threshold is claimed.

Run at the repo root with a fresh output directory and pinned Otehon inputs:

```sh
CROSSPACK_FIXTURES="$PWD/nixos/otehon/storage/test/fixtures/crosspack" \
  bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test \
  nixos/otehon/storage/test/otehon/crosspack_proof.clj run .agent-output/crosspack-proof-new
```

## One-off authorized-query oracle — not CI or runtime

On the same day, the unmodified `.cljk` sources below were copied to disposable
`.cljc` paths for a single local Babashka measurement. No downloads were made.
The caller-provided policy, evaluator and receipt were **test doubles**; the
receipt was not durable and the evaluator was not Datalog. This only verifies
the existing gate's control flow and the tested physical reads, not a real
Kotobase engine connection or authorization enforcement in production.

| Source | Revision | SHA-256 |
| --- | --- | --- |
| kotobase `src/kotobase/authorized_query.cljk` | `e5d9cd2ec1fcf59bc48162532acfab75b1bf6050` | `9902b070a2ef12603a6f60e6938fe54067da9bf970aa20c366a11788c9758de6` |
| kotoba `lib/kotoba.coll/src/kotoba/lang/coll.cljk` | `05fc7c5c62ca0e44fc9d7539fe9834ec9a6b0b14` | `6880ecaf27a40f6385a5861d6b04ea31456c69d745964a97f513acfded86041e` |
| kotoba `lib/kotoba.text/src/kotoba/lang/text.cljk` | same | `4f62e846a620ec49f5c84a69f6788b97cff4e53d4248beb02b4b41434d58a55b` |

`query-gate-oracle.clj` used the two stores created by the Otehon proof. The
allowed test request with the same basis returned the same file and chunk CID
through both physical paths. Denied, stale-basis and projection-denied cases
made zero **selected block reads** after recovery; recovery had already read
all packs. The real gate accepts an injected policy and evaluator, and the
stubbed receipt's affirmative value must not be interpreted as durable proof.
The next necessary vertical slice is the actual Kotobase query engine and a real
authorizer/receipt on the shared logical basis, with failure and revocation.

Exact oracle invocation (the copied `.cljc` paths above contained the bytes
with the listed hashes; `.agent-output/crosspack-proof-2/{zpack,forest}` were
the freshly completed proof stores):

```sh
bb --classpath .agent-output/crosspack/oracle:nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src \
  .agent-output/crosspack/query-gate-oracle.clj
```

Inputs were the fixed synthetic metadata request and policy in the recorded
script. Both returned the same file CID above and block CID
`bafkreidxq3azg4pwxcuurzkrmjha3uuzhstmefbzx6dw6z5bjaqya64mra`; all three
negative decisions refused before the selected-read callback. Output reported
`:equal true :pass true`. No oracle implementation was added to CI, a build,
packaging, or a product execution path.
