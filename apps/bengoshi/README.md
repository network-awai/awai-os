# Bengoshi (`network.itonami.bengoshi`) — Free, Strictly Neutral Lawyer-Matching Itonami Dapp

Completely free, non-profit, strictly neutral lawyer-matching itonami dapp + Tauri v3 app + bot profiles + MCP Apps / Agent Plugin / ACP surface.

> **Release Gate**: This implementation uses clearly marked synthetic sample lawyers (`990001`–`990006`) and staged/fail-closed relay dispatch. **Public release remains gated on Legal review and owner decision O10.**

## Structural Invariants (Enforced in Code, Schema, UI & Negative-Control Tests)

1. **Zero-Fee / Non-Profit (`O2 = none`)**:
   - Free for users, free for lawyers.
   - Zero referral fees, fee-splitting, ad slots, sponsored placement, paid tiers, or Awai token/point rewards.
2. **Strict Neutrality (`O9` — 日弁連 業務広告規程 会規44号・指針準拠)**:
   - Zero reviews, star ratings, win rates (`勝訴率`), case counts (`解決件数`), comparative claims (`No.1`, `実績豊富`), AI recommendations, or response-speed sorting.
   - Neutral sorting only: 五十音順 (`kana_asc`), 登録番号順 (`reg_no_asc`), 地域コード順 (`prefecture_asc`).
   - Factual fields only (mandatory Art. 9 `name` and `bar_association`); real-time validator rejects `専門` / `専門家` per 指針第3-12.
   - Runtime `directory_scope` switch (`tenant_only` safe default | `neutral_cross_firm`).
3. **Qualification Verification State Machine (`O4` / `AWAI-344`)**:
   - Zero scraping of Nichibenren or Kanpo; ID-photo-only verification is rejected.
   - Explicit 4-state `verification` machine: `unverified_self_declared`, `verified_manual_a2` (30-day TTL, `method: "manual_nichibenren_and_office_contact"`, `attestation_digest`), `expired` (**HARD hold**), `suspended_or_revoked` (**HARD hold**).
4. **Data Residency, E2EE & Zero `app origin` (`O8`)**:
   - All drafts, sent history, lawyer profiles, conflict ledgers, and audit logs live strictly in local device storage (`awai.shell.host.v1`). **Zero requests to `app origin`.**
   - Directory search runs 100% locally over the signed read-only synthetic fixture catalog.
   - Client-side E2EE (`RSA-OAEP-256` + `AES-256-GCM`, `bengoshi.e2ee.envelope.v1`) encrypts inquiries and replies before consent/dispatch. Relay is staged/fail-closed until an independently verified endpoint is configured.
   - Optional `inference.assist` (`https://murakumo.cloud`, configurable path `/v1/chat/completions`) uses canonical `kotoba-client-runtime.js` `each-operation` consent with explicit non-retention / no-training disclosure and `countryStatus: "pending"` (AWAI-3883). Declining keeps the app 100% functional offline.
   - Firm-to-firm forwarding (`O8` option C) is prohibited and rejected.
5. **Lawyer Conflict-Check HARD Gate (`AWAI-3235`)**:
   - Incoming encrypted inquiries expose ONLY minimal conflict-check headers (`clientName`, `counterpartyName`, `category`).
   - Local ledger conflict check + explicit lawyer confirmation receipt digest are required before body decryption/reveal. Detected conflicts HARD-block body reveal.

## 11 Views (`src/app.js`)

- **User-side (5)**: `search`, `profile.detail`, `contact.compose` (supports `soudan.memo.export.v1` import), `contact.consent`, `requests`
- **Lawyer-side (4)**: `lawyer.onboarding`, `lawyer.profile.edit`, `lawyer.inbox`, `lawyer.inquiry.detail`
- **Shared / Embedded (2)**: `audit`, `embed.mcp` (SEP-1865 `APP-01`–`APP-04` read-only sandboxed view)

## Shared `noun.verb` Operations, Agent Plugin, ACP & Bot Profiles

- Shared operations (`src/operations.js`): `directory.search`, `lawyer.get`, `qualification.verify_status`, `inquiry.import_memo`, `inquiry.draft`, `inquiry.send`, `inquiry.list`, `lawyer.profile.update`, `intake.list`, `intake.conflict_check`, `intake.decide`, `inference.assist`, `audit.list`.
- Agent Plugins v1.0.0: `agent-plugin/plugin.json`, `agent-plugin/mcp.json`, `agent-plugin/skills/bengoshi/SKILL.md`.
- Stdio MCP server: `scripts/mcp-server.mjs` (backed by `src/mcp-acp-adapter.js`).
- Bot profiles: `profiles/bengoshi-directory/itonami.edn`, `profiles/bengoshi-lawyer-intake/itonami.edn`.

## Build & Verification

```sh
cd apps/bengoshi
npm test                 # Unit & negative-control test suite
npm run build            # Produces self-contained static Web bundle in dist/ with pinned release.json
cd src-tauri && cargo check   # Verifies Tauri v3 host compilation & Android 16 KB build script
```

## Paths for Downstream Teams

- **Static Web bundle (for `https://bengoshi.itonami.app`)**: `apps/bengoshi/dist/`
- **Tauri v3 native host & Android 16 KB project**: `apps/bengoshi/src-tauri/`
- **Runtime descriptor**: `apps/bengoshi/app-descriptor.json`
- **Agent Plugin v1.0.0**: `apps/bengoshi/agent-plugin/`
- **Itonami bot profiles**: `apps/bengoshi/profiles/`
