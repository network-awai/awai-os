# Self-hosting P0: 端末能力 probe と guest 可否表

[AWAI-3854](https://linear.app/kotobalabs/issue/AWAI-3854)（親 [AWAI-3853](https://linear.app/kotobalabs/issue/AWAI-3853)）、2026-11-22。
これは開発 guest の可否判定であり、guest 起動・ビルド成功を示すものではない。
今回の実機操作は、既に adb を許可した moto g05 の read-only 読取りのみ。

## 方法

`scripts/selfhost/probe.sh <adb-serial>` は明示した 1 台だけに固定の read-only
コマンド列（`get-state`、allowlist の `getprop`、`uname`、`/proc/meminfo`、
`df /data`、`/dev/kvm`・AVF feature・対象 package・`/apex` の有無）を実行する。
serial・IMEI・account・IP・SSID は出力しない。空値と読取り失敗は `unknown`。
exit は 0=全読取り完了、1=一部の読取り失敗、2=引数不備、3=実行不可。
`/apex` は shell user から読めないことが多いため best-effort（失敗しても
collection 全体は失敗にしない）。

負の対照は `scripts/selfhost/test-probe.sh`（fake adb、実機に触れない）:
固定コマンド列の完全一致、offline/unauthorized の開始前拒否（呼出し 1 回のみ）、
property 欠落時の `unknown` と `collection_status=1`、serial の非出力、usage 拒否。

## 実測（phone）と未再測（PC）

| 項目 | moto g05 (lamu) — 2026-11-22 実測 | Awai OS PC (Generic x86_64) |
| --- | --- | --- |
| model / board / ABI | moto g05 / mt6768 / arm64-v8a | MQ（空）/ — / x86_64（AWAI-3565 記録） |
| SDK / release / build type | 37 / 17 / userdebug | 37 / 17 / userdebug（同上） |
| kernel | `6.6.139-android15-8-…-4k`（今回初めて実測） | 未再測（unknown） |
| RAM (MemTotal / Available) | 7,911,268 kB / 約 2.9 GB（負荷で変動） | 約 23.8 GB / 約 18.6 GB（AWAI-3565 記録） |
| `/data` 空き | 約 87 GB（使用 21%） | whole-device は unknown のまま |
| `/dev/kvm` | absent | present（AWAI-3565 記録） |
| AVF feature | absent | present（同上） |
| Linux Terminal package | absent | installed だが disabled（同上） |
| Termux package | absent（userland は `/data/local/tmp` 配下で pm 管理外） | 未再測 |
| `/apex` の virt | unknown（shell から `Permission denied`） | 未再測 |

PC は今回 adb 一覧に現れなかった（`10.77.0.2:5555` 不在）ため再測していない。
PC の行は AWAI-3565（2026-11-19）の記録をそのまま引用し、現況と同一視しない。

## AWAI-3565 記録との照合

- 一致: phone の AVF/`/dev/kvm`/Terminal 不在、SDK 37、8 GB RAM、userdebug。
- 解消: kernel 版数は 3565 で未検証だったが今回 `6.6.139-android15` と実測した。
- 差異（矛盾ではない）: MemAvailable は 3565 の約 4.9 GB に対し今回約 2.9 GB。
  空きメモリは負荷依存であり、能力値としては MemTotal を正とする。
  `/data` 空きは約 102 GB → 約 87 GB に減少（使用量の増加）。
- 新規の制約: `/apex` は shell user から読めない。APEX の有無判定は
  package 読取りでは代替できず、guest 起動の判定には使わない。

## guest 可否表（判定規則つき）

| 端末 | AVF Linux VM | proot Debian | native (bionic 直実行) |
| --- | --- | --- | --- |
| PC x86_64 | 条件付き可: `/dev/kvm` と AVF feature はあるが Terminal は disabled で、x86_64 LineageOS 上の Debian guest 起動は未検証 → P1 で確定 | 可（fallback） | 不可: muse の Linux 配布は glibc/musl 前提で bionic 直実行の対象外 |
| phone arm64 | 不可: `/dev/kvm` と AVF feature が無い。SoC firmware 側の対応が要り、現行 build では見込めない | 可: AWAI-3565 で toolchain と muse exec を実測済み | 同上、不可 |

判定は「道具がある」ことと「guest が起動する」ことを分け、後者は
実際に起動するまで `unknown` のままにする。

## 次の単位

- P1: PC で Terminal を有効化（owner 操作）し guest 起動可否を確定する。
- P2: phone proot の常駐化（adb session 終了で子が死ぬ問題）と soak 計測。
- どちらも本書の可否表を前提にし、結果が食い違えば本書を更新する。
