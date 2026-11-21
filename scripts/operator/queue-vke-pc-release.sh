#!/usr/bin/env bash
set -euo pipefail
umask 077

here=$(cd "$(dirname "$0")" && pwd)
wrapper="$here/vke-release-pool.mjs"
namespace=awai-pc-release-build
build_job=awai-pc-release-build
restore_job=awai-pc-release-restore
image=ubuntu@sha256:9a04f13b3f80ef056361e30868593b1cfd2279fe19e4081cb93a90bf56819d6a
role=awai-release-source-transfer

if [[ ${1:-} != --worker ]]; then
    [[ $# = 3 ]] || { echo "Usage: queue-vke-pc-release.sh KUBECONFIG RELEASE_STATE NEW_ARCHIVE_DIR" >&2; exit 2; }
    config=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
    [[ -r $config ]]
    export KUBECONFIG="$config"
    state=$(cd "$2" && pwd)
    read -r AWAI_RELEASE_KIT < "$state/privacy-build-kit"
    export AWAI_RELEASE_KIT
    export AWAI_RELEASE_SSH="$state/ssh-build"
    [[ -x $AWAI_RELEASE_SSH && -d $AWAI_RELEASE_KIT ]]
    (cd "$AWAI_RELEASE_KIT" && shasum -a 256 -c inputs.sha256)
    mkdir -m 700 "$3"
    export AWAI_RELEASE_ARCHIVE=$(cd "$3" && pwd)
    # Check the source route before creating a billable pool.
    "$AWAI_RELEASE_SSH" 'test -d /root/build/src/.repo && test -x /root/build/bin/repo && test -d /root/build/firmware/src/.git'
    node "$wrapper" status "$KUBECONFIG"
    set +e
    node "$wrapper" run "$KUBECONFIG" -- bash "$here/queue-vke-pc-release.sh" --worker
    result=$?
    set -e
    if (( result != 0 )); then
        # Worker failure exports logs and removes only the Jobs it created.
        # An empty release cannot delete an active or ambiguous run.
        node "$wrapper" release-empty "$KUBECONFIG" || true
    fi
    exit "$result"
fi

: "${KUBECONFIG:?}" "${AWAI_VKE_NODE_POOL:?}" "${AWAI_RELEASE_ARCHIVE:?}" "${AWAI_RELEASE_KIT:?}" "${AWAI_RELEASE_SSH:?}"
[[ ${AWAI_VKE_NAMESPACE:-} = "$namespace" && $AWAI_VKE_NODE_POOL =~ ^awai-pc-release-[0-9a-f]{12}$ ]]
out=$AWAI_RELEASE_ARCHIVE
pool=$AWAI_VKE_NODE_POOL
ssh_build=$AWAI_RELEASE_SSH
k() { kubectl -n "$namespace" "$@"; }

cleanup() {
    local status=$?
    trap - EXIT
    set +e
    k delete serviceaccount "$role" --ignore-not-found --request-timeout=12s
    k delete role,rolebinding "$role" --ignore-not-found --request-timeout=12s
    if [[ -n ${remote_tools:-} ]]; then
        "$ssh_build" "rm -f -- '$remote_tools/kubectl' '$remote_tools/kubectl.sha256'; rmdir -- '$remote_tools'"
    fi
    for job in $build_job $restore_job; do
        k logs "job/$job" --request-timeout=25s 2>/dev/null > "$out/$job.log" || true
    done
    if (( status != 0 )); then
        local disposition=empty
        if [[ -n ${build_pod:-} ]]; then
            local phase
            phase=$(k get pod "$build_pod" --request-timeout=12s -o jsonpath='{.status.phase}')
            if [[ $phase = Failed ]]; then
                disposition=failed
            else
                disposition=$(k exec "$build_pod" --request-timeout=12s -- bash -c                     'if test -f /root/build/artifacts-ready; then echo retained; else echo empty; fi')
            fi
        fi
        if [[ $disposition = empty || $disposition = failed ]]; then
            k delete job "$build_job" "$restore_job" --ignore-not-found --wait=true --timeout=90s
        else
            echo "Build output is present or its state is unknown. The pool was retained for recovery." >&2
        fi
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 124' TERM INT

job() {
    local name=$1 cpu=$2 memory=$3 space=$4 deadline=$5 command
    command=$(cat)
    jq -n --arg name "$name" --arg ns "$namespace" --arg pool "$pool" --arg image "$image" \
        --arg command "$command" --arg cpu "$cpu" --arg memory "$memory" --arg space "$space" --argjson deadline "$deadline" '
      {apiVersion:"batch/v1",kind:"Job",metadata:{name:$name,namespace:$ns},spec:{
        backoffLimit:0,activeDeadlineSeconds:$deadline,template:{
         metadata:{annotations:{"cluster-autoscaler.kubernetes.io/safe-to-evict":"false"}},
         spec:{restartPolicy:"Never",automountServiceAccountToken:false,
          nodeSelector:{"vke.vultr.com/node-pool":$pool,"kubernetes.io/arch":"amd64"},
          tolerations:[{key:"awai.network/release-build",operator:"Equal",value:"release",effect:"NoSchedule"}],
          containers:[{name:"worker",image:$image,
           env:[{name:"DEBIAN_FRONTEND",value:"noninteractive"}],command:["bash","-euo","pipefail","-c",$command],
           resources:{requests:{cpu:$cpu,memory:$memory,"ephemeral-storage":$space}},
           volumeMounts:[{name:"workspace",mountPath:"/root/build"}]}],
          volumes:[{name:"workspace",emptyDir:{sizeLimit:"700Gi"}}]}}}}' | k create -f -
}

pod_for() {
    local name=$1 pod deadline=$((SECONDS + 300))
    while (( SECONDS < deadline )); do
        pod=$(k get pods -l "job-name=$name" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
        if [[ -n $pod ]]; then
            k wait pod/"$pod" --for=condition=Ready --timeout=5m >&2
            printf '%s\n' "$pod"
            return
        fi
        sleep 2
    done
    return 1
}

await_file() {
    local pod=$1 file=$2 deadline=$((SECONDS + $3)) phase
    while (( SECONDS < deadline )); do
        if k exec "$pod" --request-timeout=12s -- test -f "$file" >/dev/null 2>&1; then return; fi
        phase=$(k get pod "$pod" -o jsonpath='{.status.phase}')
        [[ $phase = Running || $phase = Pending ]] || return 1
        sleep 15
    done
    return 1
}

build_memory=64Gi
if [[ ${AWAI_VKE_RELEASE_PLAN:-} = vc2-16c-64gb ]]; then build_memory=52Gi; fi
job "$build_job" 14 "$build_memory" 520Gi 18700 <<'BUILD'
apt-get -qq update
apt-get -qq install -y bc bison build-essential ca-certificates ccache cmake curl flex g++-multilib gcc-multilib git git-lfs gperf imagemagick lib32readline-dev lib32z1-dev libclang-18-dev libegl1 libelf-dev libglvnd-dev liblapack-dev liblz4-tool libopenblas-dev libpam-pwquality libsdl1.2-dev libssl-dev libxml2 libxml2-utils lz4 lzop ninja-build pkg-config python-is-python3 python3-dev python3-jsonschema python3-mako python3-packaging python3-pip python3-ply python3-pycparser python3-yaml rsync schedtool squashfs-tools unzip xorriso xsltproc zip zstd
cd /root/build
mkdir kit
touch tools-ready
until test -f inputs-ready; do sleep 5; done
mkdir -p src/out-awai-3600-realtek/soong/.temp
git config --global user.email release-build@awai.network
git config --global user.name "Awai release build"
test "$(git -C firmware/src rev-parse HEAD)" = a2dcb924f0897368b0b4f305cbf9808cdda90ce0
bash kit/build-pc.sh /root/build/src /root/build/firmware/src install
(cd kit/product-user-radeon && sha256sum -c SHA256SUMS)
touch artifacts-ready
until test -f restore-verified; do sleep 5; done
BUILD
build_pod=$(pod_for "$build_job")
await_file "$build_pod" /root/build/tools-ready 360

COPYFILE_DISABLE=1 tar -C "$AWAI_RELEASE_KIT" -cf - inputs.sha256 android-release-input.tar.gz \
    expected-android-manifest.xml overlay-revisions.txt prior-overlay-revisions.txt \
    check-manifest.py build-pc.sh assemble-verified.sh previous-welcome.patch |
    k exec -i "$build_pod" -- tar -xf - -C /root/build/kit
k exec "$build_pod" -- bash -ceu 'cd /root/build/kit; sha256sum -c inputs.sha256'

remote_directory=$("$ssh_build" 'umask 077; mktemp -d /root/awai-vke-queue.XXXXXX')
[[ $remote_directory =~ ^/root/awai-vke-queue\.[[:alnum:]]+$ ]]
remote_tools=$remote_directory
"$ssh_build" "set -e; cd '$remote_tools'; curl -fsSLO https://dl.k8s.io/release/v1.35.0/bin/linux/amd64/kubectl; curl -fsSLO https://dl.k8s.io/release/v1.35.0/bin/linux/amd64/kubectl.sha256; printf '%s  kubectl\\n' \"\$(cat kubectl.sha256)\" | sha256sum -c; chmod 700 kubectl"
k create serviceaccount "$role"
jq -n --arg n "$namespace" --arg r "$role" --arg p "$build_pod" '
 {apiVersion:"rbac.authorization.k8s.io/v1",kind:"Role",metadata:{namespace:$n,name:$r},
  rules:[{apiGroups:[""],resources:["pods"],resourceNames:[$p],verbs:["get"]},
  {apiGroups:[""],resources:["pods/exec"],resourceNames:[$p],verbs:["get","create"]}]}' | k create -f -
k create rolebinding "$role" --role "$role" --serviceaccount="$namespace:$role"
server=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
ca=$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
[[ $server =~ ^https://[a-f0-9-]{36}\.vultr-k8s\.com:6443$ && -n $ca ]]
remote_copy='set -eo pipefail
  umask 077
  config=$(mktemp /dev/shm/awai-vke.XXXXXX)
  trap "rm -f \"$config\"" EXIT
  cat > "$config"
  cd /root/build
  nice -n 15 ionice -c 2 -n 7 tar --anchored --exclude="src/out" --exclude="src/out-*" --exclude="src/.awai-3600-product-build.lock" -cf - src firmware/src bin/repo |
    nice -n 15 zstd -q -T2 -1 -c |
    "$1/kubectl" --kubeconfig "$config" exec -i "$2" -- bash -o pipefail -c "cd /root/build && zstd -dc | tar -xf -"'
k create token "$role" --duration=90m |
    jq -Rc --arg ca "$ca" --arg endpoint "$server" --arg ns "$namespace" '
    {apiVersion:"v1",kind:"Config",clusters:[{name:"vke",cluster:{server:$endpoint,"certificate-authority-data":$ca}}],
     users:[{name:"transfer",user:{token:.}}],
     contexts:[{name:"release",context:{cluster:"vke",user:"transfer",namespace:$ns}}],"current-context":"release"}' |
    "$ssh_build" "$(printf 'bash -c %q bash %q %q' "$remote_copy" "$remote_tools" "$build_pod")"
k delete rolebinding,role,serviceaccount "$role"
k exec "$build_pod" -- bash -ceu 'cd /root/build; test -s src/external/flashrom/util/flashrom_tester/src/out/built.rs; touch inputs-ready'
printf 'BUILD_INPUTS_READY=%s\n' "$(date -u +%FT%TZ)"
await_file "$build_pod" /root/build/artifacts-ready 16800

k exec "$build_pod" -- bash -eo pipefail -c '
  cd /root/build/kit/product-user-radeon
  tar --sparse -cf - prepared-target-files.zip disk-vda.img otatools.tar android-manifest.xml vendor-firmware.sha256 SHA256SUMS source-revisions.txt build-properties build.log | zstd -q -T3 -1 -c' > "$out/artifacts.tar.zst.part"
zstd -tq "$out/artifacts.tar.zst.part"
mv "$out/artifacts.tar.zst.part" "$out/artifacts.tar.zst"
(cd "$out" && shasum -a 256 artifacts.tar.zst > archive.sha256)
job "$restore_job" 500m 1Gi 45Gi 2700 <<'RESTORE'
apt-get -qq update
apt-get -qq install -y --no-install-recommends zstd unzip
cd /root/build
touch tools-ready
until test -f download-ready; do sleep 5; done
sha256sum -c archive.sha256
zstd -dc artifacts.tar.zst | tar -xf -
sha256sum -c SHA256SUMS
unzip -tq prepared-target-files.zip
tar -tf otatools.tar >/dev/null
printf 'RESTORE_VERIFIED=%s\n' "$(date -u +%FT%TZ)"
RESTORE
restore_pod=$(pod_for "$restore_job")
await_file "$restore_pod" /root/build/tools-ready 360
for file in archive.sha256 artifacts.tar.zst; do
    k exec -i "$restore_pod" -- bash -ceu 'cat > "/root/build/$1"' bash "$file" < "$out/$file"
done
k exec "$restore_pod" -- touch /root/build/download-ready
k wait job/"$restore_job" --for=condition=Complete --timeout=15m
k logs job/"$restore_job" | tee "$out/restore-verification.log"
grep -F 'RESTORE_VERIFIED=' "$out/restore-verification.log"
k exec "$build_pod" -- touch /root/build/restore-verified
k wait job/"$build_job" --for=condition=Complete --timeout=2m
