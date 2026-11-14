# Otehon C1 preflight — 2026-11-12 JST

Tracking: [AWAI-2773](https://linear.app/kotobalabs/issue/AWAI-2773),
integration [AWAI-2772](https://linear.app/kotobalabs/issue/AWAI-2772).
Prepared from awai-os main `69d0493`. Operator: Muse, Babashka v1.12.218
on macOS arm64. Commands run from the task worktree root:

```sh
bb scripts/otehon-c1/preflight_test.clj
bb scripts/otehon-c1/run_plan_test.clj
bb scripts/otehon-c1/preflight.clj levi benjamin
bb scripts/otehon-c1/run_plan.clj scripts/otehon-c1/run-plan.edn \
  docs/evidence/otehon-c1-preflight-20261112/host-inventory.json
```

The third command uses the existing `node` account and SSH host trust on
both selected aliases. `host-inventory.json` contains its sanitized output,
timestamp and explicit evidence limits. `sha256.txt` binds the probe, both
test suites, draft plan, Nix check and both observations. Preflight tests:
8 tests / 31 assertions; run-plan tests: 9 tests / 75 assertions. No model,
image or runtime package was downloaded for the local observation.

The fourth command joins the draft run plan against the fresh inventory.
It exits 2 (invalid or incomplete inputs, by design): the plan remains a
draft checklist, not an executable configuration. `run-plan-report.json`
records the machine-generated missing-input list that C1.1–C1.4 must close:
independent identities/failure domains, guest digests/readbacks, per-provider
ceilings with enforcement readbacks, named operators, fixture/artifact/model
digests, real consent/revocation/reservation/fence/OCI/witness readbacks,
authenticated inference readback, encrypted storage/key-custody/backup
readbacks, and predeclared SLO bounds with a protocol evidence digest.

| Observation | levi | benjamin |
| --- | --- | --- |
| SSH probe | collected | collected |
| OS / architecture | Darwin / arm64 | Darwin / arm64 |
| Logical CPU count | 10 | 10 |
| Physical RAM | 16 GiB | 16 GiB |
| Lima instances visible to `node` | 0 | 0 |
| Docker / Podman executable in probe PATH | absent / absent | present / absent |
| Lima / QEMU executable in probe PATH | present / present | present / present |
