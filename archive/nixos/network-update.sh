# NixOS/platform administration, packaged with fixed tool paths by Nix.
# This is not the native Node runtime or a browser operation broker.
# jq variables are deliberately passed via --arg/--argjson, not shell expansion.
set -euo pipefail
export LC_ALL=C
umask 077
unset NIX_REMOTE NIX_CONFIG
state=/var/lib/murakumo-os-update
journal=$state/journal.json
contract=/etc/murakumo/os-update.json
die() { echo "murakumo-os-update: $*" >&2; exit 1; }
[[ $EUID == 0 ]] || die 'root operator authority is required'
[[ -f $contract ]] || die 'network updates are not configured'
esp=$(jq -er .esp "$contract")
boot_id=$(cat /proc/sys/kernel/random/boot_id)
uptime_seconds() { local n; read -r n _ </proc/uptime; echo "${n%.*}"; }
current() { readlink -e /run/current-system; }
valid_system() { [[ $1 =~ ^/nix/store/[0-9a-z]{32}-nixos-system-[a-zA-Z0-9._+-]+$ && -x $1/bin/switch-to-configuration && -r $1/boot.json ]]; }
valid_id() { [[ $1 =~ ^[0-9a-f-]{36}$ ]]; }
[[ ! -L $state ]] || die 'symlink state directory refused'
if [[ ! -d $state ]]; then mkdir -m 0700 "$state"; fi
[[ $(stat -c '%u:%a' "$state") == 0:700 ]] || die 'unsafe state directory ownership/mode'
[[ ! -L $state/lock ]] || die 'symlink lock refused'
exec 9>"$state/lock"
wait_seconds=5
[[ ${1:-} != _guard ]] || wait_seconds=0
[[ ${1:-} != _apply ]] || wait_seconds=10
if ! flock -w "$wait_seconds" 9; then
  [[ ${1:-} == _guard ]] && exit 0
  die 'another update operation is running'
