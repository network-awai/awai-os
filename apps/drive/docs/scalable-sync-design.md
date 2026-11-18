# Awai Drive — 大容量・多数ファイルでスケールする同期の設計（v2）

- 状態: **提案（設計のみ）**。実装も、性能・容量・durability の主張も含まない。
- 追跡: [AWAI-3357](https://linear.app/kotobalabs/issue/AWAI-3357)（親 AWAI-3253）。
- 対象: `apps/drive`（Tauri 3.0.0-alpha.6）。Android と macOS で共通の domain/policy（CLJC/CLJS）を使い、
  platform ごとの Rust/Kotlin/Swift は bounded な adapter だけに限る。
- 範囲外（別 issue）: 共有・失効、独立 node による耐久性、latest-head/fencing、owner 復旧、
  WNFS private tree、Native selfhost。ここで決めるのは「8 MiB / 1000 entry の snapshot 形式を、
  GB 級のファイルと多数のファイルに耐える形に置き換える設計」だけ。

## 0. 動機

2026-11-18、agent の成果物（`.agent-output`、VM image、ログ）でこの Mac のディスクが 214GB から 24GB まで減った。
成果物を Drive に長期保管し、同期を確認できたものだけを端末から退避できれば、増加を構造的に抑えられる。
しかし現在の Drive は 8 MiB を超えるものを同期も退避もできない（`docs/encrypted-sync.md`）。

この文書は、既存の取り組みと**重複させず**に、その差を埋める順序を決める。

| 既存の課題 | この設計との関係 |
|---|---|
| AWAI-2855 AwaiVol bounded streaming 取り込み | 「bounded read → chunk → pack → atomic root」の考え方を、Drive の client 側にも使う。AwaiVol の実装は置き換えない |
| AWAI-2856 検証付き自動退避と容量上限 | 退避の状態（§6）と water mark の考え方を、Drive の per-file 退避に採用する。同じ受入語彙を使う |
| AWAI-2857 macOS File Provider | macOS の local tier の最終形。Apple が管理する materialized cache と二重にキャッシュしない（§8） |
| AWAI-3256 macOS adapter（Done） | app 専用 directory の adapter。この設計の P5 の土台 |
| AWAI-3268 / 3314 保存受領証 | pack ごとの署名付き受領証の検証（§5）。receipt の意味は広げない |
| AWAI-3126 Yataverse の pack protocol | 受け側。pack の上限と認可の変更が必要（§9） |

## 1. 現状の上限と、それが守っているもの

数値はすべて `apps/drive` の現行コードと文書から読んだもの。**資源上限であり、性能・容量の保証ではない。**

| 上限 | 値 | 場所 | 守っているもの |
|---|---|---|---|
| snapshot 全体 | 8 MiB | `core/awai/drive/encrypted.cljc` | WebView の JS heap。snapshot 全体を 1 つの `Uint8Array` に載せる |
| snapshot の entry 数 | 1000 | 同上、`desktop.rs` `MAX_ENTRIES` | manifest を 1 つの block に載せる、1 directory の列挙 |
| raw frame | 65531 byte | owner-store `object-v2` | 既存の AwaiFS codec との互換 |
| CAR | ≤ 12 MiB / 4096 block | `PACK_LIMIT` | 1 回の PUT/GET の大きさ。サーバ側も 12 MiB |
| IPC の 1 回の読み | 65531 byte（base64 の JSON） | `sync.js` `vaultRead` | Tauri IPC の JSON 往復 |
| local の取り込み | 1 GiB / file | `domain.cljc` `fileBytes` | 現行の local tier |
| depth | 16 | 同上 | path の検査 |
| 応答 | 2048 byte（receipt） | `bounded-response.js` | 受領証の読み |

問題は、上の「snapshot 全体 8 MiB」「1 pack ＝ 1 snapshot」「1 manifest block」に集中している。
**file 単位**でも **chunk 単位**でも同期・退避・再開できないので、1 byte でも超えると全体が同期できない。

## 2. 目標と、目標にしないこと

目標:

1. 1 file が GB 級（まず 1 GiB 超、設計上は 64 GiB 級まで）でも、同期・復元・退避ができる。
2. 1 snapshot が数十万 entry でも、manifest を読み書きするコストが entry 数に比例しない（変更分だけ書く）。
3. 途中で止まっても（電源断、通信断、app 終了）、未完了の root を公開せず、続きから再開できる。
4. client のメモリは `chunk サイズ × パイプライン深さ` で上から抑える。file の大きさに比例させない。
5. 同期済みで検証済みの file / chunk だけを、file 単位で退避し、必要になったら chunk 単位で取り戻せる。
6. Android と macOS で、同じ manifest 形式・同じ状態機械・同じ policy を使う。

目標にしないこと:

- 新しい暗号方式、新しい canonical file schema。既存の Kotoba hybrid envelope、`seal-chunk` / `wrap-for-hybrid`、
  owner-store の raw frame と CARv1 / CIDv1（raw + sha2-256）を再利用する。
- 複数端末の同時書き込みの調停（latest-head / fencing）。この設計の head は「端末が持つ信頼済み root」のまま（§7）。
- 独立 node 間の複製や retention の証明。受領証は「この gateway が受けて読み戻した」ことしか示さない。

## 3. データの形（v2）

### 3.1 chunk

- file は固定長の **平文 chunk**（既定 4 MiB。`envelope` の既定と同じ。最後の chunk だけ短い）に分ける。
- chunk ごとに既存の `seal-chunk` で封をする。nonce は envelope の `epoch BE4 ‖ index BE8` の規則に従い、
  AAD に `file-id`、`chunk-index`、`chunk-count`、manifest の版を含める。**chunk の入れ替え・欠落・切り詰めを AEAD で検出する**
  ため。具体的な AAD の構成は P1 で既存の owner-store の規則に合わせて確定する（ここでは新しい規則を作らない）。
- 封をした chunk を、既存と同じ ≤ 65531 byte の raw frame の列にし、各 frame は CIDv1（raw, sha2-256）を持つ。
  chunk の CID は frame の CID の列から導く（frame 数は 4 MiB / 65531 ≈ 65 個）。

### 3.2 pack

- **pack ＝ 複数 chunk を束ねた CARv1**。サーバに送る単位であり、同時に再開・検証の単位。
- 目標サイズ: 既定 **32 MiB**（`PACK_TARGET`）、ハード上限 **128 MiB**（`PACK_HARD`）。
  これは「1 回の PUT で WebView のメモリを圧迫しない大きさ」と「pack 数・往復数を減らす大きさ」の折衷の**提案値**。
  実機での測定（§10）の前に確定させない。
- pack の ID は従来どおり pack 全体の SHA-256（`/awai-drive/v1/packs/<64hex>`）。**既存の路線と受領証をそのまま使う**。
- 1 つの pack には、1 file の連続する chunk、または小さな file 複数を入れてよい。chunk は pack をまたがない。
- pack の末尾に CARv2 の index を付け、`chunk CID → pack 内の byte 範囲` を引けるようにする（§6.3 の range 取得）。

### 3.3 manifest（paged）

現行の `private-manifest-v1` は 1 つの暗号化 block で、全 entry を持つ。これを **ページ分割した木**にする。

```
root ─▶ manifest page (encrypted, ≤ 1 MiB) ─▶ child page … ─▶ leaf page
                                            leaf: entry = {name, kind, size, mtime?, mode?,
                                                          chunks: [ {cid, pack, range, len} … ] }
```

- ページは暗号化する（名前、path、hash、metadata、chunk 一覧は秘匿。現行と同じ秘匿の範囲）。
- 木は **sorted-key の木**（prolly tree 型を推奨。既存の `kotobase-index-prolly` の考え方と揃える。実装は新しく作らず、既存の
  canonical な実装を使えるか P2 で確認する）。entry の追加・変更は、影響を受けたページと root だけを書き換える。
- 1 ページの entry 数・byte 数に上限を持つ（提案: ≤ 1 MiB / ≤ 4096 entry）。**snapshot 全体の entry 数の上限は持たない**
  代わりに、**manifest page の読み出しを 1 ページずつ・bounded に**行い、全 entry を同時にメモリに載せない。
- root は manifest 版（`awai.drive.manifest.v2`）を持つ。**v1 の snapshot（単一 pack、≤ 12 MiB）はそのまま復元できる**。
  v1 の root を v2 として読まない、v2 の root を v1 として読まない（古い root への黙った fallback はしない）。

### 3.4 重複排除

chunk の暗号化は鍵と nonce で乱数的なので、**別 file・別 snapshot 間の chunk の重複排除はしない**（秘匿を優先）。
同じ file の**変更のない chunk**だけは、前の版の chunk（CID・pack・range）をそのまま manifest に引き継ぐ（再アップロードしない）。
chunk が変わったかの判定は、平文 chunk の鍵つき MAC（manifest 内に暗号化して保持）で行い、平文の hash を外に出さない。

## 4. client のパイプライン

```
source file ─(bounded read)→ chunker ─→ sealer ─→ packer ─→ uploader ─→ verifier ─→ manifest writer
 (64 KiB→1 MiB IPC)       4 MiB      AEAD     32 MiB CAR     PUT        GET+SHA       paged tree
```

- すべて **backpressure 付き**。上流は下流が空くまで読まない。段ごとの最大 buffer の総和が、メモリの上限（§10 で測る）。
- **IPC を大きくする**: 現在は 65531 byte ずつ base64 の JSON で往復している。GB 級では律速になる。Tauri の raw byte IPC
  （`awai_fs_put` が Android の IPC byte body を受け付けるようになった #247 と同種の経路）に、1 MiB 単位の読み書きを載せる。
  上限は platform adapter の bounded な操作として宣言する。
- **source の変化の検出**: chunk を読む前後で size / mtime / （必要なら）平文 MAC を確認し、変わったら chunk を破棄して
  その file を「変更あり」として扱う。**未完了の root は公開しない**（AWAI-2855 の受入と同じ）。
- **重い処理（sealing、hash）は Worker** で行い、UI のスレッドを塞がない。
- 暗号の秘密（unlock secret）は従来どおりメモリ内のみ。chunk ごとに使い、終わったら 0 で埋める。

## 5. 転送と同意（外部通信）

### 5.1 保つこと

- 外部通信は **既存の canonical broker**（`kotoba.app.client-runtime.v1`）だけを通す。native の HTTP 抜け道、
  app origin の API、redirect、silent fallback は作らない。
- 操作ごとの同意で、endpoint・method/path・data category を示す。拒否すれば request は出さない。
- 受領証は pack ごとに検証する（ビルドが公開鍵集合を固定しているとき必須、AWAI-3314 の判断に従う）。
  **受領証は retention や独立複製の証拠ではない**（意味を広げない）。

### 5.2 問題: pack 数が多いと「操作ごとの同意」が成り立たない

1 GiB を 32 MiB の pack にすると 32 回の PUT と、readback の 32 回の GET。64 回の同意の提示は使えない。
一方、「1 回の承認が他の操作を許可しない」という契約は変えられない。次の 2 案を比較する。

| 案 | 内容 | 利点 | 欠点・条件 |
|---|---|---|---|
| **A. 大きな pack で回数を減らす** | pack を 128 MiB 級に上げて、操作数を 1/4 にする | 契約を変えない | 1 GiB でも 16 回。64 GiB は無理。メモリ・再送のコストが増える |
| **B. bounded batch の操作を broker に足す** | 「この endpoint に、最大 N 個の pack、合計最大 B byte、この id 集合だけ PUT/GET する」を**1 つの操作**として宣言し、1 回の同意で承認する | 回数に依存せずスケールする | **shared runtime（`kotoba-client-runtime.js`）の変更**。契約の拡張なので owner 決定が必要 |

**推奨: P1〜P4 は A（契約を変えずに進められる）。B は P6 として別 issue に切り出し、owner 決定を待つ。**
製品側で broker の同意ロジックを複製・拡張しない（共有契約の禁止事項）。B が実現するまで、**無人で大量に退避する運用は主張しない**。
同意の画面に出す量（pack 数、合計 byte、endpoint）を、承認の前に計画として確定させて表示する設計だけ、P3 で用意する。

### 5.3 streaming upload の可否は未検証

- WebView の `fetch` で request body に `ReadableStream` を使うには HTTP/2 以上と `duplex: 'half'` が要る。
  Android の WebView（Chromium）は可能性があるが、macOS の WKWebView は request body の streaming を**期待しない**。
- よって既定は **pack を `Blob` / `Uint8Array` にして PUT する**（pack ≤ 128 MiB が上限の理由の一つ）。
  streaming はあとから最適化として足せる。**どの WebView で何ができるかは P0 で測る**（推測で設計を固定しない）。

## 6. 状態機械

### 6.1 upload（snapshot 単位）

```
planned → chunking → packing → uploading ─┬→ receipt-verified → readback-verified → committed
                                          └→ failed-retryable / failed-refused
```

- 状態は **device-protected な control record**（現行の root / pack / origin と同じ置き場所）に、pack ごとに永続化する。
  再開は「`uploading` の pack のうち receipt-verified でないものだけをもう一度 PUT」。pack は ID（SHA-256）で冪等。
- `committed`（新しい root を control record に書く）は、**全 pack が readback-verified** になったときだけ。
  部分的な root は絶対に公開しない（AWAI-2855 の受入、既存の「欠けた・壊れた・部分のデータは拒否」と同じ）。
- readback は **pack 全体の GET と SHA-256 の一致**。「HTTP 2xx」や「受領証」だけでは readback-verified にしない。
  readback の量が問題になる場合は、段階（`receipt-verified` と `readback-verified`）を分けて表示し、退避の条件は
  `readback-verified` のままにする。**sampled readback で退避を許す案は採らない**。

### 6.2 file の local tier（AWAI-2856 の語彙に揃える）

| 状態 | 意味 | 退避 |
|---|---|---|
| `local-only` | まだ同期していない | 不可 |
| `dirty` | 同期後に変更された | 不可 |
| `syncing` | upload 中 | 不可 |
| `clean` | 全 chunk が readback-verified で、local の内容も一致 | **可** |
| `pinned` | 利用者が退避を禁じた | 不可 |
| `open` | 開いている / 書き込み中 | 不可 |
| `remote-only` | local に平文がない（退避済み） | — |
| `fetching` | 取得中 | — |
| `error` | 検証失敗・欠損 | 不可（人が見る） |

- 退避は **file 単位**。退避の前に、現在の local の size / mtime / 内容 MAC を再確認し、新規・変更・中断中の `.pending-*` があれば拒否する
  （現行の native adapter の検査を file 単位に細かくする）。**同期していないデータは決して消さない。削除と退避を区別する。**
- 退避の開始・停止は **high / low water mark と空き reserve の設定値**で決める。値は設定であり、未承認の SLO を作らない（AWAI-2856）。

### 6.3 hydration（取り戻し）

- 開く・読むときは、必要な **chunk だけ**を取得する。pack の index で byte 範囲を引き、HTTP `Range` で取る
  （route は query なし。`Range` header の許可はサーバ側 CORS と合わせて P4 で確認する）。取った chunk は CID（frame ごとの hash）と AEAD で検証する。
- 全体の復元（今の `restore`）は、manifest を 1 ページずつ検証してから、file ごとに staging へ書き、
  **すべて検証できてから**公開する。既存ファイルは上書きしない。staging の書き込みには、合計・entry・reserve の admission を設ける。

## 7. head・復旧・鍵（変えないこと）

- **信頼済み root は引き続き、端末の control record**にある。サーバ側の latest-head と fencing は別の gate（ここで主張しない）。
- 鍵の管理は現行のまま（端末ローカルの hybrid recipient。Passkey や Awai account の enrollment ではない）。
  **uninstall / clear-data / 鍵の喪失で remote の snapshot が読めなくなり得る**。独立した recovery-key の export は未実装で、
  GB 級のデータを退避する前に、この未解決のリスクを**利用者に明示**する（§9 の前提）。
- 初期化済みの namespace で control record がなく鍵の alias だけがあるときは、新しい identity を作らず拒否する（現行と同じ）。

## 8. macOS

- macOS の Tauri build は、AWAI-3256 で app 専用 directory の adapter ができている。この設計の P5 は次の 2 段に分ける。
  1. **選んだ folder の取り込み**: file picker + security-scoped bookmark で、利用者が選んだ folder を **read-only** に同期する
     （元のデータは変更しない。退避は取り込んだ**複製**の方にだけ行い、元の folder は消さない）。
  2. **File Provider**（AWAI-2857）: Finder に統合する最終形。Apple が管理する materialized cache と二重にキャッシュしない。
     署名・entitlement が未確定ならこの段は blocked として記録する。
- 「Mac の `~/github/wt` を Drive に退避して空き容量を確保する」運用は、**P5(1) + P6 の後**に成立する。
  それまでの間のディスク枯渇の再発防止は、quota 付き APFS volume など、Drive に依存しない手段で別に行う。

## 9. サーバ（Yataverse）と運用上の前提

- 現状の pack protocol は **認証なし**で、pack ≤ 12 MiB、CAR の blocks がその CID と一致することを検査する。
  「誰でも上限内の opaque な pack を保存できる」。**上限を 128 MiB に上げる前に、書き込みの認可と quota（予約）を設計する必要がある**
  （受領証設計 §8 の `reserve(pool, request-id, quota, expiry)` と `YataverseReservation`）。認可なしで上限だけを上げない。
- 上限の変更（`DRIVE_MAX_PACK_BYTES`）、`Range` の許可、CORS（`DRIVE_ALLOWED_ORIGINS`）は Yataverse repo の別 PR。
- 受領証の `retentionUntil` は 0（保持の保証なし）。**この状態で「退避して消す」ことは、保存先の gateway を信頼する判断**であり、
  独立複製が実現するまでの残余リスクとして、退避の確認画面に明示する。
- 鍵を失うと読めなくなる（§7）。GB 級の退避を許す前に、recovery の導線（または明示的な警告と承諾）を必須にする。

## 10. 測定が必要なもの（推測で決めない）

| 測るもの | 理由 | 方法 |
|---|---|---|
| WebView ごとの `fetch` の request streaming 可否 | §5.3 | Android（API 35）の VM と、macOS（WKWebView）で最小の PUT |
| 1 MiB の raw IPC の往復の throughput | §4 | 現行の 65531 byte × base64 との比較 |
| seal / hash の throughput と peak RSS | メモリの上限の見積り | 4 MiB chunk、pack 32 / 128 MiB、パイプライン深さの比較 |
| 1 GiB / 10 GiB の同期・復元の所要時間と readback の費用 | 段階の目安 | 隔離した store。**製品の SLO にしない** |
| pack サイズと失敗時の再送コスト | `PACK_TARGET` / `PACK_HARD` の選定 | 通信断の注入 |
| manifest のページサイズと木の高さ | 1 ページ ≤ 1 MiB の妥当性 | 10 万 / 100 万 entry の合成データ |

測定値は、設定・単位・source・coverage と一緒に Linear に記録する。測れなかった値は `unknown`。

## 11. 段階（実装 issue の切り分け）

各段階は別の issue と PR。前の段階の検証が終わる前に次へ進まない。

| 段階 | 内容 | 検証（受入の形） | 備考 |
|---|---|---|---|
| **P0** | 測定の基盤（§10）。実装は変えない | 測定値と、できなかった測定の一覧 | AWAI-2855 と測定方法を揃える |
| **P1** | chunk + pack v2（client のパイプライン、1 MiB raw IPC、Worker、backpressure）。manifest はまだ v1 の 1 block | 8 MiB 超・1 GiB 級の file の往復一致、RSS の上限、source 変化・短読・書込失敗で root が公開されない | 小さい snapshot は v1 のまま復元できる |
| **P2** | paged manifest（木）。entry 数の上限を外す | 10 万 entry の同期・差分更新・復元。変更分だけが書き換わる | 既存の prolly の実装を使えるか確認 |
| **P3** | 再開可能な upload と commit。pack ごとの状態・受領証・readback、計画の表示 | 通信断・電源断・app 終了からの再開、二重 PUT の冪等、部分 root が公開されない | 同意 UI は §5.2 案 A の範囲 |
| **P4** | per-file の退避と chunk 単位の hydration | 空 cache からの復元の bytes/ID 一致、dirty/pinned/open の保護、remote 欠損・破損・容量不足・再起動 | AWAI-2856 と受入を共有 |
| **P5** | macOS: 選択 folder の取り込み → File Provider | Mac で実機の確認（元データを変更しない）。entitlement 未確定なら blocked | AWAI-2857 と調整 |
| **P6** | broker の bounded batch の同意（§5.2 案 B） | shared runtime の変更。契約と拒否の負の対照 | **owner 決定が必要** |
| **P7** | head / fencing、独立 node での複製、recovery、共有 | 別の gate | この設計の範囲外 |

## 12. 失敗と攻撃の見方（要点）

- **chunk の入れ替え・欠落・切り詰め**: AAD に file-id / index / count を入れ、manifest の木の root で束ねる。
- **サーバが pack を返さない・壊す**: pack の SHA-256 と frame の CID で検出。`error` にして退避しない。
- **pack を途中まで上げた状態で止まる**: root を公開しない。残った pack は未参照の opaque data（サーバ側の GC は別の gate）。
- **source が同期中に変わる**: chunk の前後確認で検出して破棄。
- **メモリ・disk の枯渇**: backpressure と staging の admission で抑える。退避は reserve を割らない。
- **誤削除**: 退避は `clean` の file だけ。元の folder の削除は P5 では行わない。
- **サーバの乱用（認証なし）**: §9。認可と quota の前に上限を上げない。

## 13. 未決定（owner 決定・調査が必要）

1. **bounded batch の同意**（§5.2 案 B）を shared runtime に足すか。足さないなら、無人の大量退避は成立しない。
2. **書き込みの認可と quota**（§9）。認証なしの現状のまま pack の上限を上げない。
3. **recovery key** の扱い。GB 級を退避する前提として、導線か明示的な承諾を必須にするか。
4. manifest の木の実装（既存の prolly を再利用できるか）。
5. `PACK_TARGET` / `PACK_HARD` / chunk サイズ / ページサイズの確定（P0 の測定後）。
