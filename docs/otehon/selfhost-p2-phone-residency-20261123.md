# Self-hosting P2: phone proot の常駐性と soak 実測

[AWAI-3856](https://linear.app/kotobalabs/issue/AWAI-3856)（親 [AWAI-3853](https://linear.app/kotobalabs/issue/AWAI-3853)）、2026-11-23。
対象は moto g05（lamu、arm64、8 GB）の proot Debian userland。実機操作は
adb 経由の userland 内実行と read-only な battery/thermal 読取りのみ。

## 常駐性: session を跨げない（再確認）

- `setsid nohup sleep 90 &` で切り離した process は、起動した adb session が
  終わると次の session から見えない。AWAI-3565 の「session 終了で子が死ぬ」を再確認した。
- 理由は proot の trace 親子関係と adbd の子回収で、`setsid` でも逃げられない。
- したがって現行の実行形態は「1 task を 1 session 内で完結させる」に確定する。
  session を跨ぐ常駐は Android 側の foreground service（Termux 等の app、
  または自前の service app）が要り、本単位の範囲外として P6 側に残す。

## soak: 1 task の実測

`/root/w3`（w2 の複製に off-by-one を仕込んだもの）で `muse exec` を 1 回実行した。

| 項目 | 値 |
| --- | --- |
| 壁時間 | 35.2 s（`time` 実測、終了コード 0） |
| 独立再実行 | `npm test` 4 pass / 0 fail |
| 電池 | level 100%（充電中）、温度 23.0 °C で前後不変 |
| 熱 | Thermal Status 0（抑制なし） |
| 空きメモリ | 約 2.85 GB で前後ほぼ不変 |

小規模な Node task は phone 単体で実用になる、という AWAI-3565 の結論は変わらない。

## 運用手順（この userland で bot を回すとき）

- 実行は単一 session に収める。長い build は session を分割せず、1 回の
  `run.sh` 呼出しの中で終わらせる。
- `perl` は held のままにし、hard link を含む package（`perl`、`unzip`）を
  apt で入れない（AWAI-3565 の dpkg 制約）。
- 括弧を含むコマンドは adb の二重引用で壊れるため、script を base64 で
  渡して userland 内で展開してから実行する。

## 残件

- 端末からの配送（push / PR）は `gh` 未ログインのため不可。2026-11-19 時点の
  長期 token は失効している。再認証は対話操作のため owner が端末で行う。
  それまでは host の pipeline が配送を担い、端末は実装と検証に使う。
- foreground service による常駐は P6（Itonami Dev app）で扱う。本書では
  「proot + adb では常駐できない」を確定事項として残す。