fi
mkdir -p "$state/roots" "$state/receipts"
save_json() {
  local destination=$1 temporary
  [[ ! -L $destination ]] || die 'symlink journal/receipt refused'
  temporary=$(mktemp "$state/.write.XXXXXX")
  cat >"$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -T "$temporary" "$destination"
  sync -f "$(dirname "$destination")"
}
load_journal() {
  [[ -f $journal && ! -L $journal && $(stat -c %u "$journal") == 0 && $(stat -c %s "$journal") -le 16384 ]] || die 'missing/unsafe journal'
  jq -e '.schema == "murakumo.os-update.v1" and (.id|test("^[0-9a-f-]{36}$")) and (.old|test("^/nix/store/[0-9a-z]{32}-nixos-system-[a-zA-Z0-9._+-]+$")) and (.new|test("^/nix/store/[0-9a-z]{32}-nixos-system-[a-zA-Z0-9._+-]+$")) and (.phase|IN("preparing","armed","awaiting-confirmation","committing","rollback-requested","rolled-back","committed"))' "$journal" >/dev/null || die 'invalid journal; manual recovery required'
  id=$(jq -r .id "$journal"); old=$(jq -r .old "$journal"); new=$(jq -r .new "$journal"); phase=$(jq -r .phase "$journal")
}
change() { jq "$@" "$journal" | save_json "$journal"; load_journal; }
receipt() { cat "$journal" | save_json "$state/receipts/$id.json"; }
bootctl_safe() { bootctl --esp-path="$esp" "$@"; }
boot_environment() {
  [[ -d /sys/firmware/efi/efivars ]] || die 'UEFI variable access is required'
  mountpoint -q "$esp" || die 'ESP is not a mounted filesystem'
  [[ $(findmnt -n -o FSTYPE --target "$esp") == vfat ]] || die 'only a dedicated FAT ESP is qualified'
  bootctl_safe is-installed >/dev/null || die 'systemd-boot is not installed'
}
validate_bootspec() {
  local system=$1
  valid_system "$system" || die 'invalid or missing NixOS system path'
  jq -e --arg system "$system" '
    .["org.nixos.bootspec.v1"] as $b |
    $b.system == "x86_64-linux" and $b.toplevel == $system and
    $b.init == ($system + "/init") and ($b.initrdSecrets == null) and
    ($b.kernel|test("^/nix/store/[0-9a-z]{32}-[a-zA-Z0-9._+-]+/[a-zA-Z0-9._+-]+$")) and
    ($b.initrd|test("^/nix/store/[0-9a-z]{32}-[a-zA-Z0-9._+-]+/[a-zA-Z0-9._+-]+$")) and
    ($b.kernelParams|type == "array") and ($b.kernelParams|length < 128) and
    all($b.kernelParams[]; type == "string" and (explode|all(. >= 32 and . < 127)) and (startswith("init=")|not)) and
    ((.["org.nixos.extra-initrd.v1"] // {})|length == 0) and
    ((.["org.nixos.specialisation.v1"] // {})|length == 0) and
    ((.["org.nixos.systemd-boot"] // {})|keys|all(. == "sortKey")) and
    ((.["org.nixos.systemd-boot"].sortKey // "archive/nixos")|test("^[a-zA-Z0-9_.-]{1,64}$")) and
    (keys|all(. == "org.nixos.bootspec.v1" or . == "org.nixos.nixos-init.v1" or . == "org.nixos.specialisation.v1" or . == "org.nixos.systemd-boot" or . == "org.nixos.extra-initrd.v1"))
  ' "$system/boot.json" >/dev/null || die 'unsupported bootspec (secret/extra initrd, UKI or invalid paths)'
}
make_entry() {
  local system=$1 name=$2 kernel initrd params init directory temporary file source destination title
  validate_bootspec "$system"
  kernel=$(jq -r '.["org.nixos.bootspec.v1"].kernel' "$system/boot.json")
  initrd=$(jq -r '.["org.nixos.bootspec.v1"].initrd' "$system/boot.json")
  params=$(jq -r '.["org.nixos.bootspec.v1"].kernelParams|join(" ")' "$system/boot.json")
  init=$(jq -r '.["org.nixos.bootspec.v1"].init' "$system/boot.json")
  mkdir -p "$esp/EFI/murakumo" "$esp/loader/entries"
  for file in kernel initrd; do
    [[ $file == kernel ]] && source=$kernel || source=$initrd
    destination="$esp/EFI/murakumo/${source#/nix/store/}"
    directory=$(dirname "$destination"); mkdir -p "$directory"
    if [[ -e $destination ]]; then cmp -s -- "$source" "$destination" || die 'retained ESP artifact differs'; continue; fi
    temporary="$destination.tmp"
    cp -- "$source" "$temporary"; sync -f "$temporary"
    mv -T "$temporary" "$destination"; sync -f "$directory"
  done
  temporary="$esp/loader/entries/$name.tmp"
  if [[ $name == murakumo-good-* ]]; then title='Murakumo NixOS - retained'; else title='Murakumo NixOS - trial'; fi
  printf 'title %s\nversion %s\nlinux /EFI/murakumo/%s\ninitrd /EFI/murakumo/%s\noptions init=%s %s\n' "$title" "${system##*/}" "${kernel#/nix/store/}" "${initrd#/nix/store/}" "$init" "$params" >"$temporary"
  sync -f "$temporary"; mv -T "$temporary" "$esp/loader/entries/$name"; sync -f "$esp/loader/entries"
}
healthy() {
  local unit
  [[ $(current) == "$new" ]] || return 1
  while IFS= read -r unit; do systemctl is-active --quiet "$unit" || return 1; done < <(jq -r '.healthUnits[]' "$contract")
  curl --silent --fail --max-time 3 http://127.0.0.1:18780/ >/dev/null || return 1
  [[ -s /var/lib/murakumo-observe/observation.json ]] || return 1
  jq -e --argjson now "$(uptime_seconds)" '.linuxUptimeSeconds <= $now and ($now - .linuxUptimeSeconds) <= 30' /var/lib/murakumo-observe/observation.json >/dev/null || return 1
  [[ $(jq -r .runId /var/lib/murakumo-observe/observation.json) == "$(systemctl show --property=InvocationID --value murakumo-node-monitor.service)" ]]
}
rollback() {
  local reason=$1 running
  running=$(current)
  # shellcheck disable=SC2016
  change --arg reason "$reason" '.phase="rollback-requested" | .reason=$reason'
  boot_environment
  # Never destroy or rewrite the retained generation; make the previous
  # system the persistent default before requesting a clean reboot.
  if [[ -f $esp/loader/entries/murakumo-good-$id.conf ]]; then bootctl_safe set-default "murakumo-good-$id.conf"; fi
  bootctl_safe set-oneshot ''
  nix-env --profile /nix/var/nix/profiles/system --set "$old" >/dev/null
  sync
  if [[ $running == "$old" ]]; then
    change '.phase="rolled-back"'; receipt
  else
    systemctl reboot --no-block
  fi
}
case ${1:-} in
  status)
    [[ $# == 1 ]] || die 'status accepts no arguments'
    if [[ -e $journal ]]; then
      load_journal
      jq --arg running "$(current)" --argjson now "$(uptime_seconds)" --argjson minimum "$(jq .minimumHealthySeconds "$contract")" '. + {running:$running, canConfirm:(.phase == "awaiting-confirmation" and .healthySince != null and ($now - .healthySince) >= $minimum)}' "$journal"
    else jq -n --arg running "$(current)" '{schema:"murakumo.os-update.v1",phase:"idle",running:$running,canConfirm:false}'; fi
    ;;
  begin)
    [[ $# == 3 || ( $# == 4 && $4 == --retry-failed ) ]] || die 'begin SYSTEM_PATH EXPECTED_NAR_HASH [--retry-failed]'
    new=$2; expected=$3
    [[ $expected =~ ^sha256:[0-9a-z]{52}$ ]] || die 'expected SHA256 NAR hash is required'
    valid_system "$new" || die 'invalid NixOS system path'
    if [[ -e $journal ]]; then
      candidate=$new; load_journal
      [[ $phase == committed || $phase == rolled-back ]] || die 'an update is already pending'
      [[ $phase != rolled-back || $candidate != "$new" || ${4:-} == --retry-failed ]] || die 'failed candidate is blocked; reviewed retry requires --retry-failed'
      new=$candidate
    fi
    old=$(current)
    [[ $new != "$old" ]] || die 'candidate is already running'
    [[ $(readlink -e /nix/var/nix/profiles/system) == "$old" ]] || die 'running/profile mismatch; reconcile locally before updating'
    boot_environment
    bootctl_safe list --json=short | jq -e 'all(.[]; .isOneShot != true)' >/dev/null || die 'another one-shot boot is already pending'
    cmp -- "$contract" "$new/etc/murakumo/os-update.json" || die 'candidate host/update contract mismatch'
    validate_bootspec "$old"; validate_bootspec "$new"
    requisites=$(nix-store --query --requisites "$old" "$new") || die 'candidate or retained closure is incomplete'
    printf '%s\n' "$requisites" | sort -u | xargs -r nix-store --check-validity
    [[ $(nix-store --query --hash "$new") == "$expected" ]] || die 'candidate NAR hash mismatch'
    printf '%s\n' "$requisites" | sort -u | xargs -r nix-store --verify-path >/dev/null
    systemctl is-active --quiet murakumo-os-update-guard.timer || die 'recovery guard timer is inactive'
    available=$(df -PB1 "$state" | awk 'END {print $4}')
    [[ $available -gt 67108864 ]] || die 'insufficient OS state filesystem space; existing boot retained'
    required=16777216
    declare -A counted=()
    for system in "$old" "$new"; do
      for part in kernel initrd; do
        file=$(jq -r --arg part "$part" '.["org.nixos.bootspec.v1"][$part]' "$system/boot.json")
        if [[ -z ${counted[$file]+present} && ! -e $esp/EFI/murakumo/${file#/nix/store/} ]]; then required=$((required + $(stat -Lc %s "$file"))); fi
        counted[$file]=1
      done
    done
    available=$(df -PB1 "$esp" | awk 'END {print $4}')
    [[ $available -gt $required ]] || die 'insufficient ESP space; existing boot retained'
    id=$(cat /proc/sys/kernel/random/uuid)
    nix-store --realise "$old" --add-root "$state/roots/$id-old" --indirect >/dev/null
    nix-store --realise "$new" --add-root "$state/roots/$id-new" --indirect >/dev/null
    jq -n --arg id "$id" --arg old "$old" --arg new "$new" --arg hash "$expected" --arg boot "$boot_id" --argjson now "$(uptime_seconds)" '{schema:"murakumo.os-update.v1",id:$id,old:$old,new:$new,narHash:$hash,phase:"preparing",sourceBootId:$boot,startedUptime:$now,trialBootId:null,trialStarted:null,healthySince:null,reason:null}' | save_json "$journal"
    systemctl start --no-block murakumo-os-update-apply.service
    cat "$journal"
    ;;
  _apply)
    [[ $# == 1 ]] || die 'internal command accepts no arguments'
    load_journal; [[ $phase == preparing ]] || exit 0
    boot_environment
    make_entry "$old" "murakumo-good-$id.conf"
    bootctl_safe set-default "murakumo-good-$id.conf"
    make_entry "$new" "murakumo-trial-$id.conf"
    change '.phase="armed"'
    bootctl_safe set-oneshot "murakumo-trial-$id.conf"
    sync
    systemctl reboot --no-block
    ;;
  _guard)
    [[ $# == 1 ]] || die 'internal command accepts no arguments'
    [[ -e $journal ]] || exit 0
    load_journal
    [[ $phase != committed && $phase != rolled-back ]] || exit 0
    now=$(uptime_seconds)
    source_boot=$(jq -r .sourceBootId "$journal")
    if [[ $phase == rollback-requested ]]; then rollback "$(jq -r .reason "$journal")"; exit 0; fi
    if [[ $phase == committing ]]; then rollback interrupted-transition; exit 0; fi
    if [[ $boot_id == "$source_boot" ]]; then
      if (( now - $(jq .startedUptime "$journal") > 300 )); then rollback preparation-timeout; fi
      exit 0
    fi
    if [[ $(current) == "$old" ]]; then rollback retained-generation-booted; exit 0; fi
    [[ $(current) == "$new" ]] || die 'unexpected running system; retained fallback left in place'
    if [[ $phase == preparing ]]; then rollback interrupted-preparation; exit 0; fi
    trial_boot=$(jq -r .trialBootId "$journal")
    if [[ $trial_boot != null && $trial_boot != "$boot_id" ]]; then rollback unexpected-second-trial-boot; exit 0; fi
    if [[ $trial_boot == null ]]; then
      # shellcheck disable=SC2016
      change --arg boot "$boot_id" --argjson now "$now" '.phase="awaiting-confirmation" | .trialBootId=$boot | .trialStarted=$now'
    fi
    elapsed=$(( now - $(jq .trialStarted "$journal") ))
    if (( elapsed >= $(jq .confirmationSeconds "$contract") )); then rollback confirmation-timeout; exit 0; fi
    if healthy; then
      if [[ $(jq -r .healthySince "$journal") == null ]]; then
        # shellcheck disable=SC2016
        change --argjson now "$now" '.healthySince=$now'
      fi
    else
      change '.healthySince=null'
      if (( elapsed >= $(jq .startupGraceSeconds "$contract") )); then rollback local-health-failed; fi
    fi
    ;;
  confirm)
    [[ $# == 2 ]] || die 'confirm requires the exact trial ID'
    valid_id "$2" || die 'confirm requires the exact trial ID'
    load_journal
    [[ $2 == "$id" && $phase == awaiting-confirmation && $(jq -r .trialBootId "$journal") == "$boot_id" ]] || die 'stale or wrong trial confirmation'
    healthy || die 'local services are not healthy'
    now=$(uptime_seconds)
    [[ $(jq -r .healthySince "$journal") != null ]] || die 'no measured healthy interval'
    (( now - $(jq .healthySince "$journal") >= $(jq .minimumHealthySeconds "$contract") )) || die 'healthy interval is too short'
    (( now - $(jq .trialStarted "$journal") < $(jq .confirmationSeconds "$contract") )) || die 'confirmation deadline expired'
    boot_environment
    change '.phase="committing"'
    nix-env --profile /nix/var/nix/profiles/system --set "$new" >/dev/null
    # The exact trial that has actually booted becomes default. We do not run
    # a downloaded command or rewrite firmware/partitions during commit.
    bootctl_safe set-default "murakumo-trial-$id.conf"
    bootctl_safe set-oneshot ''
    sync
    change '.phase="committed" | .reason="operator-confirmed-over-ssh"'
    receipt
    cat "$journal"
    ;;
  rollback)
    [[ $# == 2 ]] || die 'rollback requires the exact trial ID'
    valid_id "$2" || die 'rollback requires the exact trial ID'
    load_journal
    [[ $2 == "$id" && $phase != committed && $phase != rolled-back ]] || die 'stale or completed rollback request'
    rollback operator-requested
    ;;
  *) die 'usage: murakumo-os-update status | begin SYSTEM NAR_HASH [--retry-failed] | confirm ID | rollback ID' ;;
esac
