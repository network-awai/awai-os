# Awai PC release builds on VKE

[AWAI-3664](https://linear.app/kotobalabs/issue/AWAI-3664) tracks the migration from the large Vultr build VM. [AWAI-3600](https://linear.app/kotobalabs/issue/AWAI-3600) owns the current release decision and physical acceptance.

Use a dedicated x86_64 VKE node pool for unsigned AOSP release builds. Keep the existing Tatara jobs on their CI pool and sign on the approved Mac. Save the build output and verify it from independent storage before releasing the build nodes. KVM boot checks and device acceptance keep their own evidence.

## Prepare a build

1. Record the exact Awai OS revision and the resolved Android repo manifest. Retain the source bundle, overlays, tool and image digests, build commands and configuration, and public-key inputs needed for the selected build. Keep the installer and OTA target revisions identified separately.
2. Check VKE plan availability in the intended region before submission. The current release build used 16 vCPUs, 64 GiB RAM and more than 500 GB of working space. Compare node **allocatable** CPU, memory and workspace against observed build peaks and filesystem overhead. A nominal 16-vCPU VM does not give a pod all 16 vCPUs. The existing 4-vCPU Tatara nodes are too small.
3. Use a dedicated pool with labels and taints. Require its label in the release Job and tolerate only its dedicated taint. Request the measured resources and use a pinned build image. Install the toolchain from pinned inputs and ensure the pod has enough workspace for a cold checkout and build. A cache may shorten builds. The run must be recoverable from the pinned inputs if the cache is lost.
4. Give each candidate its own Job and output prefix. Start with one concurrent build. Configure a deadline and bound retries so a failed submission cannot leave an unbounded queue or repeated partial uploads. Store release credentials only in the approved signing environment. The build worker needs access only to its pinned inputs and its own unsigned output location.

## Scale with work

Keep the small system/CI capacity available. For the current Tokyo cluster, use queue admission to create one dedicated node when there is a build. Remove that pool once the queue is empty and the restored outputs are verified. Serialize queue admission and teardown so a new build cannot be assigned to a pool being removed. Confirm both the compute instance removal and the final time on its Vultr billing line. Retained storage has its own cost.

Pilot the entire cycle with pinned inputs from a completed release build. Record the node plan, allocatable resources, cold-start delay, workspace peak, build duration, artifact readback and cost. Check a completed run and a failed run. Ensure a failed build or upload is visible and retains relevant logs. Verify that teardown affects only the dedicated build pool and that the next queued build can start afresh.

[How to scale VKE node pools](https://docs.vultr.com/products/compute/kubernetes/management/node-pool/scale) · [Vultr provider report on initial node quantity](https://github.com/vultr/terraform-provider-vultr/issues/771)

## Run the pool lifecycle from the release queue

Invoke [the operator command](../../scripts/operator/vke-release-pool.mjs) from the release queue worker. The queue opens a single run per cluster and supplies the build-and-restore command. Use Node.js with the built-in Fetch API, an authorized VKE kubeconfig, and a Vultr key supplied by the operator's secret store. The read-only `status` operation uses the kubeconfig alone.

```sh
node scripts/operator/vke-release-pool.mjs status "$KUBECONFIG"
node scripts/operator/vke-release-pool.mjs run "$KUBECONFIG" -- "$RELEASE_WORKFLOW"
```

The workflow uses `AWAI_VKE_NAMESPACE` and `AWAI_VKE_NODE_POOL` from the wrapper. It creates Jobs named `awai-pc-release-build` and `awai-pc-release-restore`. Each Job selects `vke.vultr.com/node-pool=$AWAI_VKE_NODE_POOL` and tolerates `awai.network/release-build=release:NoSchedule`. The restore Job reads the independent archive, verifies its manifest and persists the checksums and logs outside the pool. Return success after both Jobs complete. Include the artifacts and verification reports in the external release record.

Check the result of a failed or interrupted run promptly because a retained pool can still accrue charges. After the release worker exits, use `release` with the same kubeconfig once both Jobs have completed and restore evidence is available. Use `release-empty` when a provisioned run stopped before creating any Jobs or Pods. The release checks require the recorded run, its provider tag, and an idle pool. It waits for both Vultr and Kubernetes to report removal before releasing the run lock. Resolve an ambiguous create response against Vultr's cluster inventory before clearing any leftover lock.

## Preserve and restore the current release

1. Identify the exact candidate and needed predecessors from the release decision. Inventory build inputs, unsigned target-files, tools, logs, signed target-files, install image, OTA payloads and feed metadata as applicable. Record byte counts and SHA-256 digests. Keep provenance linking each signed output to its unsigned input. Track any host-only patch, artifact or log in the inventory.
2. Store this inventory and its files in an approved location whose lifetime is independent of the build VM and the VKE pool. Copies between directories on the build VM and historical snapshots do not establish recovery for the current candidate.
3. From a separate clean environment, fetch the recorded objects by version, verify every digest, and use the normal release verification to check that the install image and OTA packages can be used with their recorded inputs. Confirm that the pinned manifest, tools and overlays can start a clean rebuild. Save the restore check and its result with the release evidence. Historical snapshot recovery does not replace this check.

## Retire the old instance

After the release and restore checks close, confirm there are no running jobs or unique dependencies on the old host. Verify the provider instance ID against the build record. Remove only that instance and confirm its absence in Vultr and the end of recurring compute charges. Keep the verified recovery objects available for the next release. If a build is needed before the VKE pilot passes, restore the verified inputs on a short-lived build VM and remove it after output verification. Vultr continues to bill a stopped instance.

[Awai release signing](../../android/release-signing/README.md) · [Vultr billing for servers](https://docs.vultr.com/support/platform/billing/how-am-i-billed-for-my-servers)


## Tokyo pilot, 2026-11-21

One `voc-m-16c-128gb-800s-amd` node reported 15.8 allocatable vCPUs, 131,693,052 KiB of RAM and 804,963,184,640 bytes of ephemeral storage. The unsigned Awai PC install build completed at 17:19 JST. Use root-anchored exclusions when transferring the source tree to preserve tracked nested paths such as flashrom's `src/out/built.rs`. Install host Ninja for Mesa, and preserve the build workspace for recoverable environment errors.

The 5,669,737,286-byte archive was copied out of VKE to the retained build VM. A fresh restore Job read it back at 17:25 JST, verified the archive and all five build output digests, tested the target-files ZIP, and listed the OTA tools archive. The pilot used the retained VM as an independent location from the VKE pool. Keep the release recovery copy in storage with a lifetime independent of both environments.

The VKE control plane accepted a 0–1 autoscaling range. When the jobs were gone, the Cluster Autoscaler could reschedule zero of one pods on the dedicated node. Calico Typha had three replicas with required per-host anti-affinity, one on each node. Manual resize to zero was rejected. Removing the empty dedicated pool released its only node. The two Tatara nodes remained registered. The estimated Vultr charges show a closed line from 13:23 to 17:34 JST, five billed hours and USD 4.77 before tax. Check plan availability when admitting the next job.

[Live build, restore and teardown evidence](https://linear.app/kotobalabs/issue/AWAI-3664)
