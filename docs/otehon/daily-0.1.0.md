# Awai Otehon daily features 0.1.0

Everyday settings and screens for the desktop (`network-awai/network-awai-apex` ADR 0026,
AWAI-168): the time zone, Japanese text for the shell, a Settei screen, an accessibility pass,
and a separate web browser window. Japanese input is a separate profile. It builds on
[protection-0.1.0.md](protection-0.1.0.md) and raises the desktop image version to 0.8.0.

**No VM check in this document has been run.** The shared lock (`vm-lock.sh`) refused to build or
boot anything: the Mac had 13 GiB free and the lock needs 30 GiB. What was observed is listed under
Evidence: unit tests, a Nix build of the helper with its tests, and the built shell in headless
Chrome on macOS. Everything that needs the OS image is under Not verified.

| Part | What it does | File |
| --- | --- | --- |
| Time zone | `time.timeZone` is null, so `systemd-timedated` may write `/etc/localtime` on the root file system. UTC until someone picks a zone | `nixos/otehon/settei/settei.nix` |
| Settei helper | A loopback service on `127.0.0.1:8774`, run as its own system user `otehon-settei`. It reads and sets the time zone, and does nothing else | `nixos/otehon/settei/settei_helper.py` |
| polkit rule | Lets `otehon-settei` call `org.freedesktop.timedate1.set-timezone` without asking. No other action, no other user | `nixos/otehon/settei/settei.nix` |
| Settei screen | The Settei dapp opens a screen with language, time zone, and honest notes for Wi-Fi, display, sound and Bluetooth | `nixos/otehon/shell/src/settei.jsx` |
| Japanese | Every shell screen has English and Japanese text, chosen in setup or in Settei and kept across reloads | `nixos/otehon/shell/src/i18n.js` |
| Accessibility | Every landmark, form, button and field has a name, and every screen has one `main` | `src/main.jsx`, `src/setup.jsx`, `src/manimani.jsx`, `src/lock.jsx` |
| Web browser | The Browser dapp opens an ordinary Chromium window with an address bar, in its own profile | `nixos/otehon/settei/web_launcher.py`, `nixos/otehon/desktop.nix` |
| Japanese input | fcitx5 with Mozc, in the `desktop-ime` profile only | `nixos/otehon/desktop-ime.nix` |

## The Settei helper

The shell is a `file://` page and cannot call D-Bus, so one small service does the privileged step.
It is narrow on purpose:

- **One action.** `GET /v1/timezone` returns the zone and the list. `POST /v1/timezone` with
  `{"zone": "..."}` sets it. Any other path is 404.
- **Only zones from the system list.** The zone must match a plain name pattern and be in the list
  `timedatectl list-timezones` prints. `timedatectl set-timezone` gets that one argument, with no
  shell. Then the helper reads the zone back and reports `not-applied` if it did not change.
- **Only the desktop user.** Loopback is open to every process, so the helper looks the client's
  socket up in `/proc/net/tcp` and accepts only the uid of `otehon`, which Chromium runs as. Another
  user, root, or an unclear connection gets `403 not-desktop-user`.
- **Only the shell page.** The Host must be `127.0.0.1:8774` (no DNS rebinding) and the Origin must
  be `null` (the `file://` shell) or absent. A web page's Origin gets `403 bad-origin`.
- **No other privilege.** The helper's user has no capabilities, no home and no network beyond
  loopback (`IPAddressDeny=any`, `CapabilityBoundingSet=`, `ProtectSystem=strict`). It changes the
  zone only because polkit lets that one user do that one action.
- **Audited.** Every change and every refusal is one `OTEHON_SETTEI_AUDIT` line in the journal, with
  the uid, the zone before and after, and the result.

The zone is a system setting, so `/etc/localtime` is on the plain root partition, not on the
encrypted volume. It says where the device is set to be, which a person with the disk can read.

Wi-Fi is not in the helper. The VM has no network adapter, so NetworkManager could not be tested,
and the task allowed it only if testable.

## The web browser

The Browser dapp shows a button that asks a launcher in the desktop session to open a normal
Chromium window. The launcher (`127.0.0.1:8775`) runs as the desktop user, with the same Host,
Origin and uid rules as the helper, and holds no privilege.

- The request carries no address. The shell cannot choose a page; the person types it in the
  address bar.
- The window uses `/var/lib/otehon/users/otehon/web`, a profile apart from the shell's, on the
  encrypted volume. It has no DevTools port and none of the shell's browser arguments (such as the
  check image's `--ignore-certificate-errors`).
