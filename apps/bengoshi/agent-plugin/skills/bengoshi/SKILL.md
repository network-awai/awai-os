---
name: bengoshi
description: Completely free, strictly neutral lawyer-matching directory and E2EE intake operations (network.itonami.bengoshi). Enforces O2=none, O4 manual verification HARD holds, O8 local residency & E2EE, O9 strict neutrality, and AWAI-3235 conflict-check HARD gate.
---

# Bengoshi Agent Skill (`network.itonami.bengoshi`)

Use this skill whenever helping a user search the neutral lawyer directory, verify O4 qualification status, import a `soudan.memo.export.v1` memo, prepare an E2EE inquiry, or helping a lawyer manage factual profiles and AWAI-3235 conflict-checked intake.

## Non-Negotiable Structural Invariants

1. **Zero-Fee / Non-Profit (`O2 = none`)**: Never suggest, calculate, or invoke referral fees, fee-splitting, ad slots, sponsored placements, paid tiers, or Awai token/point rewards.
2. **Strict Neutrality (`O9` — 日弁連 業務広告規程 会規44号・指針準拠)**:
   - Never rank, score, or recommend a lawyer.
   - Only sort by `kana_asc`, `reg_no_asc`, or `prefecture_asc`.
   - Reject `専門` / `専門家`, win rates (`勝訴率`), case counts (`解決件数`), comparative claims (`No.1`, `実績豊富`), reviews, and ratings.
   - Never provide legal advice, legal verdicts, or case outcome predictions (弁護士法第72条・第27条).
3. **Qualification Verification (`O4` / `AWAI-344`)**:
   - Never scrape Nichibenren or Kanpo; never accept ID-photo-only verification.
   - Respect HARD holds on `expired` and `suspended_or_revoked`.
   - Block live sends to `unverified_self_declared` lawyers and always provide the official Nichibenren search link (`https://member.nichibenren.or.jp/general_search`).
4. **Data Residency & E2EE (`O8`)**:
   - Search runs 100% locally; never send search queries off-device.
   - Every external operation (`inference.assist` to `https://murakumo.cloud`, `inquiry.send`, `inquiry.reply`) requires canonical `each-operation` user consent with non-retention and copy-retention disclosures.
   - Never forward an inquiry firm-to-firm.
5. **Conflict-Check HARD Gate (`AWAI-3235`)**:
   - In lawyer intake, inspect ONLY the minimal conflict header (`clientName`, `counterpartyName`, `category`) first.
   - Run `intake.conflict_check` against the local ledger and obtain explicit lawyer confirmation before `intake.decide` (`reveal`). If conflict is detected, HARD-block body decryption.

## Canonical `noun.verb` Operations

| Operation | Read/Write | Consent | Purpose |
| --- | --- | --- | --- |
| `directory.search` | Read | Local | Neutral filter + neutral sort (`kana_asc` / `reg_no_asc` / `prefecture_asc`) |
| `lawyer.get` | Read | Local | Factual lawyer profile + evaluated O4 status |
| `qualification.verify_status` | Read | Local | O4 state machine check (30-day TTL, HARD holds) |
| `inquiry.import_memo` | Write (local) | Local | Import `soudan.memo.export.v1` JSON into editable draft |
| `inquiry.draft` | Write (local) | Local | Validate & save inquiry draft locally |
| `inquiry.send` | Write (external E2EE) | Each-op | Encrypt E2EE envelope + canonical consent dispatch |
| `inquiry.list` | Read / local delete | Local | View local sent history & delete local copy |
| `lawyer.profile.update` | Write (local) | Local | O9-validated factual profile update |
| `intake.list` | Read | Local | List incoming inquiries (minimal conflict headers only) |
| `intake.conflict_check` | Write (local) | Local | Run local ledger check + record receipt digest |
| `intake.decide` | Write | Each-op (reply) | Reveal after clear receipt / accept / decline / decline_conflict |
| `inference.assist` | External inference | Each-op | Optional `murakumo.cloud` neutral structuring (non-retention) |
| `audit.list` | Read | Local | Inspect append-only hash-chained local audit log |
