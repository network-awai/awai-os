#!/usr/bin/env bash
# AWAI-4089 (G2): dry-run Job definition for lineage_virtio_x86_64.
#
# DRY_RUN=1 (required) prints the Kubernetes Job that would run
# build-inside.sh. The Job is only ever printed in this ticket: there
# is no non-dry-run mode, so this script cannot create a node pool,
# run workload-administration commands, or call a paid API. Run the
# same Job with a real pool only after a separate billing decision.
#
#   DRY_RUN=1 AWAI_VKE_NODE_POOL=awai-pc-release-012345abcdef bash virtio-job.sh > job.json
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)

if [[ ${DRY_RUN:-} != 1 ]]; then
  echo "AWAI4089_REFUSES: DRY_RUN=1 is required; nothing to do without it." >&2
  exit 2
fi
: "${AWAI_VKE_NODE_POOL:?set AWAI_VKE_NODE_POOL for the dry-run Job selector}"
namespace=awai-pc-release-build
name=awai-virtio-dryrun-build
image=ubuntu@sha256:9a04f13b3f80ef056361e30868593b1cfd2279fe19e4081cb93a90bf56819d6a
# build-inside.sh runs only under DRY_RUN=1, so the Job would print
# steps and exit; command below mirrors what a paid run would execute.
command="bash $here/build-inside.sh"

jq -n \
  --arg name "$name" --arg ns "$namespace" --arg pool "$AWAI_VKE_NODE_POOL" \
  --arg image "$image" --arg command "$command" \
  '{
   apiVersion: "batch/v1", kind: "Job",
   metadata: { name: $name, namespace: $ns,
     labels: { "awai.network/g2-dry-run": "true" } },
   spec: {
     backoffLimit: 0,
     activeDeadlineSeconds: 19800,
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
                 { name: "DRY_RUN", value: "1" },
                 { name: "SRC", value: "/root/build/src" }],
           command: ["bash", "-euo", "pipefail", "-c", $command],
           resources: { requests: { cpu: "14", memory: "64Gi", "ephemeral-storage": "520Gi" } },
           volumeMounts: [{ name: "workspace", mountPath: "/root/build" }]
         }],
         volumes: [{ name: "workspace", emptyDir: { sizeLimit: "700Gi" } }]
       }
     }
   }
  }'
