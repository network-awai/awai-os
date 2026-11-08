# Awai Otehon data protection 0.1.0

Keeps the desktop user's data off the plain disk and adds a screen lock
(`network-awai/network-awai-apex` ADR 0026, AWAI-165). It builds on the encrypted state volume
from [base-0.4.0.md](base-0.4.0.md).

**The VM checks in this document have not been run.** The shared lock
(`vm-lock.sh`) refused to build or boot anything because the Mac had 14 GiB free and needs 30 GiB.
What was observed is listed under Evidence. Everything that needs a booted image is under
Not verified.

| Part | What it does | File |
| --- | --- | --- |
| Shared state volume | The LUKS volume at `/var/lib/otehon`, now one module that both the base check image and the desktop import | `nixos/otehon/state.nix` |
| Browser profile | Chromium's profile, cache and XDG config, cache and data directories are in `/var/lib/otehon/users/otehon` | `nixos/otehon/desktop.nix` |
| Service data | `/var/lib/private`, where the media service and Manimani keep their state, is a directory of the volume | `nixos/otehon/desktop.nix` |
| System logs | `/var/log/journal` is a directory of the volume. Before it opens, the journal stays in memory | `nixos/otehon/desktop.nix` |
| Temporary files | `/tmp` is in memory, and core dumps are not stored | `nixos/otehon/desktop.nix` |
| Fail closed | greetd, the journal flush, the media service and Manimani require the volume. With no volume there is no desktop, rather than a desktop that writes to the root partition | `otehon.state.requiredBy` |
| Screen lock | Idle lock, a Lock button, and an unlock that needs a signature from the signed-in wallet | `nixos/otehon/shell/src/lock.jsx`, `src/identity/lock.js` |

The base image is unchanged by the move: its system and image derivations are the same before
and after (Evidence), so the results in base-0.4.0.md still apply to it.

## The screen lock

- **Idle lock.** No pointer, key, wheel or touch input for `otehon.idleLockSeconds` (300 by
  default) locks the shell. The sidebar has a Lock button.
- **A new browser starts locked.** A reboot, or Chromium starting again, shows the lock screen if
  someone is signed in. A reload of the same page does not, because the mark that says "unlocked"
  is in `sessionStorage`.
- **While locked, nothing of the user is rendered.** The shell unmounts: no app list, thread,
  account panel or Manimani. Only the account ID and the message to sign are shown.
- **The lock holds over the session.** The lock record is kept apart from the sign-in session.
  An expired, edited or removed session does not skip it.
- **Unlock.** The screen shows a message with its own wording, the device, a new random nonce and
  the time. The person signs it with `personal_sign`, and the shell recovers the signer and
  compares it with the locked account. A signature from another key, for another lock (another
  nonce), or of a sign-in message is refused. With an EIP-1193 wallet in the browser, one button
  does it. There is no network request.
- **Accounts with a passkey cannot unlock yet.** The device has no authenticator for that
  account. The lock screen says so, and the only way on is to erase.
- **Erase.** The lock screen can erase this device's messages, proofs, sign-in and lock, and go
  back to sign-in. It needs two clicks.

### What a browser-level lock protects against, and what it does not

It stops a person at the screen who has only the keyboard, mouse and display of an unlocked,
running machine from seeing or using the apps without the wallet. That is all.

It does not stop:

- **Anyone with root.** Root can read the profile files on the open volume, kill the browser,
  or change the lock record. The lock has no key of its own and encrypts nothing.
- **Anyone who can reach the DevTools port** (`127.0.0.1:9222`). Any process on the machine can
  connect and run script in the page, which unlocks it. The boot report and the check driver
  use that port, so it is open to every local process today, including the media service and
  Manimani.
- **A running machine taken away.** While the machine runs, the volume is open, so its data is
  readable to anyone who gets root on it.
- **A powered-off machine with its key disk.** The key disk is a stand-in that opens the volume
  with no person present (base-0.4.0.md). Whoever has the disk and the key disk has the data.
  The lock then only hides it in the shell.
