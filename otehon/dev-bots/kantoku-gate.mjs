// Pure gate for pull requests that change the developer bots themselves
// (otehon/dev-bots/). The ordinary gate (gate.mjs) leaves such a pull request
// as a draft. This one decides whether the second review by `kantoku`, made on
// another host, is enough to merge it. No I/O here: the caller collects the
// facts. Tracking: AWAI-3609 (owner decision 2026-11-20).
//
// Decision is the strictest of all reasons: hold > owner > merge.
//   merge  the caller may mark the pull request ready and squash-merge it
//   owner  leave it as a draft for a person
//   hold   something is wrong or not yet known; do nothing and report it
import { ALLOWED_ORGS, EXCLUDED_REPOS, LIMITS, scanSecrets } from "./gate.mjs";

export const KANTOKU_SCHEMA = "itonami.dev.self-change-verdict.v1";
export const PIPELINE_DIR = "otehon/dev-bots/";
const OWNER_PATH_REASON = /^owner-reviewed paths changed: /;
const SHA_RE = /^[0-9a-f]{40}$/;

// Inside otehon/dev-bots/, what a review bot may never approve: both gates and
// their tests, the step that acts on this gate, the reviewer profiles, and any
// replay or evaluation set. kantoku/SOUL.md states the same list in words.
const NEVER_APPROVE = [
  /^otehon\/dev-bots\/gate(\.test)?\.mjs$/,
  /^otehon\/dev-bots\/kantoku-[^/]*$/,
  /^otehon\/dev-bots\/kantoku\//,
  /^otehon\/dev-bots\/shinsa\//,
  /^otehon\/dev-bots\/(eval|evals|replay|metrics)\//,
];

/** Why a changed path is the owner's to merge, or null when kantoku may approve it. */
export function ownerOnlyReason(path) {
  if (typeof path !== "string" || path === "") return "unreadable path";
  if (path.startsWith("/") || path.split("/").some((s) => s === ".." || s === "." || s === "")) return `path is not a plain repository path: ${path}`;
  if (!path.startsWith(PIPELINE_DIR)) return `outside ${PIPELINE_DIR}: ${path}`;
  if (NEVER_APPROVE.some((r) => r.test(path))) return `a review bot may not approve: ${path}`;
  return null;
}

export function kantokuVerdictProblems(verdict, pr) {
  if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) return ["no kantoku verdict"];
  const p = [];
  if (verdict.schema !== KANTOKU_SCHEMA) p.push("kantoku verdict schema mismatch");
  if (verdict.reviewer !== "kantoku") p.push("verdict is not from the kantoku profile");
  if (verdict.issue !== pr.issue) p.push("kantoku verdict is for another issue");
  if (verdict.repo !== pr.repo) p.push("kantoku verdict is for another repository");
  if (verdict.pr !== pr.number) p.push("kantoku verdict is for another pull request");
  if (!SHA_RE.test(verdict.head ?? "") || verdict.head !== pr.head) p.push("kantoku verdict is for another commit");
  if (!["approve", "reject", "owner-decision"].includes(verdict.decision)) p.push("kantoku verdict decision missing");
  for (const k of ["checks", "mutations", "findings", "unverified"]) {
    if (!Array.isArray(verdict[k])) p.push(`kantoku verdict list missing: ${k}`);
  }
  return p;
}

/**
 * @param {object} input
 * @param {{repo: string, number: number, head: string, issue: string, state: string,
 *          mergeable: boolean|null, failingChecks?: string[], pendingChecks?: string[]}} input.pr
 *        facts read from GitHub for the pull request head, not from the verdict
 * @param {{action: string, reasons: {level: string, text: string}[]}|null} input.first
 *        the ordinary gate's decision for this delivery (deliver.json / result.json)
 * @param {object|null} input.verdict  kantoku-verdict.json
 * @param {{path: string, added?: number, binary?: boolean, bytes?: number}[]} input.files
 *        every path the pull request touches; a rename lists both names
 * @param {{path: string, text: string}[]} input.addedLines
 * @param {{cmd: string, shell: string, exit: number}[]} input.tests
 *        the declared tests, re-run by the caller on this host, once per shell
 * @returns {{action: "merge"|"owner"|"hold", reasons: {level: "hold"|"owner", text: string}[]}}
 */
