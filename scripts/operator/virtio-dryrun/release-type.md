# Proposal: user or userdebug for the first KVM run (AWAI-4089 G2)

Recommendation: **run the first KVM bring-up + OTA validation as
`userdebug`; build the first `user` image only after the debug route
is proven.** `RELEASE_TYPE` in `build-inside.sh` / `virtio-job.sh` has
no default — the operator must name `user` or `userdebug` explicitly.

Reasons:

1. The first KVM run needs *evidence*, not the final product.
   Boot completion (`sys.boot_completed`), active slot
   (`ro.boot.slot_suffix`), and `update_engine` logs — the evidence
   AWAI-3682's V1/V2/V7 checks depend on — require `adb`. A `user`
   build seals the debug routes by design (the shipping-lockdown
   patch set exists precisely to remove ADB), so a `user` first run
   cannot produce that evidence.
2. The lockdown patches have not been built or booted yet
   (pc-ab-device README). `userdebug` keeps `adb` while the lock
   route is validated separately; shipping a `user` image whose
   debug-removal path is untested would hide (not prove) the result.
3. `userdebug` is the smaller same-tree change: the Job prints
   `breakfast lineage_virtio_x86_64 $RELEASE_TYPE`, so flipping the
   choice costs no rework — only the explicit parameter value.

When the first `user` build happens: after userdebug shows a
successful boot and full+incremental OTA apply in KVM, the debug
route is switched per the lockdown patch set, and the same Job with
`RELEASE_TYPE=user` builds the sealing image. Until that point, no
`user` OTA is expected or claimed.

## Environment table

| Variable | Required | Meaning |
| --- | --- | --- |
| `RELEASE_TYPE` | always | `user` or `userdebug`; no default (`build-inside.sh`, `virtio-job.sh`). |
| `AWAI_WITHOUT_APPS` | one apps mode | `1` = evaluation build; no Awai Home/Store. Refused with `RELEASE_TYPE=user`. |
| `AWAI_HOME_APK` | prebuilt mode | path to the Awai Home APK (not committed here). |
| `AWAI_STORE_APK` | prebuilt mode | path to the Awai Store APK (not committed here). |
| `AWAI_HOME_EXPECTED_SIGNER_SHA256` | prebuilt mode | expected Home signer digest (lowercase hex). |
| `AWAI_STORE_EXPECTED_SIGNER_SHA256` | prebuilt mode | expected Store signer digest (lowercase hex). |
| `AWAI_APKSIGNER` | prebuilt mode | host `apksigner` the #523 guard runs. |

Exactly one apps mode is required. `AWAI_WITHOUT_APPS=1` and any of the
five prebuilt values together are refused; neither is refused. The
chosen mode is printed once per run as `AWAI4094_APPS: …`. With
`RELEASE_TYPE=user` the only accepted mode is prebuilt: the guard
refuses `AWAI_WITHOUT_APPS=1` on release builds, and this Job refuses
it earlier.

The same guard applies to the planned **arm64** and **TV** targets.
No Job for them exists in this repository (**undefined; required when
one is created**); each must select and record an apps mode the same
way (`RELEASE_TYPE`/`AWAI4094_APPS`), or every build stops in the
guard.
