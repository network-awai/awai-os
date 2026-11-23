import assert from "node:assert/strict";
import { test } from "node:test";
import { osOperations, phoneOperations } from "../src/runtime.js";

// AWAI-3883 fail-closed country guard (Organizer instruction 2026-11-23; country nullable
// validator 2026-11-23). Legal's answer: the recipient can be named, the country cannot.
// The consent dialog reads the machine country field for display, so an unconfirmed
// country must never appear as a code. Rules, fail-closed:
// - countryStatus "pending" requires country null (a pending op carrying a two-letter
//   code FAILS — only the null+pending combination is allowed), plus a user-visible
//   `note` and a `confirmCondition`.
// - countryStatus "confirmed" requires a two-letter code AND an entry on the CONFIRMED
//   allowlist below (the one place confirmed ops are named, each with a one-line WHY).
// - Legacy disclosures without countryStatus (pre-AWAI-3883 precedents, e.g. compute)
//   are allowed only on the allowlist; any other concrete country without a status fails.
// Scope: shell operations (osOperations incl. support/compute desks, phoneOperations).
// Home identity operations live in android/client/identity-entry.js and are covered by
// the android identity tests and the Home bundle descriptor check, not this file.
// CONFIRMED allowlist — the one place confirmed ops are named. Each entry: WHY confirmed.
const CONFIRMED = new Map([
  // WHY: Legal confirmed JP 2026-11-23 — e-Gov law API transferred 2021-09-01 from MIC administrative management bureau to the Digital Agency.
  ['["awai-egov","e-gov-law-api","read-statute"]', "Legal confirmed JP (Digital Agency, 2021-09-01 transfer)"],
  // WHY: Organizer named shell awai-compute (Awai Network LLC/JP devnet desk) as the individually-confirmed example in the AWAI-3883 guard instruction.
  ['["awai-compute","awai-compute-devnet-desk","prepare-compute"]', "Organizer: awai-compute Awai Network LLC/JP is the confirmed example"],
  // WHY: Organizer named shell awai-compute (Awai Network LLC/JP devnet desk) as the individually-confirmed example in the AWAI-3883 guard instruction.
  ['["awai-compute","awai-compute-devnet-desk","run-compute"]', "Organizer: awai-compute Awai Network LLC/JP is the confirmed example"],
  // WHY: Organizer named shell awai-compute (Awai Network LLC/JP devnet desk) as the individually-confirmed example in the AWAI-3883 guard instruction.
  ['["awai-compute","awai-compute-devnet-desk","read-work-receipt"]', "Organizer: awai-compute Awai Network LLC/JP is the confirmed example"],
]);

const selector = (o) => JSON.stringify([o.capability, o.service, o.operation]);

function allOps() {
  const relay = "https://relay.awai.network";
  return [
    ...osOperations(relay, "https://support.invalid", "https://compute.invalid"),
    ...phoneOperations(relay),
  ];
}

test("every disclosure country is null+pending, or allowlisted-confirmed; pending never carries a code", () => {
  const ops = allOps();
  assert.ok(ops.length > 0, "no operations found");
  const seen = new Set();
  const offenders = [];
  for (const op of ops) {
    const sel = selector(op);
    seen.add(sel);
    const d = op.disclosure ?? {};
    const status = d.countryStatus;
    const country = d.country;
    if (status === "pending") {
      if (country !== null) offenders.push(`${sel}: pending carries code ${JSON.stringify(country)}`);
      if (typeof d.note !== "string" || d.note.trim() === "") offenders.push(`${sel}: pending without note`);
      if (typeof d.confirmCondition !== "string" || d.confirmCondition.trim() === "") offenders.push(`${sel}: pending without confirmCondition`);
      continue;
    }
    if (status === "confirmed") {
      if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) offenders.push(`${sel}: confirmed without two-letter code`);
      if (!CONFIRMED.has(sel)) offenders.push(`${sel}: confirmed but not on the allowlist`);
      continue;
    }
    if (status !== undefined) {
      offenders.push(`${sel}: invalid countryStatus ${JSON.stringify(status)}`);
      continue;
    }
    // Legacy (no status): concrete country allowed only on the allowlist.
    if (country === undefined || country === null) continue;
    if (CONFIRMED.has(sel)) continue;
    offenders.push(`${sel}: legacy concrete country ${JSON.stringify(country)} without confirmation`);
  }
  assert.deepEqual(offenders, [], `country guard failures:\n${offenders.join("\n")}`);
  // The allowlist must not go stale: every confirmed entry must name a real operation.
  for (const sel of CONFIRMED.keys()) {
    assert.ok(seen.has(sel), `allowlist entry names no operation: ${sel}`);
  }
});
