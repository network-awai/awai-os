# Awai Otehon backup 0.1.0

Encrypted backup and restore of the state volume with restic (AWAI-166). This is the D8 restore
test and stage 2 of D17 in `network-awai/network-awai-apex` ADR 0026: the data is encrypted on
the node before it reaches the backup target, and a new disk restores it with the same key.

| Part | Component | File |
| --- | --- | --- |
| Backup | The NixOS restic module, service `restic-backups-otehon`, wrapper `restic-otehon` | `nixos/otehon/backup.nix` |
| Repository key | `/var/lib/otehon/backup/restic.key` on the encrypted state volume | `nixos/otehon/backup.nix` |
| Key on a new disk | `otehon-backup-key` copies `restic.key` from the key disk once, if the volume has none | `nixos/otehon/backup.nix` |
| restic cache | Moved to `/var/lib/otehon/backup/cache`. The module's default is `/var/cache`, on the root partition, which is not encrypted | `nixos/otehon/backup.nix` |
| Check image | Headless, imports `base-module.nix` and `backup.nix`. The target is a 9p share. QEMU passes the mode through fw_cfg | `nixos/otehon/backup-check.nix` |
| Check | Four boots on qcow2 overlays of one image | `nixos/otehon/backup-check-qemu.sh` |

The backup covers `/var/lib/otehon` and leaves out `age.key`, `backup/` (the restic key and the
cache) and `lost+found`. The keys come from the key disk on a new disk, not from the backup.
There is no schedule: `otehon.backup.timerConfig` is `null`, and the backup runs with
`systemctl start restic-backups-otehon`. Restore is `restic-otehon restore latest --target /`.

`nixos/otehon/fixtures/backup/` holds two test repository keys, `test-restic.key` and
`test-wrong-restic.key`. They protect only check repositories made on the Mac.
`base-make-key-disk.sh` takes an optional third argument that adds `restic.key` to the key disk.
`backup-check.nix` is not a release: it has no login, network, SSH or Hermes Agent.

## Build

Follow [vm-0.1.0.md](vm-0.1.0.md) and add `--argstr profile backup-check` to `nix-build`.

## Check

```bash
nixos/otehon/backup-check-qemu.sh backup-check.qcow2 work
```

`work` must not hold a `share` directory yet. The image is not changed. Exit codes: `0` every
check passed, `1` a check failed, `3` the check could not run.

One run goes through these steps:

1. Disk a, mode `backup`: first boot formats the state volume, writes `data/` with a canary,
   4 MiB of random bytes and a mode-600 note, and hashes the tree (names, types, modes and
   contents). It writes a plain canary to the share outside the repository, runs the backup,
   counts snapshots and runs `restic check --read-data`.
2. The Mac searches the share. It must find the plain canary, and must not find the backup
   canary, the test restic key or the test age key.
3. Disk b, mode `restore`: a new overlay of the image and a new key disk with another LUKS key
   and the same restic key. The tree must be absent before the restore and match the hash of
   step 1 after it.
4. Disk c, mode `restore`: a new disk whose key disk holds `test-wrong-restic.key`. The restore
   must fail with `wrong password or no key found` and leave no tree.
5. The Mac writes 32 bytes into the middle of the largest pack file. Disk b, mode `verify`:
   `restic check --read-data` and a restore into `/run` must both fail with an integrity error.

The positive cases are part of the same run: step 3 shows the refusal in step 4 is about the key,
step 1's `check=ok` shows the failure in step 5 is about the change, and the plain canary shows
the search in step 2 reads the share.

## Evidence (2026-11-07, Apple M1 Max, QEMU 10.0.3 with HVF)

| Item | Result |
| --- | --- |
| nixpkgs | `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`, restic 0.18.1 |
| Raw image SHA-256 | `949638e2b9ed6d2ec8966033234adee8a5bdde1b1260643a49ba77105268743c` (5,101,342,720 bytes) |
| Backup | `backup=ok snapshots=1 check=ok failed=0`, 2 packs, 4,120 KiB on the share |
| Share search | `plain_canary=found backup_canary=absent keys=absent` |
| Restore on a new disk | `pre=empty restore=ok`, hash `b2c194ad78f5ce85` equals the backup hash, `check=ok` |
| Wrong key on a new disk | `restore=fail reason=wrong-password hash=empty`, restic `Fatal: wrong password or no key found` |
| Tampered pack | `check=fail reason=integrity`, `Fatal: repository contains errors`; restore `ciphertext verification failed`, `Fatal: There were 1 errors` |
| Run | `PASS`, exit 0 |

A first run of the same image without the key search (`run1`) also passed, with hash
`71b2c2e7144cef5b`. The hash differs between runs because the data is random.

The report lines are in
[otehon-backup-20261107.txt](../evidence/otehon-backup-20261107.txt).

## Not covered

- **No off-site target.** The target is a 9p share from the Mac in a check VM. A network target
  (SFTP, REST server, S3), a second site and a target on another node are not implemented.
- **No schedule.** `timerConfig` exists but is `null`, and no timer was run. Pruning and retention
  are not set.
- **No key recovery.** If the key disk and the state volume are both lost, the backup cannot be
  read. Key rotation (`restic key add` and `remove`) and moving the key off the test key disk to
  TPM2, a passphrase or Vaultwarden are not implemented.
- **No consistency for open databases.** The check backs up files that nothing is writing. D17
  says to stop Hermes or take an SQLite backup first; `backupPrepareCommand` is not used yet.
- **Repair is not tested.** The check shows the damage is detected, not that `restic repair`
  recovers the other snapshots. A partial restore wrote 7 of 8 entries and skipped the damaged
  file, and still exited non-zero.
- **The other node is a second disk on the same Mac**, not a second machine, and the node is
  trusted while it runs: it sees the plaintext (D17).
- **A whole-run negative control was not run.** `OTEHON_BACKUP_RESTORE_KEY` puts another key
  on disk b, so the run should stop with `FAIL expected restore=ok` at step 3. It was started
  twice, and `vm-lock.sh` refused it both times with `NOT_RUN` because the Mac had less than
  30 GiB free. The per-step controls above did run.
- A tampered `config`, `keys/`, index or snapshot file, a deleted pack and a rolled-back
  repository were not tried. Only a changed data pack was.
- The `desktop` profile does not import this module. x86_64, physical hardware and a CI image
  build are not verified.
