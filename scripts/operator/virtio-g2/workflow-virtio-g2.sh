#!/usr/bin/env bash
# G2 (AWAI-4088): create the VKE Job that runs build-virtio-g2.sh.
# Modeled on scripts/operator/same-build/workflow.sh (same Job vm shape,
# same secret helper), but distinct: different dir, different images of
# inputs, different B2 prefix (awai-virtio-g2/<pool>/), different out dir.
# Does NOT modify same-build/: existing lamu / Generic_x86_64 Jobs are untouched.
#
# Usage:
#   bash workflow-virtio-g2.sh --dry-run   # print the Job YAML, create nothing
#   bash workflow-virtio-g2.sh              # create the Job (requires KUBECONFIG, pool env)
# The dry-run path is the only path exercised by this PR.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
operator=$(cd "$here/.." && pwd)
namespace=awai-pc-release-build
build_job=awai-virtio-g2-build
image=ubuntu@sha256:9a04f13b3f80ef056361e30868593b1cfd2279fe19e4081cb93a90bf56819d6a
bucket=awai-os-release-artifacts
secret=release-artifacts-b2
k() { kubectl -n "$namespace" "$@"; }

if [[ "${1:-}" = "--dry-run" ]]; then
  echo "DRY_RUN: no cluster access, no Job created."
  echo "job=$build_job namespace=$namespace image=$image"
  echo "prefix=awai-virtio-g2/<pool>/ (new, distinct from awai-same-build/<pool>/)"
  echo "product=lineage_virtio_x86_64 variant=\${VARIANT:-user}"
  echo "inputs: pinned-manifest.xml (sha 61c11f5...) + pc-ab-device (apply.sh)"
  echo "chain: target-files(package) -> install image (diskimage-vda) -> full OTA -> incremental OTA"
  AWAI_G2_DRY_RUN=1 bash "$here/build-virtio-g2.sh"
  exit 0
fi

: "${KUBECONFIG:?}" "${AWAI_VKE_NODE_POOL:?}"
[[ ${AWAI_VKE_NAMESPACE:-} = "$namespace" ]]
out=${AWAI_G2_OUT:?set AWAI_G2_OUT to a new local evidence directory}
mkdir -m 700 -p "$out"
pool=$AWAI_VKE_NODE_POOL
prefix="awai-virtio-g2/$pool"

