# Fixtures copied from the awai-securities-ops itonami profile

From kotoba-lang/itonami-agent `dbe02237cd0704f20441c0f1f9523cd5e1000d19`
(PR #5, AWAI-3156), `itonami/profiles/awai-securities-ops/fixtures/`. The profile
builds them with kotoba-lang/kotoba lib/kotoba.swift at
`4e7fc2b8e2d46944ea6bb0047c5897a312b64ac0` (kotoba#1354, AWAI-3154); the XML
validates against the pinned ISO 20022 XSDs. All accounts and references are
fictional; the ISINs and BICs are published identifiers.

| File | Source path | sha256 |
|---|---|---|
| `sese023-receive-apmt.edn` | `requests/sese023-receive-apmt.edn` | `b83502ca41fa5a322e24bed0757ae0a9d817a4521db4dd941946f6a9a5b6245a` |
| `sese023-receive-apmt.xml` | `expected/sese023-receive-apmt.xml` | `469900ce41d529aad90aadf0c7261d99813d0576ddcb7401508094043398e904` |
| `semt002-statement.xml` | `messages/semt002-statement.xml` | `0c0bbf35ed04099b293ad45b7a48d10d02165e2c2aed3ad24ebd4bd3472f17d1` |
| `reconcile-holdings.edn` | `requests/reconcile-holdings.edn` | `98307cab0e6c18e09e549d938fa2f59a6654ed4a5e71bcd37dbeffbd2ab0b955` |
| `reconcile-holdings.result.edn` | `expected/reconcile-holdings.result.edn` | `7f22e76de05843fe0f59a6357d20ea00530e4cbf7fc0291266ee5e8f4c70aff6` |

This app must build the same sese.023 bytes from the same fields, rebuild the
semt.002 bytes from what it imports, and give the same holdings lines.
