# Itonami bot organization — Otehon

AWAI-2795 registers immutable registry profiles into repository Circles with one
role per profile. Exact-name existing Linear Projects and their Initiatives are
referenced rather than recreated. An Issue/run/revision/acceptance-unit binding
is required separately; missing and ambiguous mappings remain unresolved.

Itonami bots run on Itonami/Awai distributed nodes (owner decision 2026-11-12).
The catalog names `itonami.distributed-execution.v1`: per-occurrence authority,
Awai FS state, and an explicitly selected Muse/Meta inference rail. VKE and
central-only/local-SQLite dispatch are incompatible configurations. An owner
string or a matching descriptor is not an authenticated admission proof.
Existing VKE services are outside this task; no migration to/from VKE is required.

The existing integration seam is Itonami's `gateway_job_node.kotoba` composing
Murakumo's job node, not the local cron execution ledger. That adapter itself
still requires trusted schedule enrollment, a durable cursor, unknown-outcome
reconciliation and cross-host fencing; see `kotoba-lang/itonami-agent` at
`177c2bb1ae43b21c40ad18a4201e4027a9401308`,
`docs/native-gateway-job-node.md`. This is an integration reference, not a
qualified/pinned runtime closure for this Otehon fleet. Do not copy the Native
implementation into Otehon or relabel the local ledger as distributed authority.

Generate from owner-selected snapshots (JSON exports are not checked in):

```sh
bb catalog.clj REGISTRY_DIRECTORY PROJECTS.json ISSUES.json REGISTRY_COMMIT NEW_CATALOG.json
node verify-cron.mjs NEW_CATALOG.json NEW_VERIFICATION_DIRECTORY
node persist.mjs NEW_CATALOG.json NEW_VERIFICATION_DIRECTORY/schedules.json NEW_DIRECTORY_ON_AWAI_FS
bb -cp src test/bot_fleet/core_test.clj
node --test receipt.test.mjs
node receipt.mjs BINDING.json MUSE_EVENTS.jsonl NEW_RECEIPT.json
nix-build check.nix --no-out-link
```

Run from this directory. `verify-cron.mjs` uses existing `gh` authorization to
read each profile's pinned `cron/jobs.json`, checks its manifest byte length and
SHA-256, and retains only schedule/authority inventory. It never executes code,
replays historical prompts or transfers connector secrets. Source publication
does not enable cron. Missing/failed sources remain holds; disabled and paused
jobs remain disabled. No shared daily schedule is invented.

`persist.mjs` creates an immutable registration directory, joins verified
schedules by profile pin, writes a digest, and reads the result back. Verify
that the selected destination really is the intended Awai FS service. Read it
through an independent service request as an additional check; a filesystem
mount can cache reads. Preserve partial directories for reconciliation.

In the Soshiki browser UI select `catalog.json` with the local file picker to
merge Circles, roles and bot registrations. Existing work is retained; identity
or name conflicts refuse the entire import. Repeat imports are idempotent until
the imported records have local edits, which require reconciliation. Imports
force `approval: ask` and never activate runtime grants or schedules. UI state
remains browser-local; edits are not automatically synchronized to Awai FS.

Current boundary: catalog/pin verification, immutable hosted registration,
browser import, and explicit Linear bindings are implemented. The continuously
running scheduler, scoped Linear executor, ownership/lease reconciliation and
restart/recovery acceptance remain open. The separate Muse CLI inference probe
is evidence of that provider/model call only; it does not qualify 899 live bots.
Do not enable imported scripts with a generic shell cron wrapper.
