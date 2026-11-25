#!/usr/bin/env bash
# AWAI-4089 (G2): Job definition for lineage_virtio_x86_64.
#
# Prints the Job unless explicitly allowed to run: without
# (DRY_RUN=1) or (BILLING_ALLOWED=1 AND OWNER_APPROVED=1) this script
# refuses (exit 2) and prints nothing. It never creates a node pool,
# runs workload-administration commands, or calls a paid API.
#
# The Job command installs the toolchain FIRST (apt-get), then runs
# build-inside.sh (which fetches the kit by KIT_URL/KIT_SHA256 with
# SHA verification). A plain ubuntu image has no rclone pre-install,
# so no rclone bootstrap is attempted before apt-get.
#
#   DRY_RUN=1 RELEASE_TYPE=userdebug AWAI_VKE_NODE_POOL=awai-pc-release-012345abcdef bash virtio-job.sh > job.json
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)

# Approval gate — mirrors build-inside.sh.
if [[ ${DRY_RUN:-} == 1 ]]; then
  :
elif [[ ${BILLING_ALLOWED:-} == 1 && ${OWNER_APPROVED:-} == 1 ]]; then
  echo "AWAI4089_BILLING_MODE: BILLING_ALLOWED=1 OWNER_APPROVED=1 recorded" >&2
else
  echo "AWAI4089_REFUSES: DRY_RUN=1 (default) or BILLING_ALLOWED=1+OWNER_APPROVED=1 is required." >&2
  exit 2
fi

# RELEASE_TYPE is an explicit parameter: no silent default anywhere.
case "${RELEASE_TYPE:-}" in
  user|userdebug) ;;
  *)
    echo "AWAI4089_REFUSES: RELEASE_TYPE must be explicitly set to user or userdebug (got '${RELEASE_TYPE:-<unset>}')." >&2
    exit 2
    ;;
esac

# Deadline: 8h per Job, minimum 28800 seconds.
DEADLINE=${AWAI_VIRTIO_DEADLINE_SECONDS:-28800}
if ! [[ $DEADLINE =~ ^[0-9]+$ ]] || (( DEADLINE < 28800 )); then
  echo "AWAI4089_REFUSES: AWAI_VIRTIO_DEADLINE_SECONDS must be >= 28800 (8h per Job; got '${DEADLINE}')." >&2
  exit 2
fi

: "${AWAI_VKE_NODE_POOL:?set AWAI_VKE_NODE_POOL for the Job selector}"
namespace=awai-pc-release-build
name=awai-virtio-dryrun-build
image=ubuntu@sha256:9a04f13b3f80ef056361e30868593b1cfd2279fe19e4081cb93a90bf56819d6a

job_command='apt-get -qq update && apt-get -qq install -y bc bison build-essential ca-certificates ccache cmake curl flex g++-multilib gcc-multilib git git-lfs gperf imagemagick lib32readline-dev lib32z1-dev libclang-18-dev libegl1 libelf-dev libglvnd-dev liblapack-dev liblz4-tool libopenblas-dev libpam-pwquality libsdl1.2-dev libssl-dev libxml2 libxml2-utils lz4 lzop ninja-build pkg-config python-is-python3 python3-dev python3-jsonschema python3-mako python3-packaging python3-pip python3-pycparser python3-ply python3-yaml rclone rsync schedtool squashfs-tools unzip xorriso xsltproc zip zstd && mkdir -p /root/build/kit && bash /root/build/virtio-dryrun/build-inside.sh'

jq -n \
  --arg name "$name" --arg ns "$namespace" --arg pool "$AWAI_VKE_NODE_POOL" \
  --arg image "$image" --arg command "$job_command" \
  --arg dryrun "${DRY_RUN:-}" --arg billing "${BILLING_ALLOWED:-}" \
  --arg approved "${OWNER_APPROVED:-}" --arg release_type "$RELEASE_TYPE" \
  --arg kit_url "${KIT_URL:-}" --arg kit_sha256 "${KIT_SHA256:-}" \
  --arg feed_url "${AWAI_FEED_URL:-}" \
  --arg pool_label "${AWAI_POOL_LABEL:-}" \
  --arg firmware_git "${FIRMWARE_GIT:-/root/build/firmware/src}" \
  --argjson deadline "$DEADLINE" \
  '{
   apiVersion: "batch/v1", kind: "Job",
   metadata: { name: $name, namespace: $ns,
     labels: {
       "awai.network/g2-dry-run": "true",
       "awai.network/release-type": $release_type,
       "awai.network/billing-allowed": $billing,
       "awai.network/owner-approved": $approved
     } },
   spec: {
     backoffLimit: 0,
     activeDeadlineSeconds: $deadline,
     template: {
       metadata: { annotations: { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" } },
       spec: {
         restartPolicy: "Never",
         automountServiceAccountToken: false,
         nodeSelector: {
           "vke.vultr.com/node-pool": $pool,
           "kubernetes.io/arch": "amd64"
         },
         tolerations: [{ key: "awai.network/release-build", operator: "Equal",
                         value: "release", effect: "NoSchedule" }],
         containers: [{
           name: "worker", image: $image,
           env: [{ name: "DEBIAN_FRONTEND", value: "noninteractive" },
                 { name: "DRY_RUN", value: $dryrun },
                 { name: "BILLING_ALLOWED", value: $billing },
                 { name: "OWNER_APPROVED", value: $approved },
                 { name: "RELEASE_TYPE", value: $release_type },
                 { name: "AWAI_VIRTIO_DEADLINE_SECONDS", value: ($deadline | tostring) },
                 { name: "KIT_URL", value: $kit_url },
                 { name: "KIT_SHA256", value: $kit_sha256 },
                 { name: "AWAI_FEED_URL", value: $feed_url },
                 { name: "AWAI_POOL_LABEL", value: $pool_label },
                 { name: "FIRMWARE_GIT", value: $firmware_git },
                 { name: "SRC", value: "/root/build/src" },
                 { name: "KIT", value: "/root/build/kit/virtio-dryrun" }],
           envFrom: [{ secretRef: { name: "release-artifacts-b2" } }],
           command: ["bash", "-euo", "pipefail", "-c", $command],
           resources: { requests: { cpu: "14", memory: "64Gi", "ephemeral-storage": "520Gi" } },
           volumeMounts: [{ name: "workspace", mountPath: "/root/build" }]
         }],
         volumes: [{ name: "workspace", emptyDir: { sizeLimit: "700Gi" } }]
       }
     }
   }
  }'
