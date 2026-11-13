# Desktop HTTPS updates — AWAI-183 / AWAI-164

Desktop imports the update modules disabled by default. Explicit operator
enrollment supplies the deployed monotonic baseVersion, manifest publicKey,
cacheKey and HTTPS feedUrl under `otehon.update`; set enable=true and
network.enable=true. No implicit keys, remote root/SSH or live preview cutover.
The Nix/Python/systemd updater is OS administration, separate from Native and
the browser app. It adds no app-origin API.

Network options: channel=stable, cohort=stable, interval=30min,
maintenanceHours=[3 4], automaticReboot=false. Timer starts5min after boot plus
up to2min jitter. These are configurable admission defaults, not new availability
or performance thresholds. automaticReboot=true is explicit standing owner
authorization limited to the enrolled feed/keys/channel/cohort/state contract.
Otherwise a verified trial is staged and the operator controls reboot.
Hours use the enrolled machine's local timezone (`time.timeZone`), not the
publisher's timezone. Changing it changes the maintenance window.

Example enrollment (replace all placeholders; this example activates nothing):

```nix
otehon.update = {
  enable = true;
  baseVersion = 1; # Must be the deployed release's actual monotonic version.
  publicKey = /operator-managed/release-manifest.pub;
  cacheKey = /operator-managed/release-cache.pub;
  network = {
    enable = true;
    feedUrl = "https://updates.example.invalid/otehon/stable";
    channel = "stable";
    cohort = "canary";
    interval = "30min";
    maintenanceHours = [ 3 4 ];
    automaticReboot = false;
  };
};
```

HTTPS uses the enrolled CA and refuses redirects/ambient proxies. Signature,
version/failed-version, exact schema, expiry, architecture, channel, cohort and
stateContract are checked before any closure download. Excluded cohorts/windows
hold. Every NarInfo URL/reference is bounded, confined to the same feed/cache.
All cache metadata signatures are verified before NAR downloads; Nix verifies
closure signatures/hash from the staged local cache at apply. Existing valid
paths are reused. Space/byte/path/time limits fail closed before boot changes.

Existing trial/boot-health/confirm/rollback is reused with apply/settle serialized.
The desktop now serves immutable static artifacts at stable loopback origin
http://127.0.0.1:8780. Versioned file:// Nix-store URLs do not provide a stable
browser storage origin. Chromium profile and user files stay on persistent
storage. Network admission pins exact Chromium version/otehon-origin-v2; new
browser or app-state schemas require separately qualified migration. OS rollback
never promises to roll back /home or /var data.

**Existing0.6file-origin state is not automatically migrated.** Keep the live
session overlay and Chromium profile intact; an owner-approved initial export/
import and legacy-origin migration gate must precede enrollment/cutover. The
new stable-origin VM test is not evidence that legacy user state has migrated.

`scripts/publish-otehon-release.sh` creates a new local static cache + manifest
using explicit signing-key paths. It never generates keys, uploads or remotely
activates a fleet. Sign cohorts=[canary] first; after independent verification,
explicitly sign a new manifest adding stable. Unsigned/self-reported canary
success grants no promotion authority. Production publishing/keys/rotation and
live jacob/levi acceptance remain distinct gates; fixtures never qualify them.

`nix-build nixos/tests/otehon-network-update.nix --no-out-link` is the disposable
HTTPS publisher + real headless desktop/Chromium update gate. It changes actual
UI-package versions and checks timer/cohort hold/promotion, good trial/confirm,
extra reboot and failed-health rollback, localStorage/IndexedDB/user-file and
machine-id continuity. Inference/media kernels are excluded, not substituted.
Source/evaluation/build/boot/runtime results must be reported separately; only
an observed passing run qualifies this test, not its source presence.
