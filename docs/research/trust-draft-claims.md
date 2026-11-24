# Trust cells — draft claim rows (append-only, MEASURED-ONCE, synthetic)

Broker (primary): `kotoba-lang/kotoba` @ `889239dc972a868ee9e824517aad07c343972e7d`
(main HEAD 2026-11-23; vendored awai-os `otehon/shell/vendor/PINS.json`, runtime
sha256 `76bc0d8358ebcc62c3bf530c5958e9b9040184dd3b9c358b5cf38a0f4b17182c`),
`lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js`
(schema `kotoba.app.client-runtime.v1`), owning bot Kotoba.
Comparison (separate claim, non-deployed): `d42d09220` (2026-11-12), 49211 B,
sha256 `5a950051c484a992caba0ad9edff780938648f9cade0b18f2d016812742ee6fb`.
Metric: reproducibility rate (independent readback match rate).
Harness: `research/trust-cells-harness-889.mjs` (vendored pin), isolated
synthetic (browser-action, no HTTP fetch, no network, no private data).
These rows are DRAFT until independent readback + owner admission;
do not promote into manuscript prose.

| Claim ID | Manuscript wording (proposed) | Operator / measurer | Researcher contribution (bot) | Bot verification date (JST) | Command / review method | Source revision + citation | Independent reviewer + readback | Final decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TRUST-DELEGATION-MATCHED | A bounded consent grant permits the authorized workflow (matched principal/operation/scope). MEASURED-ONCE (synthetic single run). | Synthetic harness (Researcher as measurer; broker owner Kotoba provides module) | MATCHED PASS: endpoint allows declared request; prepare resolves; operation in effective set | 2026-11-24 | `node research/trust-cells-harness.mjs` | kotoba-lang/kotoba `d42d09220`, `kotoba-client-runtime.js` | Pending Organizer readback | Draft (not admitted) |
| TRUST-DELEGATION-MISMATCHED | Changed actor/operation/scope fails closed (refused, handler not invoked). MEASURED-ONCE (synthetic single run). | Synthetic harness (Researcher) | MISMATCHED PASS: changed scope refused by allows=false + prepare throws; changed actor yields effective=0 | 2026-11-24 | same harness | same broker source | Pending Organizer readback | Draft (not admitted) |
| TRUST-DELEGATION-EXPIRED | ABSENT (MEASURED, synthetic harness exit 0 only as auxiliary): `kotoba-client-runtime.js` at `d42d09220` (49211 B) has no expiry/ttl concept; a grant's expiry cannot be enforced by this module. Bounded grant expiry is enforced by the separate revocation layer, not this file. | Reviewer-rejected as enforcement claim 2026-11-24 (tautology: harness filtered approved set itself). Original EXPIRED-PASS run withdrawn as an enforcement claim; absence measured by grep. | Absence measured by grep: `grep -n -iE "expir|ttl|revok"` matches only 2 unrelated comment lines (settled) at d42d09220, and only settled/revokeObjectURL mentions at 889239dc (200055 B); no expiry/ttl/revocation implementation. | 2026-11-24 | `grep -n -iE "expir|ttl|revok" lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js` (exit 0, unrelated hits only) | kotoba-lang/kotoba `d42d09220` / `889239dc972a868ee9e824517aad07c343972e7d` (comparison 200055 B) | Pending Organizer readback | Draft (absence claim; moved to (B) follow-up for real expiry enforcement) |

Metric note: reproducibility rate = 2/2 for enforced-behaviour cells (MATCHED/MISMATCHED); EXPIRED is an ABSENT finding measured by grep, excluded from the rate denominator.
