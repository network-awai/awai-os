# G2 build minimum conditions (AWAI-4089)

Sourced figures only; anything without a source is marked unmeasured.
The local 15GiB free-space gate (`/Users/node`) is for this host only
and does not size the build.

| Condition | Minimum | Source |
|---|---|---|
| RAM (build box) | 52Gi under the `vc2-16c-64gb` plan (64Gi default plan; same-build lowers to 52Gi for this plan) | `scripts/operator/same-build/workflow.sh` (`build_memory=64Gi`; `if vc2-16c-64gb then 52Gi`) |
| ccache | enabled (`USE_CCACHE=1` / `CCACHE_EXEC=/usr/bin/ccache`, ephemeral dir) | `android/desktop/ota-reference-check/ab-build.sh` (build host `vc2-16c-64gb`, 2026-11-19) |
| Disk | 520Gi ephemeral-storage request; the A/B corpus includes the synced ~1264-project tree plus v1/v2 target-files | this repo's Job requests (`virtio-job.sh`); total free-disk need unmeasured beyond the request |
| Build time | v1 initial build ~32 min on the reference run; v2 rebuild 336 s (same source, new build number) | `android/desktop/ota-reference-check/evidence/ota-reference-kvm-20261119.json` (`builds.v1`: 1795077496 ≈ 32 min; `builds.v2.buildSeconds`: 336) |
| Job window | minimum 28800 s (8h) | this repo's `AWAI_VIRTIO_DEADLINE_SECONDS` guard |
| A/B OTA install (VM) | unmeasured on the build host; VM pre/post phases measured separately in the reference run | no local claim |
| Cold `repo sync` time/disk | unmeasured (fixture tests stub it) | `node --test scripts/operator/virtio-dryrun/virtio-dryrun.test.mjs` |

Notes: Tatara's prior 6–7h figure is not used here (not found in the
cited records). Numbers above are sufficient for capacity planning;
cold-sync duration and its disk use remain to measure.
