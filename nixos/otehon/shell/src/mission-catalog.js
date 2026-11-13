// Mission-derived coordination assignments, AWAI-2863. No execution grants.
export default {
  "schema": "awai.mission-catalog.v1",
  "date": "2026-11-13",
  "issue": "AWAI-2863",
  "parentInitiative": "I-2",
  "goals": [
    {
      "key": "bot-work",
      "name": "Itonami — Bot協働で人の時間を取り戻す",
      "summary": "Botチームで日常業務を完了し、人が成果と主導権を持つ。",
      "lead": "circle:product:itonami",
      "support": [
        "circle:product:communication",
        "circle:simulation"
      ],
      "acceptance": "利用者が受け入れた業務成果、確認・修正時間、再作業率を同じ期間で記録する。業務シミュレーションや対話完了を実業務成果に数えない。",
      "projects": [
        "6f474529-6670-43ff-922f-0c1f06865f63",
        "40a48fc3-99a2-4749-872a-500660a78e8b"
      ],
      "sources": [
        "https://itonami.cloud/",
        "https://itonami.cloud/mission/"
      ],
      "linear": {
        "id": "I-12",
        "uuid": "8d8c06b8-186b-4c58-92f6-ee315862f553",
        "url": "https://linear.app/kotobalabs/initiative/itonami-bot協働で人の時間を取り戻す-448c9b41a481"
      }
    },
    {
      "key": "distributed-foundation",
      "name": "Awai — 分散計算・保存・通信を復旧可能にする",
      "summary": "利用者が推論・保存・通信を使い、独立node間で状態を継続・復旧できるようにする。",
      "lead": "circle:platform:persistence-runtime",
      "support": [
        "circle:product:inference",
        "circle:product:data-knowledge",
        "circle:engineering:language-os",
        "circle:product:communication"
      ],
      "acceptance": "独立nodeで保存readback・復元・旧writer拒否・失敗回復のreceiptを確認する。推論/保存/通信とNative/Otehonは別々に資格化する。",
      "projects": [
        "9e7bb7b1-76bc-4bdd-882c-7aed66488f80",
        "fe847d8f-9522-44cb-b247-7970ace38ac8",
        "65f03194-7199-4a30-b5d2-f61231cb45a9"
      ],
      "sources": [
        "https://awai.network/"
      ],
      "linear": {
        "id": "I-13",
        "uuid": "e8196c1d-c288-4211-afc2-b4457d770f2c",
        "url": "https://linear.app/kotobalabs/initiative/awai-分散計算保存通信を復旧可能にする-636869962bbe"
      }
    },
    {
      "key": "use-create-share",
      "name": "Awai — 使う・創る・共有する体験を届ける",
      "summary": "AI・アプリ・作品を試し、制作し、共有し、改善を返せる参加導線を育てる。",
      "lead": "circle:engineering:repo-delivery",
      "support": [
        "circle:product:itonami",
        "circle:product:inference",
        "circle:product:data-knowledge"
      ],
      "acceptance": "公開アプリでの初回成果・共有/持ち出し・フィードバック反映・多言語操作を利用者証跡で測る。Aozora/Isekai専任Botは未配置で、現Circleの連携担当として開始する。",
      "projects": [
        "6f474529-6670-43ff-922f-0c1f06865f63",
        "44128877-8408-4518-a69a-ac78330a3e72"
      ],
      "sources": [
        "https://awai.network/"
      ],
      "linear": {
        "id": "I-14",
        "uuid": "b3158de0-6f9a-41dd-bc1c-b62b3e5451f6",
        "url": "https://linear.app/kotobalabs/initiative/awai-使う創る共有する体験を届ける-a1c54d7b1047"
      }
    },
    {
      "key": "verified-contribution",
      "name": "Awai — 貢献と価値交換を検証可能につなぐ",
      "summary": "フィードバック・開発・創作・資源提供から検証された成果と利用を記録し、合意した条件へつなぐ。",
      "lead": "circle:platform:fleet-reliability",
      "support": [
        "circle:engineering:security",
        "circle:engineering:repo-delivery",
        "circle:product:data-knowledge",
        "circle:simulation"
      ],
      "acceptance": "貢献→受入→利用receiptの対応、重複0の検証範囲、障害復旧と原価の計測範囲を記録する。資本・データ販売・Human Computing・host市場・自動精算は未利用可能/計画と実取引を区別する。",
      "projects": [
        "ea843d8f-729c-4445-9b1c-ee100f1b9566",
        "40a48fc3-99a2-4749-872a-500660a78e8b"
      ],
      "sources": [
        "https://awai.network/",
        "https://itonami.cloud/"
      ],
      "linear": {
        "id": "I-15",
        "uuid": "a472e5b3-63c8-4be9-b419-d52bedb7d937",
        "url": "https://linear.app/kotobalabs/initiative/awai-貢献と価値交換を検証可能につなぐ-c3a0e7e41993"
      }
    }
  ],
  "nativeLinearParentVerified": false,
  "peerBindings": [
    {
      "cycleKey": "9ce40f4db8c8e3e7c4554c8de810faf86e815c3bdf4593456b74d9f089b08ee9",
      "issueId": "AWAI-2862",
      "goalKey": "verified-contribution",
      "relationship": "coordination-alignment",
      "originalInitiative": "I-2",
      "usageOwner": "AWAI-2862"
    }
  ]
};
