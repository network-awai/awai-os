# Awai PC release builds on VKE

[AWAI-3664](https://linear.app/kotobalabs/issue/AWAI-3664) tracks the migration from the large Vultr build VM. [AWAI-3600](https://linear.app/kotobalabs/issue/AWAI-3600) owns the current release decision and physical acceptance.

Use a dedicated x86_64 VKE node pool for unsigned AOSP release builds. Keep the existing Tatara jobs on their CI pool and sign on the approved Mac. Save the build output and verify it from independent storage before releasing the build nodes. KVM boot checks and device acceptance keep their own evidence.

## Prepare a build

1. Record the exact Awai OS revision and the resolved Android repo manifest. Retain the source bundle, overlays, tool and image digests, build commands and configuration, and public-key inputs needed for the selected build. Keep the installer and OTA target revisions identified separately.
2. Check VKE plan availability in the intended region before submission. The current release build used 16 vCPUs, 64 GiB RAM and more than 500 GB of working space. Compare node **allocatable** CPU, memory and workspace against observed build peaks and filesystem overhead. A nominal 16-vCPU VM does not give a pod all 16 vCPUs. The existing 4-vCPU Tatara nodes are too small.
3. Use a dedicated pool with labels and taints. Require its label in the release Job and tolerate only its dedicated taint. Request the measured resources and use a pinned build image. Install the toolchain from pinned inputs and ensure the pod has enough workspace for a cold checkout and build. A cache may shorten builds. The run must be recoverable from the pinned inputs if the cache is lost.
4. Give each candidate its own Job and output prefix. Start with one concurrent build. Configure a deadline and bound retries so a failed submission cannot leave an unbounded queue or repeated partial uploads. Store release credentials only in the approved signing environment. The build worker needs access only to its pinned inputs and its own unsigned output location.

## Scale with work

VKE scales nodes in a configured range when pods need resources. Verify whether the dedicated pool can drop to zero and come back from a pending Job in this tenant and region. Keep the small system/CI capacity available. If VKE cannot resume an empty pool, use queue admission to create one dedicated node when there is a build, then remove that pool once the queue is empty and the completed outputs are verified. Serialize queue admission and teardown so a new build cannot be assigned to a pool being removed. Do not report zero idle compute cost until billing confirms it. Retained storage has its own cost.

Pilot the entire cycle with pinned inputs from a completed release build. Record the node plan, allocatable resources, cold-start delay, workspace peak, build duration, artifact readback and cost. Check a completed run and a failed run. Ensure a failed build or upload is visible and retains relevant logs. Verify that teardown affects only the dedicated build pool and that the next queued build can start afresh.

[How to scale VKE node pools](https://docs.vultr.com/products/compute/kubernetes/management/node-pool/scale) · [Vultr provider report on initial node quantity](https://github.com/vultr/terraform-provider-vultr/issues/771)

## Preserve and restore the current release

1. Identify the exact candidate and needed predecessors from the release decision. Inventory build inputs, unsigned target-files, tools, logs, signed target-files, install image, OTA payloads and feed metadata as applicable. Record byte counts and SHA-256 digests. Keep provenance linking each signed output to its unsigned input. Track any host-only patch, artifact or log in the inventory.
2. Store this inventory and its files in an approved location whose lifetime is independent of the build VM and the VKE pool. Copies between directories on the build VM and historical snapshots do not establish recovery for the current candidate.
3. From a separate clean environment, fetch the recorded objects by version, verify every digest, and use the normal release verification to check that the install image and OTA packages can be used with their recorded inputs. Confirm that the pinned manifest, tools and overlays can start a clean rebuild. Save the restore check and its result with the release evidence. Historical snapshot recovery does not replace this check.

## Retire the old instance

After the release and restore checks close, confirm there are no running jobs or unique dependencies on the old host. Verify the provider instance ID against the build record. Remove only that instance and confirm its absence in Vultr and the end of recurring compute charges. Keep the verified recovery objects available for the next release. If a build is needed before the VKE pilot passes, restore the verified inputs on a short-lived build VM and remove it after output verification. Vultr continues to bill a stopped instance.

[Awai release signing](../../android/release-signing/README.md) · [Vultr billing for servers](https://docs.vultr.com/support/platform/billing/how-am-i-billed-for-my-servers)