- **Reading the screen before the idle time runs out**, or data a service sent elsewhere. The
  services here only listen on loopback.

The encrypted volume is what protects a disk that is taken while the machine is off **and the key
disk is not with it.**

## TPM2 and Secure Boot (not implemented)

These need hardware and are a plan only.

| Step | What it would give | What it needs |
| --- | --- | --- |
| TPM2 key slot (`systemd-cryptenroll --tpm2-device=auto --tpm2-pcrs=7`) in place of the key disk | The volume opens only on this board, with this firmware and boot policy | A TPM 2.0 on the node. QEMU can emulate one with `swtpm`, which proves only the wiring |
| TPM2 with a PIN (`--tpm2-with-pin`) | A person must be present at boot. Without the PIN the disk is useless even on its own board | The above, and a way to enter the PIN before the desktop |
| A recovery key slot | Data survives a board replacement | Somewhere safe to keep the recovery key |
| Secure Boot with a signed UKI (the image already boots one UKI through systemd-boot) | Only signed boot code runs, so PCR 7 means something | Owner signing keys and enrolling them in the firmware. Not done for the VM firmware either |
| Measured unlock bound to the signed UKI (PCR 11 policy) | A changed system closure does not get the key | Secure Boot above, and a signing step in the build |

None of this is claimed for 0.1.0.

## Check

Build the `desktop-protect` profile as in [vm-0.1.0.md](vm-0.1.0.md), with
`--argstr profile desktop-protect`. It is the sign-in check image with a 60 second idle lock and
the driver in protection mode, so it is never a release. The plain `desktop-login` check image sets
the idle lock to a day, because its media and Manimani steps wait minutes with no input. Unpack the raw image with
`zstd -d --sparse`. Make a key disk with the fixture age key:

```bash
nixos/otehon/base-make-key-disk.sh nixos/otehon/fixtures/test-age.key keys.tar
nixos/otehon/base-make-key-disk.sh nixos/otehon/fixtures/test-age.key wrong-keys.tar
```

The check changes the disk. On APFS a clone costs no space:

```bash
cp -c otehon-desktop-protect.raw check.raw
```

```bash
nixos/otehon/desktop-protect-check-qemu.sh check.raw keys.tar serial.log "0 1"
```

Exit codes: `0` every step passed and the disk search found only the plain canary, `1` a step
failed, the volume did not open, or the search found a protected canary, `3` the check could not
run.

The run boots the disk twice:

1. First boot formats the volume. The driver signs in with a random test wallet through the real
   shell, sends a message holding the shell canary, waits until the canary is in a file of the
   Chromium profile, and checks that the profile and `/var/log/journal` are on
   `/dev/mapper/otehon-state`. It logs a log canary and writes a plain canary to the root partition.
2. Ten seconds after the last input the shell must still be open. Within the idle time plus 15
   seconds it must lock, and not earlier than the idle time. While locked: no app, thread or
   account element, no canary text, and the title says `locked=1 gate=1 dapps=0`. A reload stays
   locked. A signature from another key is refused with `wrong-signer` and changes nothing. The
   right signature opens it, and the canary message is back. The Lock button locks it again.
3. The second boot must start locked. The right signature opens it, and the canary message is
   still there.
4. After poweroff the Mac searches the whole raw disk. It must find the plain canary (proving the
   search works) and must find neither the shell canary nor the log canary.

The canaries are joined at run time, so the image itself does not hold them.

Negative controls:

| Run | Expected |
| --- | --- |
| The used disk with `wrong-keys.tar`, stages `2` | `No key available with this passphrase`, no desktop (`browser=0`), exit 1 |
| The used disk with `keys.tar` again, stages `2` | Starts locked, unlocks, the canary message is there, exit 0. This also reopens the volume after a wrong key, which base-0.4.0.md did not check |
| `desktop-protect-plain` on a new disk, stages `0` | The driver refuses with `profile-not-on-volume`, the search finds the shell canary, exit 1. This proves the canary does reach the disk when the profile is not on the volume |

The browser lock alone can also be checked on a workstation, without a VM. It drives the built
shell in headless Chrome with trusted input and a random test wallet:

