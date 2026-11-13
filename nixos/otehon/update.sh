# Awai Otehon updates. A signed manifest names a newer system. Its closure comes from a
# signed binary cache. The new generation boots with limited tries, and only a healthy boot
# makes it permanent. If it does not, systemd-boot falls back to the previous generation.
set -euo pipefail
[ -z "${OTEHON_UPDATE_TRACE:-}" ] || set -x

state=/var/lib/otehon-update
pending=$state/pending.json
profile=/nix/var/nix/profiles/system
entries=/boot/loader/entries

log() { echo "otehon-update: $*"; }
refuse() { log "REFUSED $1"; exit 2; }

installed_version() { cat "$state/version" 2>/dev/null || echo "$OTEHON_UPDATE_BASE_VERSION"; }
is_blocked() { grep -qx "$1" "$state/blocked" 2>/dev/null; }

generation_of() {
  local link
  for link in "$profile"-*-link; do
    if [ "$(readlink -f "$link")" = "$1" ]; then
      basename "$link" | sed -E 's/^system-([0-9]+)-link$/\1/'
      return 0
    fi
  done
  return 1
}

# The first system in an image has no generation or boot entry of its own. Without a default
# line, systemd-boot takes the newest entry that still has tries.
prepare() {
  local current
  current=$(readlink -f /run/current-system)
  generation_of "$current" >/dev/null || nix-env -p "$profile" --set "$current" >/dev/null
}

no_default() {
  sed -i '/^default /d' /boot/loader/loader.conf
  rm -f /boot/EFI/Linux/*.efi
}

check() {
  local feed=$1 manifest version system
  manifest=$(mktemp -d)
  trap 'rm -rf "$manifest"' RETURN
  cp "$feed/manifest.json" "$manifest/manifest.json" 2>/dev/null || refuse no-manifest
  cp "$feed/manifest.json.minisig" "$manifest/manifest.json.minisig" 2>/dev/null || refuse no-signature
  minisign -q -V -p "$OTEHON_UPDATE_PUBLIC_KEY" -m "$manifest/manifest.json" >/dev/null 2>&1 || refuse bad-signature
  version=$(jq -er '.version | select(type == "number" and . == floor)' "$manifest/manifest.json") || refuse bad-manifest
  system=$(jq -er '.system | select(test("^/nix/store/[0-9a-z]{32}-[A-Za-z0-9._+-]+$"))' "$manifest/manifest.json") || refuse bad-manifest
  [ "$version" -gt "$(installed_version)" ] || refuse "old-version $version"
  ! is_blocked "$version" || refuse "blocked-version $version"
  [ ! -e "$pending" ] || refuse trial-in-progress
  [ "$system" != "$(readlink -f /run/current-system)" ] || refuse unchanged-system
  echo "$version $system"
}

apply() {
  local feed=$1 checked version system generation
  checked=$(check "$feed") || { echo "$checked"; exit 2; }
  version=${checked%% *}
  system=${checked#* }
  prepare

  # Nix refuses any path that the pinned cache key has not signed.
  nix copy --from "file://$feed/cache" \
    --option require-sigs true \
    --option trusted-public-keys "$(cat "$OTEHON_UPDATE_CACHE_KEY")" \
    --option substituters "" \
    --extra-experimental-features nix-command \
    "$system" || refuse bad-closure

  jq -n --argjson version "$version" --arg system "$system" '{version: $version, system: $system}' > "$pending.tmp"
  mv "$pending.tmp" "$pending"
  nix-env -p "$profile" --set "$system" >/dev/null
  "$system/bin/switch-to-configuration" boot
  generation=$(generation_of "$system")
  no_default
  # One try: a boot that does not confirm itself is not chosen again.
  mv "$entries/nixos-generation-$generation.conf" "$entries/nixos-generation-$generation+1.conf"
  sync
  log "STAGED version=$version generation=$generation"
}

# Runs after otehon-update-health on each boot. The health unit decides whether systemd marks
# the boot entry good. This settles the trial as confirmed, failed, or rolled back.
settle() {
  [ -e "$pending" ] || { log "SETTLED none version=$(installed_version)"; return 0; }
  local version system current generation
  version=$(jq -r .version "$pending")
  system=$(jq -r .system "$pending")
  current=$(readlink -f /run/current-system)

  if [ "$current" != "$system" ]; then
    # systemd-boot passed over the trial, so this is the previous generation.
    generation=$(generation_of "$system" || true)
    if [ -n "$generation" ]; then
      nix-env -p "$profile" --switch-generation "$(generation_of "$current")" >/dev/null
      nix-env -p "$profile" --delete-generations "$generation" >/dev/null
      rm -f "$entries/nixos-generation-$generation"+*.conf "$entries/nixos-generation-$generation.conf"
    fi
    echo "$version" >> "$state/blocked"
    rm -f "$pending"
    sync
    log "ROLLED_BACK version=$version installed=$(installed_version)"
    return 0
  fi

  generation=$(generation_of "$system")
  if ! systemctl is-active --quiet otehon-update-health.service; then
    log "TRIAL_FAILED version=$version"
    systemctl --failed --no-legend --plain | cut -d' ' -f1 | sed 's/^/otehon-update: failed unit /'
    sync
    systemctl reboot --no-block
    return 0
  fi
  # systemd-bless-boot removes the counter after a healthy boot. Wait for it, so that a boot
  # counted as tried is never recorded as installed.
  for _ in $(seq 1 60); do
    [ -e "$entries/nixos-generation-$generation.conf" ] && break
    sleep 1
  done
  if [ ! -e "$entries/nixos-generation-$generation.conf" ]; then
    log "TRIAL_FAILED version=$version reason=not-blessed"
    systemctl reboot --no-block
    return 0
  fi
  echo "$version" > "$state/version"
  rm -f "$pending"
  sync
  log "CONFIRMED version=$version generation=$generation"
}

# A failure here keeps boot-complete.target from being reached, so the entry stays unblessed.
health() {
  local units
  units=$(systemctl --failed --no-legend --plain | cut -d' ' -f1 | grep -v '^otehon-update-' || true)
  [ -z "$units" ] || { log "UNHEALTHY $units"; exit 1; }
}

case "${1:-}" in
  check) check "$2" ;;
  apply) exec 9>"$state/operation.lock"; flock -n 9 || refuse concurrent-update; apply "$2" ;;
  settle) exec 9>"$state/operation.lock"; flock -n 9 || refuse concurrent-update; settle ;;
  health) health ;;
  version) installed_version ;;
  *) echo "usage: otehon-update check|apply <feed> | settle | health | version" >&2; exit 64 ;;
esac