export function decideSelfChange({ pr, first = null, verdict = null, files = [], addedLines = [], tests = [] }) {
  const reasons = [];
  const hold = (text) => reasons.push({ level: "hold", text });
  const owner = (text) => reasons.push({ level: "owner", text });
  const done = () => ({
    action: reasons.some((r) => r.level === "hold") ? "hold" : reasons.some((r) => r.level === "owner") ? "owner" : "merge",
    reasons,
  });

  if (!pr || typeof pr !== "object") { hold("no pull request facts"); return done(); }
  if (!/^[A-Z]+-\d+$/.test(pr.issue ?? "")) hold("pull request has no Linear issue key");
  const [org] = String(pr.repo ?? "").split("/");
  if (!ALLOWED_ORGS.includes(org) || EXCLUDED_REPOS.includes(pr.repo)) hold(`repository ${pr.repo} is outside the owner's allowed organisations`);
  if (!Number.isInteger(pr.number) || pr.number <= 0) hold("pull request number missing");
  if (!SHA_RE.test(pr.head ?? "")) hold("pull request head commit missing");
  if (pr.state !== "OPEN") hold(`pull request is ${pr.state ?? "in an unknown state"}`);
  if (pr.mergeable !== true) hold("pull request is not known to be mergeable");
  if (pr.failingChecks?.length) hold(`failing checks: ${pr.failingChecks.join(", ")}`);
  if (pr.pendingChecks?.length) hold(`checks still pending: ${pr.pendingChecks.join(", ")}`);

  // The ordinary gate must have had exactly one objection: the paths. A hold,
  // a draft for any other reason, or no record of its decision is not ours to lift.
  if (!first || typeof first !== "object" || !Array.isArray(first.reasons)) owner("no record of the ordinary gate's decision");
  else if (first.action !== "draft") owner(`the ordinary gate decided ${first.action ?? "nothing"}, not draft`);
  else {
    const other = first.reasons.filter((r) => !(r?.level === "draft" && OWNER_PATH_REASON.test(r?.text ?? "")));
    if (!first.reasons.length) owner("the ordinary gate gave no reason for the draft");
    for (const r of other) owner(`the ordinary gate also said: ${String(r?.text ?? "?").slice(0, 160)}`);
  }

  if (!files.length) hold("no changed files listed");
  for (const f of files) {
    const why = ownerOnlyReason(f?.path);
    if (why) owner(why);
  }
  for (const h of scanSecrets(files.filter((f) => typeof f?.path === "string"), addedLines)) hold(h);
  if (files.length > LIMITS.files) owner(`${files.length} files changed (limit ${LIMITS.files})`);
  const added = files.reduce((n, f) => n + (f?.added ?? 0), 0);
  if (added > LIMITS.addedLines) owner(`${added} lines added (limit ${LIMITS.addedLines})`);
  for (const f of files) if (f?.binary) owner(`binary file: ${f.path}`);

  const vp = kantokuVerdictProblems(verdict, pr);
  vp.forEach(hold);
  if (!vp.length) {
    if (verdict.decision === "reject") hold("kantoku rejected the change");
    if (verdict.decision === "owner-decision") owner(`kantoku asks for an owner decision: ${String(verdict.owner_question ?? "unspecified").slice(0, 300)}`);
    if (verdict.decision === "approve") {
      // kantoku/SOUL.md: an approve like this is treated as a reject.
      if (!verdict.checks.length) hold("kantoku approved without running a check");
      if (verdict.findings.length) hold(`kantoku approved with ${verdict.findings.length} open finding(s)`);
      if (verdict.unverified.length) hold(`kantoku approved with ${verdict.unverified.length} unverified item(s)`);
    }
  }

  // The caller's own run of the declared tests, not the reviewer's account of one.
  if (!tests.length) owner("no test command was re-run on this host");
  for (const t of tests) if (t?.exit !== 0) hold(`test failed on this host under ${t?.shell ?? "?"}: ${t?.cmd ?? "?"}`);
  if (tests.length && new Set(tests.map((t) => t?.shell)).size < 2) owner("the declared tests ran under fewer than two shells");

  return done();
}