```bash
cd nixos/otehon/shell && IDLE_LOCK_MS=15000 node build.mjs
node test/lock-browser-check.mjs <empty-scratch-directory>
```

Exit codes: `0` all 12 steps passed, `1` a step failed, `3` no scratch directory.

The other desktop check scripts (`desktop-check-qemu.sh`, `desktop-login-check-qemu.sh`,
`run-desktop-qemu.sh`) now attach a key disk when `OTEHON_KEY_DISK` is set. Without one the desktop
does not start.

## Evidence (2026-11-07, Apple M1 Max)

The output is in [otehon-protection-20261107.txt](../evidence/otehon-protection-20261107.txt).

| Check | Result |
| --- | --- |
| Base derivations after the move into `state.nix` | Image `688hg7qw9b8xphj8qhmwfh2lg8509y7a`, system `g0ji835akblbsqb6i2bcv8jd3pafkq7p`, the same as at `47774e5` |
| Negative control: `state.nix` mode default changed to 711 | Image derivation changes to `5x1hi463syg9cq204n4sdrh4k8dl09q5` |
| `desktop-protect` and `desktop-protect-plain` | Evaluate (`nix-instantiate`). Not built |
| Unit tests (`npm test`) | 23 pass. Unlock tests: the account's signature opens, another key, another lock's nonce, a sign-in message for the same nonce and junk are refused, and a passkey account cannot use a signature |
| Negative control: `verifyUnlock` never compares the signer | 22 pass, 1 fail, the refusal test |
| Browser lock check, Chrome 156.0.8078.80 headless, `main.js` `006516ae2f213f08de06ddd0efc113ba653587f92ff0f97f349a0a1b10896876` | 12 steps pass, exit 0. Idle lock after 15080 ms with a 15000 ms setting |
| Negative control: the same check on the shell at `47774e5`, which has no lock | `idle_lock=0 timeout: idle`, exit 1 |
| VM checks | Not run. `vm-lock.sh` printed `NOT_RUN only 14278552KiB free, need 30GiB`, exit 3 |

The browser check ran on macOS against the file in `dist/`, not in the OS image. It shows the
shell's behaviour. It does not show that the image renders the same way, that the profile is on
the volume, or anything about the disk.

## Not verified or not implemented

- **Every VM check above.** No `desktop-protect` image was built or booted. So none of these is
  observed: the profile, journal and service data on the volume, the disk search, the wrong key
  refusal on the desktop, the reopen after a wrong key, the second boot starting locked, data
  surviving a reboot, and the plain-profile negative control. The check is written and the
  profiles evaluate. That is all.
- That Chromium writes nothing of the user outside its profile, cache and XDG directories. The
  disk search is meant to catch that, and it has not run.
- That the bind mounts unmount cleanly at shutdown, and that the journal flush ordering works.
  Both are in the check and have not run.
- The existing desktop checks (`desktop`, `desktop-login`, `desktop-media-gui`, `desktop-manimani`)
  now need `OTEHON_KEY_DISK`. They were not run again with it.
- **krunkit.** `desktop-media` and the other krunkit checks now need a key disk too. The krunkit
  scripts were not changed, because krunkit 1.3.2 shows no way to set the virtio-blk serial that
  the key disk is found by. Without a change they will boot with no desktop.
- A passkey account cannot unlock. A local secret (PIN) was not added, because a PIN kept in the
  browser profile would stop no one who can read the profile, and the wallet signature already
  covers wallet accounts.
- Signing out while unlocked, or a session that expires while unlocked, leaves the message
  threads for the next account that signs in on this device. Only the lock screen's Erase
  removes them. Generated media files and Manimani's state are not erased by it.
- The DevTools port is open to every local process. Limiting it to the desktop user (an nftables
  owner match, or a Unix socket) was not done.
- Swap. The image has none. A swap partition or file added later would need to be encrypted.
- TPM2, a passphrase, Secure Boot, key rotation and recovery. See the plan above.
- A real wallet. Signatures come from random software keys in the tests.
