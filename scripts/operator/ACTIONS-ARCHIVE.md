# AWAI-2987: preserve before deleting GitHub Actions artifacts

`actions-to-awaifs.mjs` is an explicit operator migration, independent of GitHub
Actions execution. GitHub is used once as the authenticated **source** and later
for exact-ID deletion. AwaiFS/B2 holds the archived bytes and recovery catalogs.
It never downloads or executes an installer from an unverified archive.

The installed macOS AwaiFS volume is the legacy owner-local raw-Pack profile.
This tool reuses that installed implementation in a **separate dedicated volume**;
it does not replace canonical logical-file/CID, CARv2, WNFS or Native contracts.
The new JSON receipt is operator provenance, not a new filesystem or content ID.
The primary live volume, mounts, unrelated caches and credentials are unchanged.

Each GitHub ZIP is hashed against the owning API's digest and size. Ingest uses
at most8MiB transport parts. At a bounded batch boundary the dedicated server
seals its append Pack, checkpoints, and stops. The explicit rclone B2 adapter
uploads immutable Packs and a SHA256-named **actual AwaiFS catalog** under a new
prefix of the existing AwaiFS backend. Neither a success from local PUT nor an
object listing is a durability proof.

Every newly stored Pack and the catalog are downloaded to an independent empty
recovery directory. Complete Pack SHA256, every logical extent's SHA256, coverage,
and the whole transport part SHA256 must match. The artifact's provenance receipt
is itself stored and independently read back through the same path. Only then may
`applyDelete:true` delete the exact, freshly rechecked GitHub artifact ID. A bounded retry of the final GET must return404 (the API can briefly retain
a just-deleted record). A missing post-delete ledger entry is independently
recovered and the complete original ZIP is SHA256-checked before recording absence. Saved `verified` booleans alone never permit deletion after a
restart: original input binding and remote readback must be repeated.

Only this stopped, exclusively owned volume's independently restored local Pack
cache is removed. No remote sync/purge, live-volume cache eviction, branch or
source deletion is performed. Remote recovery catalogs contain exact logical
part names, raw-Pack extents and hashes. `receipt.json` preserves the original
artifact/run identity and ordered part checksums needed to reconstruct its ZIP.

Run only from an operator worktree, with a private explicit JSON configuration:

```json
{
  "work": "/absolute/task/worktree/.agent-output/archive-run",
  "volume": "/Users/OWNER/.awaivol/archives/awai-os-actions-20261116",
  "app": "/Users/OWNER/.awaivol/app",
  "credentialsPlist": "/Users/OWNER/Library/LaunchAgents/com.kotoba.awaivol.daemon.plist",
  "maxArtifacts": 1,
  "batchBytes": 134217728,
  "applyDelete": false
}
```

```sh
node --test tests/operator/actions-to-awaifs.test.mjs
node scripts/operator/actions-to-awaifs.mjs /absolute/private-config.json
```

`applyDelete:false` still copies and validates; it only withholds deletion. Inspect
`events.jsonl`, catalog hashes, source digest and original retention before
enabling deletion. Credentials are read into memory and passed only as child
environment variables. They never appear in argv, receipts or logs. The task's
remote prefix is fixed beneath the existing configured prefix; a broad PAT is
never copied to storage or CI. GitHub bearer auth goes to api.github.com only;
the bounded HTTPS artifact CDN redirect receives no bearer token.

A crash leaves visible progress and can leave a writer hold. Do not steal a hold
or remove unknown processes. Verify that this run's volume server is stopped
before clearing only its own hold. Keep unique recovery evidence. A missing
member, corrupted byte, changed source, unsafe redirect or uncertain deletion
stops the operation; it is never converted to a successful migration.

Initial qualification: six local negative/streaming tests and one real small
artifact copied to the existing AwaiFS B2 backend and recovered from an empty
cache, with original retained. This does not yet qualify all441 artifacts,
large images, process-crash resume, hardware power loss, independent-node repair
or the complete non-GitHub OS release pipeline. Record later evidence separately.

Later qualification (2026-11-16):370 proof/log artifacts (114860993bytes) passed
source digest checks, independent offsite readback and verified GitHub deletion.
An already deleted original ZIP was reconstructed through `recover-actions.mjs`
using AwaiFS alone, with its caller-pinned original SHA256. Remaining71 larger
images are a separate operational milestone. Eight archive/recovery tests pass.

`publish-recovery-root.mjs CONFIG` publishes only a checkpoint already present in
the successful cold-readback ledger, rechecks the actual remote catalog hash, and
reads back its locator. The migration engine also publishes this locator before
newly qualified deletions. This locator is operator metadata, **not** a signed
production OS release. A consumer must independently pin the expected original
ZIP digest; the locator never authorizes a new installer or code execution.

`recover-actions.mjs CONFIG` has no GitHub access. Its private config names an
absolute new `work`, new `output`, the existing `credentialsPlist`, positive
`artifactId` and caller-pinned64-character `expectedSha256`. It resolves the
AwaiFS catalog, validates the provenance receipt, reconstructs each ordered
8MiB member from raw-Pack extents and verifies the complete original ZIP before
no-overwrite publication. Partial failures stay unpublished for diagnosis.

Ingest remains bounded8MiB in memory. An operator can select up to1GiB staging
batches; independent cold staging is capped2GiB and reserves4GiB disk space.
Oversized fragmented recovery plans hold rather than exceeding the bound; resume
with a smaller batch after verifying that this run's writer has stopped. The
installed AwaiFS implementation and helper source fingerprint is rechecked at
every restart; a live runtime upgrade must not silently change archive semantics.
