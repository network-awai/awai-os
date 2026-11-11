# Otehon desktop macOS app 0.1.0

`network-awai/awai-os` の Otehon desktop を Mac で build・起動する手順。
QEMU/HVF 上で NixOS image を動かす interim 経路 (AWAI-2784)。
本命の launcher (`.cljc` + clojurust) は [AWAI-195](https://linear.app/kotobalabs/issue/AWAI-195) を参照。

## Build (効率化つき)

```
./nixos/otehon/macos-build.sh <out-dir>   # <out-dir> は絶対パス・repo 外
```

- `awai-otehon-nix` podman volume を build cache として永続化する。volume が
  空でも upstream cache から取得できるが、2 回目以降は差分のみ。
- `OTEHON_CACHE_FROM=<別マシンの out-dir>` で volume を事前 warm 可能。
- 同一 image からの再 export は sha256 照合で skip する。
- GC root (`otehon-live-image`) を pin する。volume の blind GC は、
  コンテナ自身の nix まで消して次回 build を壊すので禁止。
- file cache (`<out-dir>/nix-cache`) は toplevel closure を置く。raw disk
  12 GiB は入れない (単一巨大 NAR が詰まる)。toplevel は update feed
  (`update.sh` が配る `$system`) と同じ粒度で、差分更新と相性が良い。

測定値 (2026-11-11, Apple Silicon, podman machine):

| 項目 | 値 |
|---|---|
| image closure | 12.3 GiB (`system.build.image`) |
| toplevel closure | 9.7 GiB (`system.build.toplevel`) |
| file cache (初回) | 3.5 GiB / 1314 paths |
| file cache (2 回目) | `copying 3 paths` のみ (差分) |
| qcow2 (compressed) | 4.8 GiB |
| image rebuild (fstab 1 行変更) | 8 derivations + repart 実機 assembly |

容量の注意: podman machine disk は既定 100 GiB。volume が 69 GiB まで
膨らんで repart の一時 raw (12 GiB) が書けず ENOSPC になった実績がある。
`podman system df` で監視し、live root を pin してから
`nix-collect-garbage -d` で掃除する (素の GC は禁止、上記参照)。

## Install / launch (.app)

```
./nixos/otehon/macos-app/install-image.sh <out-dir>/otehon-desktop.qcow2 0.7.0
./nixos/otehon/macos-app/assemble-app.sh <dest-dir> 0.7.0
open "<dest-dir>/Otehon Desktop.app"
```

- install は sha256 を検証して `~/Library/Application Support/Otehon/`
  に version 付きで置く。`.app` はその version の image を起動する。
- `--bundle-image` を付けると qcow2 を Resources 内に同梱する (大きい)。
- 初回起動は未署名のため右クリック → 開く。QEMU + HVF + cocoa。
- headless 検証は `OTEHON_DISPLAY=none`。

## Check (VM gate)

```
./nixos/otehon/desktop-check-qemu.sh <image.qcow2> <serial.log> <shot.ppm> [timeout]
```

`OTEHON_BOOT_REPORT ... compositor=1 chromium=1 react=1 zenoh=1 matter=1
gate=1 failed=0` + スクリーンショットが合格条件。`failed=1` の既知原因:
`/var/lib/otehon-models` の boot 時 mount 失敗 (weights 用 virtiofs share
が無いと起こる)。`media.nix` を automount 化して boot 時の failed を
出さない (service 自体は models 不在を `image unavailable` と報告する)。
