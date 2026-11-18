# Awai Drive — 大容量・多数ファイルでスケールする同期の設計（WNFS 準拠版）

- 状態: **提案（設計のみ）**。実装も、WNFS 準拠・性能・容量・durability の主張も含まない。
- 追跡: [AWAI-3357](https://linear.app/kotobalabs/issue/AWAI-3357)（初版、PR #248）、[AWAI-3372](https://linear.app/kotobalabs/issue/AWAI-3372)（この改訂）。
- 対象: `apps/drive`（Tauri 3.0.0-alpha.6）。Android と macOS で共通の domain/policy（CLJC/CLJS）を使い、
  platform ごとの Rust/Kotlin/Swift は bounded な adapter だけに限る。
- 初版からの変更: 初版は独自の chunk / pack / paged manifest 形式を提案していた。owner 判断
  （2026-11-16、[AWAI-2961](https://linear.app/kotobalabs/issue/AWAI-2961)）は「WNFS に準拠し、`.cljc` で実装する」であり、
  apex に実装 `otehon/wnfs-cljc` がある。この版は、**独自形式を作らず、WNFS の仕様と `wnfs-cljc` の上に組み直した**。
- 範囲外（別 issue）: 共有・失効、独立 node による耐久性、owner 復旧、Native selfhost、WNFS の全体認定。

## 0. 動機

2026-11-18、agent の成果物（`.agent-output`、VM image、ログ）でこの Mac のディスクが 214GB から 24GB まで減った。
成果物を Drive に長期保管し、同期を確認できたものだけを端末から退避できれば、増加を構造的に抑えられる。
しかし現在の Drive は 8 MiB を超えるものを同期も退避もできない（`docs/encrypted-sync.md`）。

## 1. 現状の位置づけ（コードを正とした確認）

「Drive / Vol は WNFS と IPLD がベース」は、部分的にしか当てはまらない。

| 部品 | 現状 | 根拠 |
|---|---|---|
| IPLD（CIDv1、DAG-CBOR、CARv1） | **使っている**。Drive の pack は CARv1、各 block は CIDv1（raw, sha2-256） | `apps/drive/docs/encrypted-sync.md` |
| Drive の live 経路 | owner-store（`object-v2` の raw frame、Kotoba hybrid envelope、暗号化 `private-manifest-v1`）。**WNFS ではない** | 同上、`AWAI-173-private-sharing-design.md`（「WNFS wire 互換は主張しない」） |
| AwaiVol（legacy） | 独自の forest / pack codec（part ≤ 896 KiB、container ≤ 1 MiB など）。**WNFS PrivateForest とは別の仕組み** | `otehon/legacy-awaivol/README.md`、`docs/otehon/drive-storage.md` |
| WNFS | apex の `otehon/wnfs-cljc` に CLJC 実装がある（rs-wnfs 0.3.0、node 1.0.0 の profile）。**まだ owner-store / AwaiVol の既定の読み書き経路ではない**。live 切替は copy-only 移行として別 issue（AWAI-2798/2799） | `otehon/wnfs-cljc/README.md`、AWAI-2961 |

したがって、この設計は「**Drive の同期形式を、WNFS（wnfs-cljc）に載せ替えるときに、規模の上限をどう外すか**」を扱う。

## 2. 仕様・実装・未実装の対応

仕様は `wnfs-wg/spec` の revision 5229f36。実装 profile は rs-wnfs 0.3.0（revision 80d5428）で、node `1.0.0`。
仕様の node は `0.2.0` で、nonce の長さ、header の鍵、temporal key の文脈、hash-to-prime の counter、skip-ratchet の carry に
差がある（記録と修正案: [wnfs-wg/spec#81](https://github.com/wnfs-wg/spec/pull/81)）。**この設計は実装 profile に従い、
仕様の版へ黙って切り替えない。**

| 仕様が要求すること | wnfs-cljc の実装 | 未実装・要確認 |
|---|---|---|
| PrivateForest ＝ degree 16 の HAMT。label は 2048-bit の `NameAccumulator`、値は raw CID の sorted 集合 | あり（79 label の上流 corpus と全 node の bytes/CID が一致） | 全体を読み込まない **lazy な HAMT 走査**（現行 loader は node 数を 10000 で拘束） |
| 暗号文 block ≤ 256 KiB（平文 ≤ 262,104、IV 24 + tag 16） | あり（XChaCha20-Poly1305、AES-256-KWP） | — |
| file ＝ header + 外部 block（`blockCount`: Uint64、`blockSize` ≤ 262,104）。各 block の label は `baseName` に index から導いた素数を accumulate | あり。ただし **1 file ≤ 4096 block** | 上限の引き上げ、streaming の利用の徹底 |
| 版管理 ＝ skip ratchet、`previous` の暗号化 backlink、revision ごとの label | ratchet、key 導出は実装済み | **latest-revision の探索、履歴の検証、in-place 更新** |
| merge ＝ 可換・冪等な join-semilattice（第三者が平文なしで blind merge できる） | HAMT 側の考え方はある | forest の merge の実装・資格 |
| 書き込み権限 ＝ RSA accumulator の membership / batch proof を、平文を読めない第三者が検証 | accumulator の演算はある | **membership / multi-batch proof、writer 認可、fencing** |
| 転送は CAR（bitswap ではなく 1 往復で新しい block 群を送る） | CARv1 の pack（≤ 10000 block / 256 MiB、BLAKE3/SHA-256 の CID を保持） | **BLAKE3 対応の CAR index**（既存の CARv2 index は SHA-256 のみで流用しない） |
| 公開側は UnixFS | — | 公開 import/export は別の認可境界 |

root の権限（capability）は WNFS の bytes の**外側**で、既存の Kotoba hybrid owner envelope と sealed identity custody が包む
（`custody.cljc`）。新しい identity、unlock の保管、consent broker は作らない。

## 3. 上限の出どころ

仕様自体には file サイズや entry 数の上限はない（`blockCount` は Uint64、HAMT に上限はない）。
**上限は実装の admission bound と、Drive の現行経路にある。** 数値はコードと文書から読んだもので、
資源上限であり性能・容量の保証ではない。

| 上限 | 値 | 場所 | 守っているもの |
|---|---|---|---|
| Drive の snapshot 全体 | 8 MiB / 1000 entry | owner-store 経路（`encrypted.cljc`） | JS heap（snapshot 全体を 1 つの `Uint8Array` に載せる） |
| Drive の pack（サーバ側も） | 12 MiB | `PACK_LIMIT`、Yataverse `DRIVE_MAX_PACK_BYTES` | 1 回の PUT/GET の大きさ |
| 1 file | **4096 外部 block ≈ 1 GiB − 160 KiB**（4096 × 262,104 = 1,073,577,984 byte） | wnfs-cljc `private_node` / `private_tree` | forest の件数、メモリ |
| 取り込む path 数 | 1000 | wnfs-cljc `private_tree` | tree ingestion の入力 |
| directory の entry 数 | 1000 | wnfs-cljc `private_node`、Drive `desktop.rs` | directory node は 1 block に収まる |
| forest | node / record 各 10000 | wnfs-cljc `wire` | 全体をメモリへ読む loader |
| CAR | 10000 block / **256 MiB** | wnfs-cljc `pack` | 実際は byte 上限が先に効く（256 MiB ≈ 約 1000 block） |
| `read-file`（便利 API） | 64 MiB | wnfs-cljc | 全体をメモリへ載せる API。大きな入力には使わない |
| 深さ | ingest 64 / 走査 128 | wnfs-cljc | 再帰 |

問題の核は 3 つ。(1) Drive の live 経路が WNFS ではなく 8 MiB の単一 pack であること、
(2) wnfs-cljc が全体を読み込む前提の bound を持つこと、(3) 仕様自体の制約（§4.3、§4.4）。

## 4. 設計

### 4.1 形式

- 同期の単位の形式は **WNFS の private forest そのもの**（実装 profile）。独自の chunk、manifest、暗号の形式は作らない。
- 既存の Kotoba hybrid envelope は、(a) root capability の包み（`custody.cljc`）と、(b) 既存の v1 snapshot の読み取りにだけ使う。
- v1 の snapshot（owner-store、単一 pack ≤ 12 MiB）は**そのまま復元できる**。v1 を v2 として、v2 を v1 として読まない。
  古い root への黙った fallback はしない。移行は copy-only（既存のデータと鍵は変えない）。

### 4.2 file（大きなファイル）

- file は header + **外部 block の列**。block は平文 ≤ 262,104 byte、暗号文 262,144 byte、label は block ごとの `NameAccumulator`。
  block の label は index から決まるので、**任意の block を単独で取得・検証・再送できる**（range 読み、再開、部分 hydration）。
- 4096 block の上限は仕様由来ではなく実装の admission bound。上げるには、blockCount、forest の件数、CAR の分割に対する
  bound を、streaming の前提で見直す（§8 の W1）。**GB 級でも全体を載せない**: `stream-file` と block source を使い、
  `read-file` は使わない。
- 64 GiB 級を目標にすると、block は約 26 万個、forest の record も約 26 万になる。**per-block の `NameAccumulator`
  （2048-bit の RSA 演算と hash-to-prime）のコストが律速になり得る**ので、測定が先（§7）。

### 4.3 directory（多数のファイル）

- 仕様の private directory は、`entries` の全体を **1 つの node（1 block）** に持つ。**sharded directory は仕様にない。**
  実装の 1000 entry は、この構造の現れでもある。
- したがって「1 directory に数十万 file」（例: 1 つの `.agent-output` に 30 万 file）は、**そのままでは WNFS で表せない**。
- 扱い（推奨）: 退避の単位を「file 単位」ではなく「**directory subtree を 1 つの archive（tar 型の stream）にした 1 file**」にする。
  大量の小さな file は 1 つの大きな外部 block 列になり、仕様の範囲で表せる。利用者が個別に開く必要のある file は、通常の file として別に置く。
- 別案（owner 決定が必要）: directory の sharding（UnixFS の HAMT-sharded directory 型）を Awai の拡張として仕様に足す。
  相互運用性を失うので、既定にはしない。

### 4.4 更新（版）

- 仕様は「内容が変わるたびに外部 content の `key` を**ランダムに作り直す**」と定めている（§3.1.4.1）。
  よって、**大きな file を一部だけ変えると、その file の全 block が新しい key で再暗号化・再送になる**。block 単位の差分更新はできない。
- 影響: 不変の成果物（ログ、ビルド出力、録画）には問題ない。**追記・部分更新される大きな file（VM image など）には向かない。**
  扱い（推奨）: 変更される大きな file は、アプリ側で**固定長の segment に分けて、別々の WNFS file**（それぞれ独立の版）にする。
  これは WNFS の外側の規約であり、P5 以降で扱う。
- 版は skip ratchet と暗号化 `previous` で表す。**latest-revision の探索と in-place 更新は wnfs-cljc で未実装**（§2）。
  それまでの Drive は、「新しい forest root を作って、新しい block だけを送る」full-snapshot 型で動かす。
  同じ内容の block は CID が同じなので、再送は冪等（サーバが既に持っていれば省略できる）。
- forest の merge は可換・冪等なので、**中断した upload の再開は「足りない block をもう一度送る」だけで済む**。

### 4.5 転送（pack）

- 送る単位は **CARv1 の pack**（`pack/write-pack!`、`open-pack`）。pack は暗号文 block の束。block は pack をまたがない。
- 大きさ: 目標 **32 MiB**（約 128 block、提案値）、上限は wnfs-cljc の **256 MiB**。サーバの現状は 12 MiB で、引き上げは別（§4.9）。
- pack の ID は従来どおり pack 全体の SHA-256（`/awai-drive/v1/packs/<64hex>`）。既存の路線と受領証をそのまま使う。
- pack 内の block を後から単独で取得するには index が要る。既存の CARv2 index は SHA-256 のみで、wnfs-cljc は BLAKE3 の ID を保持する。
  **BLAKE3 を扱える index は未実装**で、「既存の index を改変して BLAKE3 を読み替える」ことはしない（W3）。

### 4.6 client のパイプライン

```
source file ─(bounded read)→ block source ─→ seal(XChaCha20-Poly1305) ─→ label(accumulate) ─→ CAR writer ─→ PUT ─→ readback
```

- すべて backpressure 付き。上流は下流が空くまで読まない。最大 buffer の総和がメモリの上限（§7 で測る）。
- 現在の IPC は 65531 byte ずつ base64 の JSON で往復する。GB 級では律速になるので、Tauri の raw byte IPC（Android の IPC byte body を
  受け付ける変更 #247 と同種）に 1 MiB 単位の読み書きを載せる。上限は platform adapter の bounded な操作として宣言する。
- source の変化は block の前後の size / mtime / 内容で検出し、変わったら**その版を破棄**する。未完了の root は公開しない。
- 重い処理（seal、hash、accumulate）は Worker で行う。unlock の秘密はメモリ内のみで、使ったら 0 で埋める。

### 4.7 同期の状態機械（snapshot 単位）

```
planned → sealing → uploading ─┬→ receipt-verified → readback-verified → committed
                               └→ failed-retryable / failed-refused
```

- 状態は device-protected な control record に、**pack ごと**に永続化する（既存の root / pack / origin と同じ置き場所）。
- `committed`（新しい forest root を control record に書く）は、**全 pack が readback-verified** のときだけ。部分的な root は公開しない。
- readback は pack 全体の GET と SHA-256 の一致。受領証（AWAI-3314、ビルドが公開鍵集合を固定しているとき必須）は検証するが、
  **retention や独立複製の証拠ではない**。sampled readback で退避を許す案は採らない。

### 4.8 退避と hydration（file 単位）

| 状態 | 意味 | 退避 |
|---|---|---|
| `local-only` / `dirty` / `syncing` | 未同期・変更あり・同期中 | 不可 |
| `clean` | 全 block が readback-verified で、local の内容も一致 | **可** |
| `pinned` / `open` | 利用者が禁止 / 開いている | 不可 |
| `remote-only` / `fetching` | 平文が local にない / 取得中 | — |
| `error` | 検証失敗・欠損 | 不可（人が見る） |

- 退避するのは**平文の file**。forest の root と block の label は残るので、読むときは path を解決して（snapshot key）、
  必要な block の label を導き、その block だけを取得する。取った block は CID と AEAD で検証する。
- 退避の前に、local の size / mtime / 内容を再確認し、新規・変更・中断中のものがあれば拒否する。
  **同期していないデータは決して消さない。削除と退避を区別する。** water mark と空き reserve は設定値で、SLO にしない（AWAI-2856）。
- 全体の復元は、各 block を検証してから staging に書き、**すべて検証できてから**公開する。既存のファイルは上書きしない。

### 4.9 外部通信、同意、サーバの認可

- 外部通信は既存の canonical broker だけを通す。native の HTTP 抜け道、app origin の API、redirect、silent fallback は作らない。
  操作ごとの同意で、endpoint・method/path・data category を示す。拒否すれば request は出さない。
- **pack が多いと、操作ごとの同意が成り立たない**: 1 GiB を 32 MiB で送ると PUT と readback の GET で約 64 回。
  案 A（pack を 256 MiB 級に上げて回数を減らす。契約は変えない。64 GiB には足りない）と、
  案 B（broker に **bounded batch** の操作を足し、「この endpoint へ最大 N 個・合計最大 B byte」を 1 回で承認する。
  shared runtime の変更で、owner 決定が必要）。**P1〜P4 は A で進め、B は別 issue（P6）に切り出す。**
  製品側で同意のロジックを複製・拡張しない。B が実現するまで、無人の大量退避は主張しない。
- 現状の Yataverse の pack protocol は**認証なし**（上限内の opaque な pack を誰でも保存できる）。pack の上限を上げる前に、
  書き込みの認可と quota が要る。**WNFS はこの課題の答えを持っている**: 書き込み権限を RSA accumulator の batch proof で示し、
  サーバは平文を読まずに検証する（仕様 §4.2〜4.4）。ただし wnfs-cljc は proof を**未実装**。
  実装までの暫定は、受領証設計 §8 の予約（`reserve`）と quota。**認可なしで上限だけを上げない。**

## 5. macOS

- macOS の Tauri build は AWAI-3256 で app 専用 directory の adapter ができている。次の 2 段に分ける。
  1. **選んだ folder の取り込み**: file picker と security-scoped bookmark で、利用者が選んだ folder を **read-only** に同期する。
     元のデータは変更せず、退避は取り込んだ複製の方にだけ行う。§4.3 により、大きな tree は archive 化した file として扱う。
  2. **File Provider**（AWAI-2857）: Finder に統合する最終形。Apple の materialized cache と二重にキャッシュしない。
     署名・entitlement が未確定なら blocked として記録する。
- 「Mac の `~/github/wt` を Drive に退避して空き容量を確保する」運用は、上の 1 と §4.9 の案 B（または運用上の許容）が揃った後に成立する。
  それまでのディスク枯渇の再発防止は、quota 付き APFS volume など、Drive に依存しない手段で別に行う。

## 6. head・鍵・復旧（変えないこと）

- 信頼済み root は引き続き、端末の control record にある。サーバ側の latest-head と fencing は別の gate（主張しない）。
- 鍵は現行のまま（端末ローカルの hybrid recipient。Passkey や Awai account の enrollment ではない）。
  **uninstall / clear-data / 鍵の喪失で remote の snapshot が読めなくなり得る。** GB 級を退避する前に、
  recovery の導線か、明示的な警告と承諾を必須にする。
- 初期化済みの namespace で control record がなく鍵の alias だけがあるときは、新しい identity を作らず拒否する。

## 7. 測定が必要なもの（推測で決めない。AWAI-3369）

| 測るもの | 理由 |
|---|---|
| **block あたりの `NameAccumulator`（accumulate + hash-to-prime）のコスト**（browser の BigInt / pinned provider、Android と macOS） | §4.2。64 GiB 級（約 26 万 block）の可否を決める |
| forest（HAMT）の件数に対する構築・走査・lazy load の時間とメモリ | §3 の bound の引き上げの根拠 |
| WebView ごとの `fetch` の request streaming の可否（Android API 35、macOS の WKWebView） | §4.5。既定は Blob / `Uint8Array` の PUT |
| 1 MiB 単位の raw IPC と、現行の 65531 byte × base64 の往復 throughput | §4.6 |
| seal / hash の throughput と peak RSS（pack 32 / 256 MiB、パイプライン深さ） | メモリの上限の見積り |
| 1 GiB / 10 GiB の同期・復元の所要時間と readback の費用（隔離した store） | 製品の SLO にしない |
| pack サイズと、通信断を入れたときの再送コスト | pack サイズの選定 |
| archive 化した tree（§4.3）の作成・展開の費用 | 大量の小さな file の扱い |

測定値は、設定・単位・source・coverage と一緒に Linear に記録する。測れなかった値は `unknown`。

## 8. 段階

各段階は別の issue と PR。**W は apex（`otehon/wnfs-cljc`）側、D は awai-os（`apps/drive`）側。**

| 段階 | 場所 | 内容 | 検証（受入の形） |
|---|---|---|---|
| **P0** | 両方 | 測定（§7） | 測定値と、できなかった測定の一覧 |
| **W1** | apex | 1 file / forest / 取り込みの bound を、streaming・lazy な前提で引き上げる（blockCount、HAMT の lazy 走査、loader） | 1 GiB 超の file の往復一致、RSS の上限、欠損・改変・短読の拒否。上流 corpus が引き続き一致 |
| **W2** | apex | in-place 更新と latest-revision の探索、履歴の検証 | 上流の Rust との相互読み出し、拒否 corpus |
| **W3** | apex | BLAKE3 対応の CAR index（range 取得） | block 単独の取得、不正な range の拒否 |
| **D1** | awai-os | Drive の同期形式を wnfs-cljc に載せ替え（v1 は読み取り専用で残す。copy-only 移行） | v1 の復元が変わらない、v2 の往復一致、負の対照 |
| **D2** | awai-os | 再開できる upload と commit（§4.7）、計画の表示 | 通信断・電源断・app 終了からの再開、部分 root が公開されない |
| **D3** | awai-os | file 単位の退避と block 単位の hydration（§4.8） | 空 cache からの復元の一致、dirty/pinned/open の保護 |
| **D4** | awai-os | macOS: 選択 folder の取り込み → File Provider | Mac の実機。元データを変更しない |
| **P6** | shared | broker の bounded batch の同意（§4.9 案 B） | shared runtime の変更。**owner 決定が必要** |
| **W4** | apex | 書き込み認可（membership / batch proof、writer 認可、fencing） | サーバが平文なしで検証、拒否 corpus |
| **P7** | — | 共有・失効、独立 node の複製、recovery | 別の gate（この設計の範囲外） |

## 9. 失敗と攻撃の見方（要点）

- **block の入れ替え・欠落**: label と CID と AEAD で検出する。**サーバが壊す・返さない**: CID / SHA-256 で検出し、`error` にして退避しない。
- **pack を途中まで上げて止まる**: root を公開しない。残った pack は未参照の opaque data（サーバ側の GC は別の gate）。
- **source が同期中に変わる**: 検出して版を破棄する。**メモリ・disk の枯渇**: backpressure と staging の admission、reserve を割らない。
- **誤削除**: 退避は `clean` の file だけ。元の folder の削除は行わない。
- **サーバの乱用（認証なし）**: §4.9。認可と quota の前に上限を上げない。
- **仕様との差**: 実装 profile（node 1.0.0）と仕様（0.2.0）の差は記録した上で、profile に従う。版の切り替えは owner 決定。

## 10. 未決定（owner 決定・調査が必要）

1. **bounded batch の同意**（§4.9 案 B）を shared runtime に足すか。足さないなら、無人の大量退避は成立しない。
2. **書き込みの認可**: wnfs-cljc の proof の実装（W4）まで、認証なしの現状のまま pack の上限を上げない。暫定の予約・quota をどうするか。
3. **recovery key**: GB 級を退避する前提として、導線か明示的な承諾を必須にするか。
4. **大きな directory**（§4.3）: archive 化を既定にするか、Awai 拡張の sharding を認めるか。
5. **変更される大きな file**（§4.4）: アプリ側の segment 規約を採るか、対象外にするか。
6. **block の大きさ**: Awai の既存 raw frame（65531 byte）と WNFS の 262,104 byte の関係。WNFS 準拠のため後者を採るが、移行時の整合を確認する。
7. pack / ページ / bound の具体的な値は、P0 の測定後に確定する。

## 11. 初版（PR #248）からの変更

| 初版 | 改訂 |
|---|---|
| 4 MiB の chunk、独自の封、AAD の規則 | WNFS の外部 block（≤ 262,104）。独自の暗号規則を作らない |
| 暗号化 paged manifest（独自の木） | WNFS の private forest（HAMT）と private node |
| 内容の MAC による chunk 単位の差分 | **不可**（仕様は内容が変わると key を作り直す）。§4.4 の扱いに変更 |
| pack 上限 128 MiB | wnfs-cljc の 256 MiB に合わせる（サーバの引き上げは認可が先） |
| サーバの認可は受領証設計の予約と quota | 長期は WNFS の書き込み proof（W4）。暫定は予約と quota |
| 段階 P0〜P7 | W（apex）と D（awai-os）に分けて切り直し |
