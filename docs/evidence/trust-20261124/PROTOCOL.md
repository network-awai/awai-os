# Trust 計測セル プロトコル (2026-11-24)

オーナー承認 2026-11-24。本文書は第三者が同じ手順で同じ数値を再現できるよう、
4 項目の定義（数え方・分母・「未再現」の扱い・更新頻度）を固定する。
先に固定し、後付けで数字を選ばない。数値が取れないものは推測で埋めない。

## 対象

- `docs/research/evidence-map.md` の全 24 claim（claim_id 単位）。
- `docs/research/contributions.md` / `program-map.md` / `research-plans.md` は
  同じ claim_id を参照するもので、新 claim を生まない（2026-11-24 時点で確認）。
  `contributions.md` の `(counts / keys)` 行はメタ行であり claim として数えない。
- 各 claim について、evidence-map の `Source` 列に書かれた証跡参照
  （パス / PR 番号 / ソース行）を 1 行とする。BASELINE.tsv の 1 行 = 1 claim = 24 行。

## 1. claim→証跡 対応率

定義: 24 claim のうち、証跡参照が実在し解決するものの割合。

- ファイルパス: リポジトリ相対パスが存在する（`test -f` / read_file で確認）。
  アンカー（`README.md:65` 等）は行番号が存在範囲内であることを目視する。
- PR 番号: `gh pr view <n> --json state,url` が解決し、報告した state
  （MERGED 等）と一致する。URL を作らない。解決しないものは `resolved=no`。
- ソース行参照（`AutoUpdater.java:137` 等）: `nl -ba` で該当行に記述がある。
- 分母 = 24（evidence-map の claim 行数。`grep -c "^| " docs/research/evidence-map.md`
  = 26 = header + separator + 24 行）。

## 2. 証跡 再現率

定義: 24 claim のうち、引用された数値（bytes / sha256 / 件数 / HTTP 状態）を
こちらで再取得して一致したものの割合。再取得できないものは
「未再現」として数え、成功にしない。

- 再現の手続きは 2 段階：(a) コミット済み証跡の読み戻し（JSON の値を `python3 json`
  で引き、evidence-map の値と突合）(b) 独立再取得（実行の再実行 / 外部 read-only GET）。
- `reproduced = yes` は (a) が一致し、(b) が可能なものは (b) も一致した場合のみ。
  KVM/エミュレータの履歴実行、書き込みを要する操作（yataverse put）は
  本ベースラインでは未実施であり `未再現` とする（次回再測）。
- 外部への読み取りは HEAD / GET / Range。
- 分母 = 24。「未再現」は分母から外さない。取得不能の理由は SUMMARY.md に列挙する。
- 結果列の値は `yes` / `未再現` のどちらか。`no` は使わない（mismatch があれば変更する）。

## 3. 外部依存数

定義: claim が依存する外部ホスト・bucket・サービスの種数。

- 数え方: evidence-map の Source 先と、その証跡ファイルが実際に通信した
  ホスト（github.com、raw.githubusercontent.com、release-assets.githubusercontent.com、
  ota.awai.network、yataverse.com）を claim 行ごとに列挙する。
  「背景言及」は依存として数えない。
- GFTD/MITHRIL の検査: `grep -rE 'GFTD|MITHRIL' docs/research/` が
  0 行であることを確認する（出れば prune 方針の違反として FINDINGS に起票）。
  ADR 内の歴史的言及（例: の `ai-gftd-cdn`）は claim の依存ではないため分母外。

## 4. 未検証 claim 数

定義: Status が `UNVERIFIED` と明記された claim の件数。多いこと自体は悪ではない。
明記されていることが健全である。

- `grep -c 'UNVERIFIED' docs/research/evidence-map.md` ではなく、claim 行の
  status 列が `UNVERIFIED` のもので数える（`CONTRADICTED` は別区分）。
- 分子 = UNVERIFIED の claim 数、分母 = 24。

## 更新頻度

- ファイルが 1 本でも変わったら BASELINE.tsv を再生成し、SUMMARY.md の数値を更新する。
- `docs/evidence/` の過去記録は書き換えない。本ディレクトリの数値だけが current。
- 査読は Organizer が担当（本ベースラインは docs のみ・コード変更なし）。

## 再現コマンド（このベースラインで実際に使った）

```sh
grep -c "^| " docs/research/evidence-map.md
grep -c 'MEASURED' docs/research/evidence-map.md
grep -rE 'GFTD|MITHRIL' docs/research/   # 0 行であること
python3 -c "import json;d=json.load(open('<json>'));print(...)"
gh pr view 479 --json state,headRefOid
curl -sS -m 15 -D- https://ota.awai.network/v1/pc/pilot/virtio_x86_64/<build>/builds.json
curl -sS -m 15 -I https://raw.githubusercontent.com/.../itonami.apk
curl -sS -m 15 --range 0-99 -D- https://github.com/.../part-aa
curl -sS -m 15 --range 0-9 -D- https://yataverse.com/ipfs/bafkreihdqs6os5okbpn3yioraw7hzxfk7dds3y42wpoj5lqkpuolkcmyqm
```
