# Otehon C1 preflight — 2026-11-11 JST

Tracking: [AWAI-2773](https://linear.app/kotobalabs/issue/AWAI-2773),
integration [AWAI-2772](https://linear.app/kotobalabs/issue/AWAI-2772).
Prepared from awai-os main `65d80b5`. Operator: Codex, Babashka v1.12.218
on macOS arm64. Commands run from the task worktree root:

```sh
bb scripts/otehon-c1/preflight_test.clj
bb scripts/otehon-c1/preflight.clj levi benjamin
```

The second command uses the existing `node` account and SSH host trust on
both selected aliases. `host-inventory.json` contains its sanitized output,
timestamp and explicit evidence limits. `sha256.txt` binds the probe, tests,
draft plan, Nix check and observation. Tests: 8 tests / 31 assertions, including
an actual process deadline, oversized output, malformed/missing facts,
duplicate targets and refusal to promote inventory into operational readiness.
No model, image or runtime package was downloaded for the local observation.

| Observation | levi | benjamin |
| --- | --- | --- |
| SSH probe | collected | collected |
| OS / architecture | Darwin / arm64 | Darwin / arm64 |
| Logical CPU count | 10 | 10 |
| Physical RAM | 16 GiB | 16 GiB |
| Lima instances visible to `node` | 0 | 0 |
| Docker / Podman executable in probe PATH | absent / absent | present / absent |
| Lima / QEMU executable in probe PATH | present / present | present / present |

This does not establish distinct hardware identities or failure domains.
CPU count, physical RAM and home-filesystem free space are not reserved
capacity. The Lima observation excludes other accounts and other VM managers.
Docker's executable does not establish daemon or rootless execution readiness.
No inference request or service-health test was made.

**Operational ready: false.** Live consent/revocation, reservation authority,
OCI execution/fencing/witness, authenticated inference, authorized encrypted
replication/recovery and monitoring/soak remain open. The run-plan keeps
unresolved inputs as `nil`; it is not executable and supplies no permission.

Next: identify/pin the dedicated Otehon guest on each selected host and its
actual resource limits without altering any existing linked VM; then bind
owning consent/reservation/executor adapters. Maintain refusal/unknown states
until their readbacks exist. C1.0 remains In Progress.

An isolated Nix check using the repository's immutable nixpkgs pin is wired
only into the existing Otehon CI job. It runs local negative controls without
SSH, credentials or network probes. Local Nix execution was unavailable;
Linux/Nix results must be read from PR CI and not inferred from the Mac run.
