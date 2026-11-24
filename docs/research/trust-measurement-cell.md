# Trust measurement cell — bounded consent grant (research-plans.md hypothesis 2)

Status: owner-approved to start 2026-11-24 (item 178). Fixture execution in
progress — initial synthetic run on non-deployed `d42d0922` was retained only
as a separate comparison claim; the primary metric now runs against the
vendored pin (`889239dc`) used by awai-os.

Reviewer: Organizer (readback). Final admission by owner as human research
lead. Reviewer independence: broker owner (Kotoba) ≠ Researcher ≠ Organizer.

## Owning broker (identified 2026-11-24)

- Repo: `kotoba-lang/kotoba`. Module:
  `lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js`
  (`createClientOperationBroker`, `prepareClientOperationRequest`,
  `clientEndpointAllowsRequest`, `effectiveClientOperations`; schema
  `kotoba.app.client-runtime.v1`).
- Owning bot: Kotoba (`Kotoba`).
- Primary fixture pin: `889239dc972a868ee9e824517aad07c343972e7d`
  (2026-11-23), as vendored in awai-os
  `otehon/shell/vendor/PINS.json`; runtime sha256
  `76bc0d8358ebcc62c3bf530c5958e9b9040184dd3b9c358b5cf38a0f4b17182c`
  (matches PINS; verified by `git cat-file` hash).
- Comparison pin (separate claim, non-deployed): `d42d092203eac885f4fccce8ce4b0fb97e49b400`
  (2026-11-12 main), runtime sha256
  `5a950051c484a992caba0ad9edff780938648f9cade0b18f2d016812742ee6fb`.
  Never mix comparison and deployed traces in one cell.
- Confirmation from broker owner (Kotoba) that `889239dc` is the current
  pin requested 2026-11-24; if a different value is recorded, use and cite it.
- Broker/endpoint traces are broker-owner artifacts; synthetic traces are
  marked `synthetic`, never mixed with real broker traces.

## Claims (draft rows only — not in prose)

- `TRUST-DELEGATION-MATCHED` — bounded grant permits authorized workflow.
- `TRUST-DELEGATION-MISMATCHED` — changed actor/operation/scope fails closed.
- `TRUST-DELEGATION-EXPIRED` — expired grant fails closed (fixed clock).
- `TRUST-DELEGATION-COMPARE` — d42d0922 vs 889239dc comparison (optional, separate).

## Cells (isolated, synthetic, no private data)

All 3 cells use the same HTTP operation kind (`net/http-get` with a declared
endpoint), so `clientEndpointAllowsRequest` and `prepareClientOperationRequest`
are judged on the same scope. No `browser-action` operations are used anywhere.
The harness invokes only `prepareClientOperationRequest` /
`clientEndpointAllowsRequest` / `effectiveClientOperations` — the HTTP
`fetch` step is never reached, so nothing is fetched over the network
(trace: `synthetic, no network activity`). The broker's consent-dialog step
(`createClientConsentHost`) is not exercised by this harness, so matched
acceptance here is the request-preparation/eligibility layer, not the
consent UI; consent wiring was covered earlier in the trusted-event-shim
note (`docs/research/trust-cells-harness-889.mjs`), which does not drive the
trusted Allow click headlessly — shimmed clicks would confirm wiring only,
never real user consent, and a real click would need gesture provenance.
Matched control must be accepted; refusals alone do not falsify.

1. **Matched:** `capability=net/http-get`, `service=svc`, `operation=read`,
   endpoint `https://svc.example/items` GET. Consent host requires trusted
   `MouseEvent` on Allow (`isTrusted`, `currentTarget === allow`). Headless
   shimmed events are marked "trusted-event shim": this cell confirms consent
   wiring only and is NOT an observation of real-user consent. A real click
   would require gesture provenance in the trace.
2. **Mismatched** (one factor at a time; factor in trace metadata):
   actor / operation / scope variants. Expect refuse; handler not invoked.
3. **Expired:** fixed clock injection. Record `inject_time` and `expiry`
   (inject + TTL) in trace; no real wait. Stub `performance.now` per the
   broker's arming check (`clock() >= armedAt`). Invoke after expiry → refuse.

Per cell: new claim ID, immutable evidence path, command, exact outputs,
inject/expiry timestamps, Organizer readback. Draft rows only.

## Falsifier

Handler executes a mismatched or expired request, or the matched valid
request is refused — either defeats the hypothesis for that workflow.

## Dependencies

None for preparation. For execution: broker owner (Kotoba) + fixture owner.
Independent of the 7735H BOOT-LAN second run and of `INSTALL-PC` /
`OTA-ENDTOEND` physical qualification (separate owner authorization).
