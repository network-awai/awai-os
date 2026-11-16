# SoshikiのGoalsとCircle運用 — Holaspirit API参照

2026-11-13 / AWAI-2808 / PR95。前段の[Circle情報設計](soshiki-circle-information-architecture-20261113.md)を補う。ユーザーは10 Circle案を表示へ反映することを指示した。本unitは責任分類とGoal案の表示までを実装し、実行権限・cron・未有効Bot・正式governance正本の移行は変更しない。

## HolaspiritにGoalsはあるか

ある。[公式ナビゲーション案内](https://help.holaspirit.com/en/article/how-to-use-secondary-navigation-i7nbv6/)ではProjectsとOKRsを統合し、OKRsをGoalsへ改称している。この案内はExperimental Featuresの説明であり、全tenantで既定有効とは断定しない。公開APIは引き続き`/okrs`と`Objective`/`KeyResult`の名称を持つ。

[公式作成ガイド](https://help.holaspirit.com/en/article/how-to-add-edit-or-delete-an-okr-nq3sz3/)では、Circle、担当Role、期間、測定するKey Result、関連Project、関連Goalを分離する。[階層の説明](https://help.holaspirit.com/en/article/visualize-the-okr-hierarchy-1iarh3u/)では他Circleや会社のGoalへの関連を表す。組織の所有treeとGoalの貢献関係は同一のものではない。

## 公開OpenAPIで確認した参考対象

出典は[公式Swagger](https://app.holaspirit.com/api/doc/)。前unitで取得した2026-11-13版の公開schema SHA256は`f05d4ae896f21d2fa868d12dcca3f88f40398312d92117e8f7a731edebd49d07`。認証つきtenantへの接続・書込みは行っていない。

| 対象 | 確認したAPI / schema | Soshikiへの採用方針 |
|---|---|---|
| Goals | `GET /api/organizations/{organization_id}/okrs`、`GET /okrs/{okr_id}` / Objective | Circle/Role、parent/children、tasks/results、timeframe、confidence、contextを分離 |
| 数値成果 | `POST /okrs/{okr_id}/results`、`PATCH /okrs/{okr_id}/results/{result_id}` / KeyResult | start/end/progression、unit相当suffix、weight/confidence。実測値・対象期間・証跡をSoshikiで追加 |
| Projectとの接続 | `POST /tasks/{task_id}/okrs` / Objective.tasks | LinearのProject/Issueを明示bind。HolaspiritのTaskをLinear Issueと自動同一視しない |
| 定期確認 | `GET /checklists` / Checklist | recurrence、lastCheckDate、Circle/Role。cronによる実行と、人の確認チェックを区別 |
| 指標 | `GET /metrics` / Metric | 指標定義・担当・確認周期を分離。公開Metric schemaには数値時系列そのものは記述されていないため、API対応だけで測定済みにしない |
| 改善課題・構造変更 | `GET /tensions` / Tension | 状態・Circle・提案・決定履歴を参考に、Linear Issueと変更提案を接続。Botの自己承認を作らない |
| 関連/階層ビュー | `GET /node-okrs` | Goalの貢献関係を表示する参考。署名なしのgraphを権限継承に使わない |
| 組織 | Circle/Role/AssignedMember/Domain/Policy | 前段の責任Circleモデル。BotとRoleは別のID |

表の短縮pathは`/api/organizations/{organization_id}`を前置する。公開APIに存在することと、現tenantで利用できることは別。旧schemaとchangelogの差分は前段設計に記録済み。

## Soshikiの情報構造

- Purpose: Role/Circleが継続して存在する理由。
- Goal: 特定期間に得たい成果。`id, scopeCircleId, ownerRoleId, status, timeframe, relatedGoalIds, workBindings`を持つ。
- KeyResult: `metricDefinitionId, baseline, target, current, unit, direction, weight, confidence, evidenceRefs, window, coverage`。欠測はnull。分母・期間・単位の違う指標を平均しない。
- MetricDefinition/Observation: 定義と測定値を分離。run ID、source revision、観測時刻、coverageにbind。設定数・最新receipt数・成功率・uptimeは別の指標。
- Project/Issue: 実際に取り組む仕事と受入条件の正本はKotoba LabsのLinear。Initiative→Project→Issueは参照リンクで保持し、Circleのtreeと無理に一対一にしない。
- Checklist: 定期確認項目。cron Cycleは実行機会、Checklist完了は確認行為、KeyResultは成果。三つを同じ進捗にしない。
- Tension/ChangeProposal: 現状と目的の差を起点に、改善Issue・提案・決定・変更を追跡。

Goalの親子は将来`relatedGoalIds`で貢献関係を持ち、循環を拒否する。現表示の`parentGoalId`はナビゲーション上のscope親を示すだけで、Goal承認や重み付き進捗のrollupは未実装。未測定の子Goalを除外して親を100%にする集計も行わない。

## 今回反映した画面

既定の「責任Circle」では、運用基盤・開発と品質・製品とサービス・物理/産業・配置確認の5分類から10責任Circleへ進める。Fleet信頼性9 Botは4業務Roleへ、physics683 Botは7分類へ表示整理する。全899 Actorは重複なく保持し、新しい未対応Actorは配置確認へ入れる。元repo、元cron、runtime grantは変えない。

全体では構造を読みやすくするため分野を均等重みで配置する。面積は人数比ではない。Circleの色リングは所属Botの観測状態の内訳で、Botの実行中やGoal達成度ではない。Bot個別の小円/cronアニメーションはCircleを開くと確認できる。検索は構造を変えず強調する。

「App・リポジトリ分類」では元761 repo分類とブラウザーに保存済みのOrg in Org編集を確認できる。元データは保存したまま、責任分類とは独立させた。

「Goals一覧」およびCircle選択欄に、目的から作ったGoal案、2つの成果確認軸、設定済み/未有効/Issue対応数、元Issueへのリンクを表示。成果確認軸は「責任に対応する成果の受入証跡」「異常・重複実行からの復旧」。期間・担当Role・数値目標は未確定、実測値/達成率はnull。これを正式なOKRや達成済み成果として登録しない。Goalの作成/編集/共有永続化・Holaspirit接続・LinearへのGoal自動同期は今回の実装には含まない。

Goal数値を設定する次の工程では、各Circleの既存Issueの受入単位、対象run/window、測定源、baselineを先に確認する。Bot設定589/899を「安定稼働65.5%」に読み替えない。重複0や復旧時間も完全な観測coverageなしに0としない。

## 保存・権限の境界

責任対応表は静的アプリartifactに含む表示分類。正本catalogのCircle IDと既存local overlayは保持する。共有governance snapshotのAwaiFS署名・CAS・競合解決は引き続き未実装。ブラウザーは静的artifactのみを読み、origin側にGoal APIや同期queueを追加しない。将来のHolaspirit/Linear直接操作はcanonical brokerの宣言・fresh consent・DTO allowlistが必要。
