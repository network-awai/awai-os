# Fixtures copied from the awai-banking-ops itonami profile

From kotoba-lang/itonami-agent `cf6168a579fd3f44f9668165fd8efd27feac7e3b`
(PR #4, AWAI-3155), `itonami/profiles/awai-banking-ops/fixtures/`:

| File | Source path | sha256 |
|---|---|---|
| `pain001-eur-single.edn` | `requests/pain001-eur-single.edn` | see `model.test.mjs` |
| `pain001-eur-single.xml` | `expected/pain001-eur-single.xml` | `2b40693ca1449db217ffe2e377693817a82f08a2675bf3c17d417822be7b5a8b` |

The XML is what kotoba-lang/kotoba lib/kotoba.swift (pinned at
`2e3b9ef25f06ef98924daa450c36da1b7c712189`) emits for the request, and it
validates against the pinned ISO 20022 XSD. This app must build the same bytes
from the same fields. All values are fictional test values.