cleanup() {
    local status=$?
    trap - EXIT
    set +e
    k logs "job/$build_job" --request-timeout=25s > "$out/$build_job.log" 2>/dev/null || true
    k delete secret "$secret" --ignore-not-found --request-timeout=12s >/dev/null 2>&1
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP

command=$(cat <<'BUILD'
apt-get -qq update
apt-get -qq install -y bc bison build-essential ca-certificates ccache cmake curl flex g++-multilib gcc-multilib git git-lfs gperf imagemagick lib32readline-dev lib32z1-dev libclang-18-dev libegl1 libelf-dev libglvnd-dev liblapack-dev liblz4-tool libopenblas-dev libpam-pwquality libsdl1.2-dev libssl-dev libxml2 libxml2-utils lz4 lzop ninja-build pkg-config python-is-python3 python3-dev python3-jsonschema python3-mako python3-packaging python3-pip python3-pycparser python3-ply python3-yaml rclone rsync schedtool squashfs-tools unzip xorriso xsltproc zip zstd
mkdir -p /root/build/kit
touch /root/build/tools-ready
until test -f /root/build/inputs-ready; do sleep 5; done
bash /root/build/kit/virtio-g2/build-virtio-g2.sh 2>&1 | tee /root/build/virtio-g2.log
BUILD
)

# Stage the kit inputs the Job reads. build-virtio-g2.sh expects, under
# /root/build/kit/virtio-g2/: scripts + pinned-manifest.xml + pc-ab-device/
# + target-files/mkbootimg-header-version.patch, all taken from this repo
# tree at run time (never committed duplicates).
repo_root=$(cd "$operator/../.." && pwd)
node "$operator/release-artifacts-secret.mjs" "$namespace" "$secret"

jq -n --arg name "$build_job" --arg ns "$namespace" --arg pool "$pool" --arg image "$image" \
    --arg command "$command" --arg cpu 14 --arg memory 64Gi --arg space 520Gi \
    --argjson deadline 19800 --arg bucket "$bucket" --arg prefix "$prefix" --arg secret "$secret" '
  {apiVersion:"batch/v1",kind:"Job",metadata:{name:$name,namespace:$ns},spec:{
    backoffLimit:0,activeDeadlineSeconds:$deadline,template:{
     metadata:{annotations:{"cluster-autoscaler.kubernetes.io/safe-to-evict":"false"}},
     spec:{restartPolicy:"Never",automountServiceAccountToken:false,
      nodeSelector:{"vke.vultr.com/node-pool":$pool,"kubernetes.io/arch":"amd64"},
      tolerations:[{key:"awai.network/release-build",operator:"Equal",value:"release",effect:"NoSchedule"}],
      containers:[{name:"worker",image:$image,
       env:[{name:"DEBIAN_FRONTEND",value:"noninteractive"},{name:"AWAI_ARTIFACT_BUCKET",value:$bucket},
            {name:"AWAI_ARTIFACT_PREFIX",value:$prefix}],
       envFrom:[{secretRef:{name:$secret}}],command:["bash","-euo","pipefail","-c",$command],
       resources:{requests:{cpu:$cpu,memory:$memory,"ephemeral-storage":$space}},
       volumeMounts:[{name:"workspace",mountPath:"/root/build"}]}],
      volumes:[{name:"workspace",emptyDir:{sizeLimit:"700Gi"}}]}}}}' | k create -f -

# Wait for the build Pod, then copy this kit (manifest + pc-ab-device + scripts) into it.
pod=""
deadline=$((SECONDS + 600))
while (( SECONDS < deadline )); do
    pod=$(k get pods -l "job-name=$build_job" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
    [[ -n $pod ]] && break; sleep 3
done
[[ -n $pod ]]
k wait pod/"$pod" --for=condition=Ready --timeout=10m
for i in $(seq 1 72); do
    k exec "$pod" --request-timeout=12s -- test -f /root/build/tools-ready >/dev/null 2>&1 && break; sleep 5
done
COPYFILE_DISABLE=1 tar --no-xattrs -C "$here" -cf - . |
    k exec -i "$pod" -- bash -c 'mkdir -p /root/build/kit/virtio-g2 && tar -xf - -C /root/build/kit/virtio-g2'
# Stage repo inputs into the kit, laid out as build-virtio-g2.sh expects:
# pinned-manifest.xml, pc-ab-device/, target-files/mkbootimg-header-version.patch
# under /root/build/kit/virtio-g2/. Staged on the operator machine from this
# repo checkout (the pod has no repo), via tar with explicit member names.
COPYFILE_DISABLE=1 tar --no-xattrs -C "$repo_root" -cf - android/desktop/manifest/pinned-manifest.xml android/desktop/pc-ab-device android/desktop/target-files/mkbootimg-header-version.patch |
    k exec -i "$pod" -- bash -c 'mkdir -p /tmp/virtio-g2-kit && tar -xf - -C /tmp/virtio-g2-kit && mkdir -p /root/build/kit/virtio-g2 && cp /tmp/virtio-g2-kit/android/desktop/manifest/pinned-manifest.xml /root/build/kit/virtio-g2/ && cp -r /tmp/virtio-g2-kit/android/desktop/pc-ab-device /root/build/kit/virtio-g2/ && mkdir -p /root/build/kit/virtio-g2/target-files && cp /tmp/virtio-g2-kit/android/desktop/target-files/mkbootimg-header-version.patch /root/build/kit/virtio-g2/target-files/'
k exec "$pod" -- bash -ceu 'test -x /root/build/kit/virtio-g2/build-virtio-g2.sh || chmod +x /root/build/kit/virtio-g2/build-virtio-g2.sh; touch /root/build/inputs-ready'
printf 'VIRTIO_G2_INPUTS_READY=%s\n' "$(date -u +%FT%TZ)"

# Build may take hours; poll the ready flag cheaply.
deadline=$((SECONDS + 19500))
while (( SECONDS < deadline )); do
    if k exec "$pod" --request-timeout=12s -- test -f /root/build/artifacts-ready >/dev/null 2>&1; then break; fi
    phase=$(k get pod "$pod" -o jsonpath='{.status.phase}' 2>/dev/null || echo Unknown)
    [[ $phase = Succeeded || $phase = Failed ]] && break
    sleep 60
done
k wait job/"$build_job" --for=condition=Complete --timeout=10m
printf 'VIRTIO_G2_BUILD_COMPLETE=%s\n' "$(date -u +%FT%TZ)"
