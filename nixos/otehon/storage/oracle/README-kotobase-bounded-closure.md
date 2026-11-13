# Bounded Prolly closure oracle, 2026-11-14

This is a hosted, opt-in experiment on the private copy of the previous batched transaction's store. It runs `kotobase_prolly_bounded_closure.clj` through Otehon's actual block/ref port and its caller-supplied guard. It uses Kotoba PR #1339 commit `fa5b8ba7c34c4a730976ef602de3ed5cb6247019` for `cbor.core` and `ipld.core`; the remaining adapted classpath is the existing pinned `prolly_forest_writer_inputs.json`. These two `.cljk` files were copied as `.cljc`, quoting their `:kotoba/export` namespace metadata for the host reader; the copied content was checked against that exact git revision after this sole adaptation.

| Input | Original SHA-256 | Adapted SHA-256 |
| --- | --- | --- |
| `lib/org.ietf.cbor/src/cbor/core.cljk` | `deb6043a5e98f5d9124de2becb6efa9bf613384b92abf079459d005c7add00fe` | `b597c060b56766a56d94f367ed1bc7c59ec8d086a93ac85037867bb701ec33ab` |
| `lib/kotoba.ioIpld/src/ipld/core.cljk` | `8fee2974cfdd1bbef787797796580e26ce0c7daf2563df50cfcb874fe844a434` | `2ebb52cd066e71bc43446dfe62ceaab6569e7b59a3c93b10bd37f266bc9450e8` |

Clojure CLI 1.12.5.1654 and Babashka 1.12.218 each traversed 12 blocks, 3,998 bytes, 15 edges, and the same root `bafyreiczbylfrpsshqklrxp6jjc55k2jrkrvpakcdvm4eqjjrpoecuwgua`. Missing block, wrong CID, graph count/byte/depth/edge limits, and a separately synthesized 10,000-level CBOR block were refused. A false guard, missing child, and synthesized deep-block guard left the store root unchanged; the valid closure allowed CAS. The deep block is injected by the test callback, not a malicious descendant persisted inside the fixture.

Reproduce using the earlier oracle's prepared classpath and a fresh private copy of its store as described in `README-kotobase-prolly-closure.md`. Put the two adapted files above in a separate classpath directory before the earlier classpath and set `KOTOBASE_TX_OUTPUT` to the copy. Then run:

```sh
clojure -Sdeps '{:paths ["<bounded-classpath>" "nixos/otehon/storage/src" "nixos/otehon/storage/vendor/apex/src" "nixos/otehon/storage/vendor/apex-car/src" "<previous-oracle-classpath>"]}' -M nixos/otehon/storage/oracle/kotobase_prolly_bounded_closure.clj
bb --classpath '<bounded-classpath>:nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:<previous-oracle-classpath>' nixos/otehon/storage/oracle/kotobase_prolly_bounded_closure.clj
```

The experiment applies graph and per-block bounds after the provider returns bytes; it does not bound provider allocations. Its callback is not installed as the product default. Source pin is to an unmerged draft, not a released dependency. It does not establish signed basis, actual policy/receipt, atomic multi-Pack product publication, Native I/O, OS cache loss or production acceptance.