- It is not the shell's consent broker. Pages it loads are ordinary web browsing, outside the Kotoba
  operation consent rules, which is why it is a separate profile and a separate window.
- Kotoba Browser, which renders documents inside the shell through the consent broker, is not in
  this image. The screen says so.

## Japanese input

`desktop-ime.nix` adds fcitx5 with Mozc (`fcitx5-mozc-2.30.5544.102`, available for aarch64-linux
in the pinned nixpkgs), starts `fcitx5 -d` in the session, and gives both Chromium windows
`--enable-wayland-ime --wayland-text-input-version=3`. It evaluates. It was not built or booted.

**Whether it works is unknown.** It needs cosmic-comp to offer the Wayland input-method protocol to
fcitx5 and text-input v3 to Chromium. That has not been observed, so it stays out of the `desktop`
profile. A check would need real key events through the compositor (QEMU `sendkey` on the USB
keyboard, not DevTools input, which skips the input method), then read the composed text from the
page. That check is not written.

## Check

### On a workstation

The helper's rules, with a stand-in `timedatectl` and written `/proc/net/tcp` tables. On Linux it
also checks a real connection against the real table:

```bash
cd nixos/otehon/settei && python3 -I test_settei.py
```

Building `otehon.settei.source` runs the same tests, so an image does not build if they fail.

The shell, in headless Chrome, with stand-ins for the helper and the launcher on the same ports:

```bash
cd nixos/otehon/shell && npm test && node build.mjs
node test/daily-browser-check.mjs <empty-scratch-directory>
```

Exit codes: `0` every step passed and the audit found nothing, `1` a step failed or the audit found
something, `3` no scratch directory or Chrome did not start. The check:

1. Goes through setup in Japanese and audits the accessibility tree of each step.
2. Visits home, a dapp, a dapp locked by trust, Account, Manimani, Settei, Web and the lock screen.
   On each it audits the tree and looks for English: any English phrase from the shell's text,
   any dapp summary, and any two English words in a row that are not a name.
3. Reloads and checks the language stayed Japanese.
4. Sets Asia/Tokyo in Settei, sees the stand-in receive it and the screen show it, and sees a
   refusal shown when the stand-in refuses Europe/Berlin.
5. Opens the web window through the stand-in.
6. Switches to English and requires the same scan to find at least 10 English phrases, so a scan
   that finds nothing is caught.

The audit (`test/a11y.mjs`) reads Chrome's accessibility tree, which is what a screen reader is
given. It requires a non-empty name on every button, link, field, list box, image, landmark and
form, exactly one `main`, a heading, a `lang`, and different names for two landmarks of one role.
It does not judge whether a name is good, and it is not a screen reader.

`BASELINE=1` runs only the audit, on screens an older shell also has.

### In a VM

Build the `desktop-daily` profile as in [vm-0.1.0.md](vm-0.1.0.md), with
`--argstr profile desktop-daily`, unpack it with `zstd -d --sparse`, make a key disk as in
[protection-0.1.0.md](protection-0.1.0.md), and run on a clone:

```bash
cp -c otehon-desktop-daily.raw check.raw
nixos/otehon/desktop-daily-check-qemu.sh check.raw keys.tar serial.log web.ppm
```

Exit codes: `0` both boots passed and a screenshot was saved, `1` a step failed or no result, `3`
the check could not run.

First boot, in the real shell through the real helper, polkit and timedated:

| Step | Passes when |
| --- | --- |
| `signin` | Setup in Japanese, with a random test wallet |
| `zone_starts_utc` | `timedatectl` says UTC |
| `settei_sets_zone` | The Settei screen sets Asia/Tokyo; `timedatectl` and `readlink /etc/localtime` agree; the journal has the `result="ok"` audit line |
| `invalid_zone_refused` | From the page (Chromium as `otehon`): `Mars/Olympus`, `../../etc/passwd` and `Asia/Tokyo;reboot` each get `400 unknown-zone`, and the zone stays |
| `other_user_refused` | A valid zone posted with curl as `nobody` and as `root` gets `403 not-desktop-user`, and the zone stays. The page's success above is the positive case |
| `helper_user_is_narrow` | As `otehon-settei`, `timedatectl set-ntp false` and `hostnamectl set-hostname` both fail |
| `web_window` | A Chromium process with the `web` profile runs, without `remote-debugging`, and the shell's DevTools lists no web page. The script takes a screenshot for a person to see the address bar |

