# C1 candidate run plan — 2026-11-11 JST

Tracking: AWAI-2773 / AWAI-2772. PR #83 merged at
`4b692cc10735896da63935d02880001e6a12dcf5` after exact-head review, Mac
8 tests/31 assertions and both Nix CI jobs passed. This follow-up checks the
operator plan's inputs, not execution or operational readiness.

## Observation and commands

Local operator: this Codex session, Mac arm64, Babashka v1.12.218. No image,
model, runtime or oracle package was downloaded for this observation.

```sh
bb scripts/otehon-c1/preflight.clj levi benjamin
bb scripts/otehon-c1/preflight_test.clj
bb scripts/otehon-c1/run_plan_test.clj
bb scripts/otehon-c1/run_plan.clj scripts/otehon-c1/run-plan.edn \
  docs/evidence/otehon-c1-run-plan-20261111/host-inventory.json
```

The sanitized inventory was collected through existing SSH trust and the node
account. Both candidates report Darwin/arm64, 10 logical CPUs and 16 GiB RAM;
neither shows a Lima instance to that account. Other accounts/managers and real
service endpoints were not inspected. No VM or service was started or stopped.
The plan binds the exact inventory SHA-256; source pins describe existing
profile/adapter candidates and retain their limits, not live qualification.

Local results: preflight 8 tests/31 assertions; run-plan 9 tests/75 assertions,
all passed. Cases cover stale/future/mismatched or modified inventory, duplicate
identity/domain declarations, missing/overlarge/incorrect-unit resource inputs,
fixture/unbound adapters, missing operators/artifact/protocol inputs, mandatory
failure cases, bounded files/symlinks/trailing forms, and real CLI exits.
Even complete test metadata never returns execution permission or readiness.
Linux/Nix results belong to the follow-up PR's exact-head CI, not this Mac run.

The real candidate returns exit 2, status `blocked`, ten incomplete check groups,
and all three execution/readiness flags false. The inventory hash is bound, but
its permitted age still needs an operator decision. Numeric resource ceilings,
SLOs and experiment approval were not invented from the passing tests.

## Concrete remaining inputs

| Owner | Required next observation or decision |
| --- | --- |
| AWAI-2773 | Independently verify the two host identities and failure domains; pin a dedicated guest and its readback on each without altering preserved VMs |
| AWAI-2773 | Set the inventory age policy and per-provider resource ceilings; obtain actual enforcement/reservation readbacks |
| AWAI-94 | Name the run operator and reviewer; Jun's existing accountability is not an operator reservation |
| AWAI-2774 | Connect real consent/revocation, durable reservation/fence, OCI and signed independent witness readbacks; draft PR #69 is a model only |
| AWAI-2775 | Pin the public input, expected output/quality contract and real engine/model artifacts; obtain authenticated inference evidence; PR #53 source is not live proof |
| AWAI-2776 | Connect authorized encrypted storage, key custody and backup restore; the merged local Pack store does not prove independent replication |
| AWAI-2777 | Fix the failure protocol and explicit SLOs before the experiment; record protocol evidence before the proposed 24h soak |

`plan-check.json` is a dated observation of incomplete inputs. Re-run against a
fresh inventory before using the plan; filling reference strings does not
validate those references or authorize a workload. C1.0 stays In Progress.
