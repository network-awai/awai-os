#!/usr/bin/env bash
# AWAI-3850: run under `vke-release-pool.mjs run KUBECONFIG --` (see README).
# Creates the two Jobs the pool teardown requires and waits for them.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
operator=$(cd "$here/.." && pwd)
namespace=awai-pc-release-build
build_job=awai-pc-release-build
restore_job=awai-pc-release-restore
image=ubuntu@sha256:9a04f13b3f80ef056361e30868593b1cfd2279fe19e4081cb93a90bf56819d6a
bucket=awai-os-release-artifacts
: "${KUBECONFIG:?}" "${AWAI_VKE_NODE_POOL:?}"
[[ ${AWAI_VKE_NAMESPACE:-} = "$namespace" ]]
out=${AWAI_SAME_BUILD_OUT:?set AWAI_SAME_BUILD_OUT to a new local evidence directory}
mkdir -m 700 -p "$out"
pool=$AWAI_VKE_NODE_POOL
prefix="awai-same-build/$pool"
secret=release-artifacts-b2
k() { kubectl -n "$namespace" "$@"; }

cleanup() {
    local status=$?
    trap - EXIT
    set +e
    for job in $build_job $restore_job; do
        k logs "job/$job" --request-timeout=25s > "$out/$job.log" 2>/dev/null || true
    done
    k delete secret "$secret" --ignore-not-found --request-timeout=12s >/dev/null 2>&1
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP

job() {
    local name=$1 cpu=$2 memory=$3 space=$4 deadline=$5 command
    command=$(cat)
    jq -n --arg name "$name" --arg ns "$namespace" --arg pool "$pool" --arg image "$image" \
        --arg command "$command" --arg cpu "$cpu" --arg memory "$memory" --arg space "$space" \
        --argjson deadline "$deadline" --arg bucket "$bucket" --arg prefix "$prefix" --arg secret "$secret" '
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
}

node "$operator/release-artifacts-secret.mjs" "$namespace" "$secret"

job "$build_job" 14 64Gi 520Gi 19800 <<'BUILD'
apt-get -qq update
apt-get -qq install -y bc bison build-essential ca-certificates ccache cmake curl flex g++-multilib gcc-multilib git git-lfs gperf imagemagick lib32readline-dev lib32z1-dev libclang-18-dev libegl1 libelf-dev libglvnd-dev liblapack-dev liblz4-tool libopenblas-dev libpam-pwquality libsdl1.2-dev libssl-dev libxml2 libxml2-utils lz4 lzop ninja-build pkg-config python-is-python3 python3-dev python3-jsonschema python3-mako python3-packaging python3-pip python3-pycparser python3-ply python3-yaml rclone rsync schedtool squashfs-tools unzip xorriso xsltproc zip zstd
mkdir -p /root/build/kit
touch /root/build/tools-ready
until test -f /root/build/inputs-ready; do sleep 5; done
bash /root/build/kit/same-build/build-inside.sh 2>&1 | tee /root/build/same-build.log
BUILD

# Wait for the build Pod, then copy this kit into it.
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
    k exec -i "$pod" -- bash -c 'mkdir -p /root/build/kit/same-build && tar -xf - -C /root/build/kit/same-build'
k exec "$pod" -- bash -ceu 'test -x /root/build/kit/same-build/build-inside.sh || chmod +x /root/build/kit/same-build/build-inside.sh; touch /root/build/inputs-ready'
printf 'SAME_BUILD_INPUTS_READY=%s\n' "$(date -u +%FT%TZ)"

# Build may take hours; poll the ready flag cheaply.
deadline=$((SECONDS + 19500))
while (( SECONDS < deadline )); do
    if k exec "$pod" --request-timeout=12s -- test -f /root/build/artifacts-ready >/dev/null 2>&1; then break; fi
    phase=$(k get pod "$pod" -o jsonpath='{.status.phase}' 2>/dev/null || echo Unknown)
    [[ $phase = Succeeded || $phase = Failed ]] && break
    sleep 60
done
k wait job/"$build_job" --for=condition=Complete --timeout=10m

job "$restore_job" 2 4Gi 60Gi 3600 <<'RESTORE'
apt-get -qq update
apt-get -qq install -y --no-install-recommends ca-certificates python3 rclone zstd
mkdir -p /root/build/restore && cd /root/build/restore
rclone copy "art:$AWAI_ARTIFACT_BUCKET/$AWAI_ARTIFACT_PREFIX/" . -q --transfers 2
python3 - <<'VERIFY'
import hashlib, json, os
def digest(path):
    v = hashlib.sha256()
    with open(path, "rb") as h:
        for block in iter(lambda: h.read(1 << 20), b""): v.update(block)
    return v.hexdigest()
manifest = json.load(open("manifest.json"))
for item in manifest["objects"]:
    assert os.path.getsize(item["path"]) == item["size"] and digest(item["path"]) == item["sha256"], item["path"]
os.makedirs("contents")
assert os.system("zstd -dc artifacts.tar.zst | tar -xf - -C contents") == 0
for item in manifest["contents"]:
    p = os.path.join("contents", item["path"])
    assert os.path.getsize(p) == item["size"] and digest(p) == item["sha256"], item["path"]
assert os.system("cd contents && sha256sum -c SHA256SUMS") == 0
print("MANIFEST_BEGIN"); print(json.dumps(manifest, indent=1)); print("MANIFEST_END")
VERIFY
printf 'SAME_BUILD_RESTORE_VERIFIED=%s\n' "$(date -u +%FT%TZ)"
RESTORE
k wait job/"$restore_job" --for=condition=Complete --timeout=65m
k logs job/"$restore_job" > "$out/restore-verification.log"
grep -F 'SAME_BUILD_RESTORE_VERIFIED=' "$out/restore-verification.log"
sed -n '/^MANIFEST_BEGIN$/,/^MANIFEST_END$/p' "$out/restore-verification.log" | sed '1d;$d' > "$out/manifest.json"
printf 'SAME_BUILD_ARTIFACTS=b2://%s/%s/\n' "$bucket" "$prefix" | tee "$out/artifacts.txt"
