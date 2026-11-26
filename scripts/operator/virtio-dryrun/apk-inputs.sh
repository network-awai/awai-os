# Shared apps-mode contract for the Job renderer and build script.
apk_refuse() {
  printf 'AWAI4094_REFUSES: %s\n' "$*" >&2
  exit 2
}

validate_apps_mode() {
  local entrypoint=$1 v
  local -a pins=(AWAI_HOME_APK_SHA256 AWAI_STORE_APK_SHA256
    AWAI_HOME_EXPECTED_SIGNER_SHA256 AWAI_STORE_EXPECTED_SIGNER_SHA256)
  apps_prebuilt=0
  for v in AWAI_APK_STAGE AWAI_HOME_APK AWAI_STORE_APK AWAI_APKSIGNER "${pins[@]}"; do
    [[ -n ${!v:-} ]] && apps_prebuilt=1
  done

  if [[ ${AWAI_WITHOUT_APPS:-} == 1 ]]; then
    (( !apps_prebuilt )) || apk_refuse "AWAI_WITHOUT_APPS=1 and the prebuilt APK values are mutually exclusive."
    [[ $RELEASE_TYPE != user ]] || apk_refuse "AWAI_WITHOUT_APPS=1 is refused for RELEASE_TYPE=user."
    return
  fi
  (( apps_prebuilt )) || apk_refuse "an explicit apps mode is required: AWAI_WITHOUT_APPS=1 or prebuilt Home and Store."

  if [[ $entrypoint == job || -n ${AWAI_APK_STAGE:-} ]]; then
    [[ ${AWAI_APK_STAGE:-} =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] ||
      apk_refuse "AWAI_APK_STAGE must be a stage ID of up to 63 lowercase letters, digits and hyphens, starting with a letter or digit."
    [[ -z ${AWAI_HOME_APK:-}${AWAI_STORE_APK:-}${AWAI_APKSIGNER:-} ]] ||
      apk_refuse "AWAI_APK_STAGE supplies both APKs and the worker installs apksigner. Clear the local APK and tool paths."
  else
    for v in AWAI_HOME_APK AWAI_STORE_APK AWAI_APKSIGNER; do
      [[ ${!v:-} == /* ]] || apk_refuse "local prebuilt apps require an absolute path in $v."
    done
  fi

  for v in "${pins[@]}"; do
    [[ ${!v:-} =~ ^[0-9a-f]{64}$ ]] || apk_refuse "$v must be a lowercase SHA-256 digest (64 hex characters)."
  done
}

fetch_staged_apk() (
  local object=$1 dest=$2
  local secret_dir=${AWAI_APK_STAGE_SECRET_DIR:-/run/secrets/awai-apk-stage}
  # Reuse the release-artifacts-b2 Secret's three-key shape with a
  # separate read-only credential. Load it only in this subshell.
  [[ -r $secret_dir/RCLONE_CONFIG_ART_TYPE && -r $secret_dir/RCLONE_CONFIG_ART_ACCOUNT &&
     -r $secret_dir/RCLONE_CONFIG_ART_KEY ]] || apk_refuse "APK stage Secret is unavailable."
  RCLONE_CONFIG_APKSTAGE_TYPE=$(<"$secret_dir/RCLONE_CONFIG_ART_TYPE")
  RCLONE_CONFIG_APKSTAGE_ACCOUNT=$(<"$secret_dir/RCLONE_CONFIG_ART_ACCOUNT")
  RCLONE_CONFIG_APKSTAGE_KEY=$(<"$secret_dir/RCLONE_CONFIG_ART_KEY")
  [[ $RCLONE_CONFIG_APKSTAGE_TYPE == b2 && -n $RCLONE_CONFIG_APKSTAGE_ACCOUNT &&
     -n $RCLONE_CONFIG_APKSTAGE_KEY ]] || apk_refuse "APK stage Secret is incomplete."
  export RCLONE_CONFIG_APKSTAGE_TYPE RCLONE_CONFIG_APKSTAGE_ACCOUNT RCLONE_CONFIG_APKSTAGE_KEY
  rclone --config /dev/null copyto \
    "apkstage:awai-os-release-artifacts/awai-virtio-g2-inputs/$AWAI_APK_STAGE/$object" "$dest" \
    >/dev/null 2>&1 || apk_refuse "could not fetch $object from the APK stage."
)

snapshot_local_apk() {
  local source=$1 dest=$2
  [[ -f $source && -r $source ]] && cp -- "$source" "$dest" 2>/dev/null ||
    apk_refuse "${dest##*/} is missing or unreadable."
}

verify_apk() {
  local apk=$1 expected_bytes=$2 expected_signer=$3 actual certs
  [[ -f $apk && -r $apk ]] || apk_refuse "${apk##*/} is missing or unreadable."
  actual=$(sha256sum < "$apk") || apk_refuse "could not hash ${apk##*/}."
  [[ ${actual%% *} == "$expected_bytes" ]] || apk_refuse "${apk##*/} file SHA-256 mismatch."
  certs=$("$AWAI_APKSIGNER" verify --print-certs "$apk" 2>/dev/null) ||
    apk_refuse "apksigner could not verify ${apk##*/}."
  actual=$(printf '%s\n' "$certs" | awk '/^Signer #[0-9]+ certificate SHA-256 digest: / { print $NF }')
  # The approved input has one signer. Additional or missing signers fail the comparison.
  [[ $actual == "$expected_signer" ]] || apk_refuse "${apk##*/} signer SHA-256 mismatch (expected one approved signer)."
  printf 'AWAI4094_APK_VERIFIED %s file=%s signer=%s\n' "${apk##*/}" "$expected_bytes" "$expected_signer"
}
