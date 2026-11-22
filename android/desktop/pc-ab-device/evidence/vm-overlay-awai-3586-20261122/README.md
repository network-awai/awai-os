# awai-3586 の build VM に残っていた未 commit の差分（2026-11-22、AWAI-3586）

`awai-3586-codex-ota-build`（Vultr、`/root/build/src`、repo で 1279 project）を destroy する前に、
main の patches から作り直せない差分が残っていないかを調べた。最初の確認で「固有」に見えた差分が
2 つあったので、git diff として取り出して、ここに置く。どちらも main のスクリプトでまったく同じに
作り直せると確かめたので、新しい patch は足していない。

| ファイル | project と base | 大きさ | 作り直す方法 |
| --- | --- | --- | --- |
| `packages_apps_Updater.diff` | `packages/apps/Updater`、LineageOS `1445c6104ffb33123d4e449a60e3c054ed5a9ee0` | 8 ファイル、+331/−46 行 | `updater-feed.py configure-release <Updater> 'https://ota.awai.network/v1/pc/pilot/{device}/{incr}/builds.json'` |
| `device_mainline_generic.diff` | `device/mainline/generic`、`4cc0f606198db7d9f3a577283ebb3969350a0d38` | 1 行（`BOARD_MKBOOTIMG_ARGS += --header_version $(BOARD_BOOT_HEADER_VERSION)`） | `android/desktop/target-files/apply.sh <source tree root>` |

sha256 は `SHA256SUMS` に書いた。差分は VM 上で、HEAD から読んだ一時 index に worktree を `git add -A`
して `git diff --cached --binary --full-index HEAD` で取った。worktree と repo には書き込んでいない。

## 照合

上流を手元に clone して、base の revision で次の 2 つの tree を作って比べた。

- Updater: base に `configure-release` を走らせた tree と、base に `packages_apps_Updater.diff` を当てた
  tree が、同じ（tree `1b32bf88278ed2e9b1833a6f77b2b679cb33e323`）。
- device/mainline/generic: base に `target-files/apply.sh` を走らせた tree と、base に
  `device_mainline_generic.diff` を当てた tree が、同じ（tree `e612afe28d08fb8e30f34f6b284e91cde8584b2f`）。

Updater の 3 つの patch は、文脈なし（`-U0`）で作られている。そのため `git apply --unidiff-zero` で
当てる必要がある（`updater-feed.py` はそうしている）。`--unidiff-zero` を付けずに当てると、
base が合っていても失敗する。最初の確認で「固有」と見えたのは、このためだった。

## 作り直せると確かめたほかの差分（ここには置いていない）

- main の `apply.sh` の patches で完全に一致した（差分 0 B）: `build/make`、`device/mainline/common`、
  `device/virt/virt-common`、`device/virt/virtio-common`、`vendor/lineage`。
- `packages/apps/SetupWizard`: 0712 の入力の `setup-wizard/apply.sh` で完全に一致した
  （main にはなく、ブランチ `wip/awai-3600-release-compose-20261120-20261117` にある）。
- `device/virt/virtio_x86_64`: Radeon の patch のほかには、`vendor/awai/pc-firmware/firmware.mk` の
  inherit の 2 行だけが残る。
- `system/core/fs_mgr/fs_mgr.cpp`: 上流の commit `c6a6a611` の cherry-pick が途中で止まった
  もの（blob が同じ）。
- `external/libwebsockets`、`hardware/nxp/nfc`: repo の linkfile から出る差分。
