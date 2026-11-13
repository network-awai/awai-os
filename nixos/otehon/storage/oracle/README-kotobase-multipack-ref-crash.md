# Hosted multi-archive transaction and ref process-kill proof

On 2026-11-14, `kotobase_multipack_ref_crash.clj` used the actual hosted `open-transaction` overlay, Forest writer and ref CAS, with the pinned real Forest tool SHA-256 `e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f`. Each independent case copied the prior Prolly transaction store and staged the existing 20-block fixture. The fixture produces two Forest archives in one newly committed group. The supplied test guard checks all 20 known blocks byte-for-byte; it is not a production closure or policy verifier.

A parent Babashka process killed the writer child at each instrumented store boundary, then launched a separate process to reopen the same store. Results:

| Kill boundary | Ref after reopening | New group |
| --- | --- | --- |
| Halfway through writing second Forest payload | Old | Not visible |
| Halfway through writing ref root record, after group commit | Old | One complete group, two archives; all 20 blocks matched |
| Immediately after ref root rename | New | One complete group, two archives; all 20 blocks matched |

The first two cases used ref `bafyreiczbylfrpsshqklrxp6jjc55k2jrkrvpakcdvm4eqjjrpoecuwgua`; the last used `bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri`. Results are for process termination on the same host, not host reboot or cache loss. Killing just after rename before directory sync does not establish power-loss durability. Pre-ref failure can leave an unreferenced group; GC is not tested. The overlay is bounded to 32 MiB and this fixture contains two synthetic 600 KiB raw blocks, not a GiB file. Product-default verifier, signed basis and policy/receipt are not covered.

To reproduce, set `FOREST_TOOL` to the pinned executable and `KOTOBASE_SEED_STORE` to the previous private Prolly transaction store. Set an unused destination inside a task worktree. Use the previously documented adapted Kotobase classpath and run:

```sh
bb --classpath '<bounded-classpath>:nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:<previous-oracle-classpath>' nixos/otehon/storage/oracle/kotobase_multipack_ref_crash.clj run <new-private-output>
```

The tool stages its own copy for each case; preserve the output and staging for inspection. Dependencies and host oracle adaptation are recorded in `README-kotobase-bounded-closure.md` and `prolly_forest_writer_inputs.json`. No Native or production qualification is implied.
