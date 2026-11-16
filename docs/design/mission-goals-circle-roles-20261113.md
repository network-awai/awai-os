# Mission, Goal and Circle assignments

Tracking: [AWAI-2863](https://linear.app/kotobalabs/issue/AWAI-2863). Observed 2026-11-13 JST. This is the owner's requested operational decomposition of the two public missions, not a claim that either website defines these four categories or that planned work is running.

Sources: [Itonami](https://itonami.cloud/), [Itonami mission](https://itonami.cloud/mission/), [Awai Network](https://awai.network/). Itonami describes Bots taking everyday work while people retain choice. Awai connects users, creators, developers and resource contributors, with use, creation, sharing and a proposed verification/compensation cycle. Both distinguish availability from planned economic participation. The Awai homepage was retrieved directly because the web reader could not open it; the dated local capture/hash is evidence, not a production execution receipt.

| Initiative / Goal | Lead Circle | Supporting Circles | Acceptance measure |
| --- | --- | --- | --- |
| I-12 Bot collaboration gives people time back | Itonami product | Communication, simulation | Accepted business output, review/correction time and rework over a stated period |
| I-13 Recoverable distributed compute, storage and communication | Persistence/runtime | Inference, knowledge, language/OS, communication | Independent-node readback, restore, writer fencing and recovery receipts |
| I-14 Use, create and share | Repository delivery | Itonami, inference, knowledge | First useful output, export/share and feedback accepted in published apps |
| I-15 Verified contribution and value exchange | Fleet reliability | Security, repository delivery, knowledge, simulation | Contribution-to-acceptance-to-usage traceability and scoped recovery/cost measurements |

Existing I-2 is retained. Seven existing Projects have additive membership in these four Planned Initiatives; previous memberships, owners, dates, issues and acceptance conditions stay intact. The connector accepted `parentInitiatives` with both human IDs and UUIDs, but independent reads returned empty parent/child fields. Native Linear hierarchy is **not established**. I-2 explicitly links the four goals and each child description references I-2; `nativeLinearParentVerified` is false in the shared source. Do not report native hierarchy as saved.

## Shared organization model

`nixos/otehon/shell/src/mission-catalog.js` stores the four goal definitions, sources, lead/support assignments, acceptance definitions and verified Linear links. `circle-role-catalog.js` assigns explicit coordination roles to existing Bot IDs inside their original responsibility Circles. Existing Fleet roles stay intact. Product planning, implementation, QA/publication and adoption; storage/restore and compute/VM; inference and evaluation; information sourcing and knowledge quality; mail and communication; review and documentation; security audit and qualification; language/compiler, OS, compatibility and accountability are separate roles.

The 899 identities remain unique. All 98 non-simulation Bots in the nine classified Circles have explicit roles. The 683 simulation Bots retain their seven domain sub-Circles; 118 pending-classification identities remain pending. These are coordination assignments, not capability grants. Aozora/Isekai have no dedicated assigned Bot team in this current responsibility catalog; I-14 starts with delivery/integration roles and does not pretend that gap is filled.

The goal picker opens the lead Circle; support buttons open their own Circle. The nested view exposes Roles and selected Bot participants, and the right inspector combines the selected mission, actual dialogue metadata and Agent activity. Original profiles, cron frequencies/timezones, holds, Linear Cycle fields and execution permissions are unchanged. Source definitions are shared artifacts, not a browser-local organization draft. Main merge and guest-image publication are separate gates.

## Actual collaboration versus intention

The already completed four-turn Fleet pilot is explicitly aligned to I-15 by its public cycle digest and AWAI-2862 key. Its original approved grant remains I-2; this display alignment neither changes that grant nor reattributes its token usage. Parent/goal rollups reference AWAI-2862 rather than adding its totals again.

A completed dialogue shows its named speakers, roles, four accepted turn markers and owning Issue. It does not set the business goal's outcome progress. Current Bot motion still comes from fresh matched process/receipt observations. A moving cooperation link additionally requires a fresh process carrying the exact hashed peer-cycle identity, published only by the service after peer grant/admission validation. A concurrent human conversation or unrelated cron job cannot animate a Goal's cooperation edge. Stale/unknown/completed peer progress cannot animate that edge. No transcripts, private owner identity or session UUID are put into public artifacts. This unit invokes no model and creates no recurring peer grant.

Outcome values, measurement windows, human initiative owners and costs remain unknown until measured. The interface keeps these as concise relevant states, with engineering rationale here. Normal-browser private conversation remains gated by the owner-deferred DNS repair and fresh operation-specific user choice.
