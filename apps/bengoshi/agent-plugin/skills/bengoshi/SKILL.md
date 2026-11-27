---
name: bengoshi
description: POC/Draft skill for Bengoshi — 弁護士検索ガイド・中立ディレクトリ（準備中） (network.itonami.bengoshi). Enforces O2=none (fee_jpy=0), O4 manual verification HARD holds, O8 zero-external-calls & Method A direct handoff, expanded O9 strict neutrality, Art. 11 3-year export, and AWAI-3235 conflict-check HARD gate.
---

# Bengoshi Agent Skill — POC / Draft (`network.itonami.bengoshi`)

> **Status**: POC / Draft (does not claim formal `AWAI-4143` conformance yet). All bundled directory records are synthetic samples (`synthetic: true`, `.invalid` domains). For real lawyers, direct users to official public search resources (Nichibenren, Himawari Search, Houterasu, Bar Association Consultation Centers).

## Non-Negotiable Structural Invariants

1. **Zero External Network Calls (`app-descriptor.json` `"operations": []`)**:
   - Zero external inference calls from the app or MCP tools.
   - Primary contact flow is **Method A** (direct transition to lawyer's public office URL / `mailto:` / `tel:` + 7-line `contact.format_manual` Copy Contact + Copy Draft; zero platform server relay).
2. **Zero-Fee / Non-Profit (`O2 = none`, `fee_jpy: 0`)**:
   - Free for users and free for lawyers; zero ads, paid tiers, fee-splitting, or token rewards.
3. **Expanded Strict Neutrality (`O9` — 日弁連 業務広告規程 会規44号・指針準拠)**:
   - Never rank, score, or pick a lawyer. Only sort by `kana_asc`, `reg_no_asc`, or `prefecture_asc`.
   - Always preserve Art. 9 mandatory fields (`name`, `bar_association`), neutral disclaimer, and the agent non-recommendation guard in non-UI fallbacks.
   - Reject prohibited promotional wording, reviews/stars, scout/reverse-offer, and online retainer signing.
   - Never provide legal advice, legal verdicts, or outcome predictions (Attorneys Act Art. 72 & 27).
4. **Qualification Verification (`O4`) & Art. 11 Preservation**:
   - Zero Nichibenren/Kanpo scraping; zero ID-photo-only verification.
   - Respect HARD holds on `expired` and `suspended_or_revoked` (blocks `contact.format_manual` and inquiry actions).
   - Provide `lawyer.export_art11_record` for 3-year preservation under Advertising Rules Art. 11 (enforced 2026-07-01).
5. **Conflict-Check HARD Gate (`AWAI-3235`, local preview / offline import only)**:
   - Inspect only minimal conflict headers (`clientName`, `counterpartyName`, `category`) first.
   - Require `intake.conflict_check` + explicit lawyer confirmation before `intake.decide` (`reveal`). Detected conflicts HARD-block decryption.

## Canonical `noun.verb` Operations (100% Local)

| Operation | Read/Write | Purpose |
| --- | --- | --- |
| `directory.search` | Read | Neutral local search (`kana_asc` / `reg_no_asc` / `prefecture_asc`) |
| `lawyer.get` | Read | Factual lawyer profile (Art. 9) + evaluated O4 status |
| `qualification.verify_status` | Read | O4 state machine check (30-day TTL, HARD holds) |
| `contact.format_manual` | Read | Format exact 7-line Method A manual Copy Contact (blocked on HARD hold) |
| `inquiry.import_memo` | Write (local) | Import `soudan.memo.export.v1` (`consultation-memo.jpn.v1`) JSON locally |
| `inquiry.draft` | Write (local) | Validate & save consultation draft locally |
| `inquiry.send` | Write (local) | Offline local E2EE preview envelope (zero server relay) |
| `inquiry.list` | Read / local delete | List or delete local records |
| `lawyer.profile.update` | Write (local) | Expanded O9-validated factual profile update + edit history |
| `lawyer.export_art11_record` | Read | Export Art. 11 3-year preservation snapshot + history (`fee_jpy: 0`) |
| `intake.list` | Read | List local offline preview inquiries (minimal headers only) |
| `intake.conflict_check` | Write (local) | Run local ledger check + record receipt digest |
| `intake.decide` | Write (local) | Reveal after clear receipt / record local accept or decline |
| `audit.list` | Read | Inspect append-only hash-chained local audit log |
