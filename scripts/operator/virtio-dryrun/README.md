# lineage_virtio_x86_64 dry-run Job (AWAI-4089 G2)

Dry-run definition only. No node pool is created, no workload tool
runs, no paid API is called: both scripts refuse unless `DRY_RUN=1`,
and even with it they print the steps/Job rather than execute them
(`repo sync` is printed, not run).

- `build-inside.sh` — validates the G1 pinned manifest SHA-256
  (`61c11f50…`, used as-is, installed as `.repo/manifests/default.xml`
  by the printed `cp`), then prints: `repo init -u
  https://github.com/LineageOS/android.git -b lineage-24.0`,
  `repo sync` (not run), `breakfast lineage_virtio_x86_64 userdebug`,
  `git apply --check` + `git apply` for every Part-1-applicable
  patch in repo apply order (with exclusions recorded:
  `mkbootimg-header-version.patch` and the unchosen/obsoleted
  userdata-fstab variants), `pc-firmware.py prepare` (with the
  recorded `DEVICE_REVISION` divergence), `m target-files-package
  otatools`, `make-tf-disk.sh`, full + incremental OTA generation.
  `--validate-against <src>` runs real `git apply --check`/apply in
  order and aborts with `AWAI4089_NOT_APPLICABLE` at the first patch
  that does not apply (the offline-test hook).
- `virtio-job.sh` — prints the Kubernetes Job YAML (same image,
  namespace shape and resource requests as `same-build/workflow.sh`)
  with `DRY_RUN=1` in the container env. There is deliberately no
  non-dry-run mode in this ticket.

Run tests:

```sh
node --test scripts/operator/virtio-dryrun/virtio-dryrun.test.mjs
```

Claim ceiling: input/patch validation and a dry-run Job only.
No build, no boot, no reproducibility.
