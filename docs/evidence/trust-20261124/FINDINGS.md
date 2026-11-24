# Trust 計測セル FINDINGS — 矛盾とリスク (2026-11-24)

矛盾（両立しない claim）の件数: **1**。他 3 件は字面上のリスクとして起票する
（証跡と文言の読み取り差）。本ファイルは docs のみで、原稿・コードは書き換えない。

## F1. STORE-TEXT × STORE-REFUSAL — 唯一の実在矛盾（CONTRADICTED ペア）

- **両方の引用**: 「更新は新たな権限を追加しない」(STORE-TEXT) と
  「Yotei 1→2001 は `new-permission` で拒否され、インストール版は 1 のまま」
  (STORE-REFUSAL、job `3668`) が evidence-map 上で両立しない。
- **どちらが正しいか**: STORE-REFUSAL。実測は後発の Job で、権限
  `network.itonami.yotei.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` は
  `docs/evidence/store-auto-update-job-20261121/README.md` に記録。
- **現在の状態**: `android/client/client.js` には文言「新たな権限の追加はありません」
  は残っていない（`store-permission-note-awai3653-20261122/README.md` の「更新画面は
  `permissionChanges` の行に置き換えた」と一致）。repo 内 grep は README を除き
  現在のソースにヒットなし。直すべき残件は、旧文言を引用候補から外すこと
  （CONTRADICTED 区分の制約通り）。

## F2. OTA-DESIGN の "signed" — 字面の読み取り差（リスク）

- **両方の引用**: OTA-DESIGN「signed, digest-bound ZIPs」と言いつつ、
  証跡（OTA-REF / OTA-PC / OTA-REJECT の KVM JSON）は AOSP test key、
  userdebug、KVM 環境で、release 署名・物理環境での適格化を述べていない。
  同時にも OTA-ENDTOEND は UNVERIFIED に「signed PC OTA の物理適格化は未実施」
  と明記している。
- **何が正しいか**: 証跡が正しい（test key の KVM 実測まで）。
- **必要な直すこと**: 原稿引用では「signed = test-key / KVM」に範囲を明示する。
  最初に直すべき 1 件（SUMMARY.md 参照）。

## F3. productionQualified / sourceClosure — フラグ引用の省略リスク（リスク）

- **両方の引用**: BOOT-LAN / BOOT-PINS / BOOT-INPUT は MEASURED と言いつつ、
  対象 JSON の `productionQualified: false`、`sourceClosureVerified: false`
  （`artifacts-20261116.json`、`pc-evaluation-pins.json`、`physical-observation.json`
  の 3 ファイルとも false）が現実の限定である。
- **何が正しいか**: JSON のフラグが正しい。BOOT rows は「pin / 記録の計測」で
  あって「本番適格化」ではない。evidence-map の書かれ方（pin と qualification
  を分けて言及）は正確である。
- **必要な直すこと**: BOOT-LAN / BOOT-PINS / BOOT-INPUT を引用する際は
  `productionQualified: false` を一緒に示す（省略した引用転載をしない）。

## F4. STORE-PINS の instrumentation 前提の version ずれ（リスク）

- **両方の引用**: STORE-PINS「85 assertions passed」と言いつつ、
  `store-auto-update-job-20261121/README.md` の注記は「オンライン catalog r107 の
  導入後は `StoreInstrumentation` が `itonami version` で不一致になる」
  （Itonami versionCode 1000 期待が r107 の 1002 で崩れる）。
- **両方の記録は現物で解決済み**: `store-latest-pointer` と `store-auto-update-job`
  の `instrumentation.log` は共に末尾「85 assertions passed」を示す;
  不一致は `pm clear` 前後で前提を切り替えた話であり、ポリシー自体の矛盾ではない。
- **必要な直すこと**: 該当テストの version 期待値を更新する（本タスクは
  docs のみ、ここでは起票まで）。

## 「矛盾」ではないが観察として残す

- **OTA-ETAG** (ETag ≠ SHA-256): 矛盾ではなく transport metadata の対照実験として
  有効。publisher は受領 bytes からハッシュする設計が正しい。
- **YATA-CAR** の gateway 404: 「served its raw root block」と「file path 404」
  は claim 文内に両方明記され、404 は結果の側として整合的。
- **GFTD/MITHRIL**: `docs/research/` における言及は 0 行（BASELINE §3 の検査通過）。
