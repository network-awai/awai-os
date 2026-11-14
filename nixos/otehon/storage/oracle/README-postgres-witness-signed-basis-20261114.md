# Hosted signed Prolly basis, 2026-11-14

This local reference composes the existing `kotobase.engine.identity` logical-commit, physical-publication and domain-separated signature-payload contracts with a real hosted Prolly transaction/checkpoint, witnessed Forest storage and a local PostgreSQL witness. It uses an injected SHA-256 CIDv1/raw digest of each contract's canonical string; this is this fixture's identity profile, not proof of an owner-approved cross-runtime profile. A fixture Ed25519 key signs the existing logical signature payload; physical publication is not directly signed. The validator verifies the signed logical root, walks the bounded IPLD physical closure, restores Prolly, and recomputes transaction and checkpoint roots to bind that physical state to the signed logical commit. Schema/model/policy root strings are fixture placeholders, not independently verified policies. The basis envelope uses the existing canonical value codec but is a local composition, not a newly ratified interchange format.

Run the same pinned local hosted inputs as the receipt oracle:

```
sh nixos/otehon/storage/oracle/postgres_witness_prolly_check.sh NEW_ABSOLUTE_BASE NEW_SHORT_SOCKET ABSOLUTE_FOREST_TOOL basis
```

Fresh `.agent-output/pg27`, PostgreSQL 14.19, Clojure CLI 1.12.5.1654, OpenJDK 21.0.1 on macOS arm64: a transaction storing `alpha` was signed, published through the explicit pre-CAS semantic check and recovered after clean PostgreSQL restart and a fresh JVM; Datalog returned `alpha`. Another valid independently published Prolly root returned `beta`, but substituting it in the original publication failed verification. Zeroed signature, changed commit epoch, wrong verification key and missing physical root were also refused. The signed logical root was `bafkreigdzmid63hbqlrzaorrug2jezpks7qokv25pa7e2t52w5x6pxwga4`; the physical root was `bafyreies3n6ajxpxriak773jobtbzd7johnqxet6zozbjbwbrpscm7qboi`.

This is not yet connected to the separate governed policy/receipt fixture. Generic root verification still cannot infer semantic string CIDs; the host basis validator explicitly follows the physical root. The public key, identity encryption, schema/model/policy and witness are fixtures, and there is no key custody, independent anti-rollback authority, product-wide admission, Native qualification, multi-Pack atomicity, OS-cache loss or power-failure claim.