Second boot: the shell starts locked and opens with the test wallet; `timedatectl` and the browser's
own zone (`Intl`) both say Asia/Tokyo; the language is still Japanese; Settei shows Asia/Tokyo.

Negative control: the `desktop-daily-fixed` profile sets `time.timeZone = "UTC"`. NixOS then points
timedated at `/etc/static/localtime`, in the read-only store, so `settei_sets_zone` must fail and the
script must exit 1.

## Evidence (2026-11-07, Apple M1 Max)

The output is in [otehon-daily-20261107.txt](../evidence/otehon-daily-20261107.txt).

| Check | Result |
| --- | --- |
| Profiles `desktop`, `desktop-ime`, `desktop-daily`, `desktop-daily-fixed`, `desktop-protect` | Evaluate (`nix-instantiate`). Not built |
| `base` derivation | `688hg7qw9b8xphj8qhmwfh2lg8509y7a`, unchanged |
| Helper source derivation, aarch64-linux in the Nix container | Built; its 17 tests pass, including a real loopback connection found in the real `/proc/net/tcp` with the right uid |
| Helper tests on macOS | 17 run, OK, 1 skipped (the Linux table test) |
| Negative control: peer uid check disabled | 3 fail: unknown connection and another user, for both services |
| Negative control: zone list check disabled | 1 fails: a zone not in the list |
| Shell unit tests (`npm test`) | 29 pass. The 6 new ones: same keys in both languages, placeholders match, every key a screen uses exists, every dapp summary and service has Japanese |
| Negative control: one Japanese key removed | 2 fail: same keys, placeholders |
| Accessibility audit of the shell at `29ac3f1`, `main.js` `86f824c8…664a5` | 11 findings on 13 screens: no `main` on the 7 setup steps, an unnamed form on home, both dapp screens and Manimani. Exit 1 |
| Daily browser check, Chrome 156.0.8078.80 headless, `main.js` `6643e490…99373` | 15 screens audited, 0 findings; no English on the 8 Japanese shell screens; language kept after reload; time zone set and refusal shown; web window asked for; the English control found 21 to 30 phrases per screen. Exit 0 |
| Negative control: a hard-coded English sentence in Settei | `ENGLISH settei hits=1 ["Not available here"]`, exit 1 |
| Regression: `lock-browser-check.mjs` on this shell | 12 steps pass |
| VM checks | Not run. `vm-lock.sh` printed `NOT_RUN only 13433924KiB free, need 30GiB`, exit 3 |

The browser checks ran on macOS against the files in `dist/`, with stand-ins for the helper and the
launcher. They show the shell's behaviour. They show nothing about the helper in the image, polkit,
timedated, the session or the second browser window.

## Not verified or not implemented

- **Every VM check above.** No image was built or booted. So none of these is observed: the zone
  changing through polkit and timedated, the zone surviving a reboot, the audit line in the journal,
  the refusals inside the image, the helper user being refused other actions, the session starting
  the launcher, the web window opening on cosmic-comp, and the fixed-zone negative control.
- **Whether Chromium follows a new zone without a restart.** The first VM boot only reports it; the
  second boot requires it after the restart.
- **Japanese input.** Not built, not booted, and no check written. See above. This is why the task
  status is partial.
- **A screen reader was not run.** The audit reads the accessibility tree. No one listened to the
  shell with Orca or another screen reader, and the image has none. Keyboard-only use, focus order,
  contrast and zoom were not checked.
- **The consent dialog is English only.** It comes from the pinned shared runtime
  (`vendor/kotoba-client-runtime.js`), which this task does not change. The English scan skips it
  and says so. The setup steps' text was already in both languages and was not scanned for English,
  only audited.
- **Message text and service output** (Manimani answers, media errors, refusal reasons such as
  `wrong-signer`) are shown as they come, in English.
- **Wi-Fi, Bluetooth, sound and display settings.** Not implemented; Settei says so.
- **Web browsing over a network.** The check images have no network adapter, so no page was loaded.
  Whether the web window can be closed or switched away from on cosmic-comp, with no panel, is
  unknown.
- **The DevTools port** is still open to every local process (protection-0.1.0.md). Anything that can
  reach it can drive the shell page, and so can ask the helper for a zone change as the desktop user.
- **The time zone is readable on the plain root partition.**
- The shell package was not built with Nix (`buildNpmPackage`); the npm dependencies did not change,
  so `npmDepsHash` should still hold, but that was not observed.
