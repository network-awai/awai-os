// Pure merge gate for developer-bot work. No I/O here: deliver.mjs collects the facts.
// Decision is the strictest of all reasons: hold > draft > merge.
export const VERDICT_SCHEMA = "itonami.dev.review-verdict.v1";
export const ALLOWED_ORGS = ["network-awai", "cloud-itonami", "kotoba-lang", "com-junkawasaki"];
export const EXCLUDED_REPOS = ["kotoba-lang/hikari-baito-ludo"];
export const LIMITS = { files: 60, addedLines: 4000, binaryBytes: 1048576 };

// Paths a bot may change only through a PR that a person merges.
const OWNER_PATHS = [
  /^\.github\//, /(^|\/)AGENTS\.md$/, /(^|\/)CLAUDE\.md$/, /(^|\/)SECURITY\.md$/, /(^|\/)LICENSE[^/]*$/,
  /(^|\/)wrangler[^/]*\.(toml|jsonc?)$/, /(^|\/)otehon\/dev-bots\//, /(^|\/)deploy\//,
  /(^|\/)\.claude\//, /(^|\/)CODEOWNERS$/,
];
const SECRET_FILES = [/(^|\/)\.env(\.|$)/, /\.(pem|p12|pfx|keystore|jks)$/, /(^|\/)auth\.json$/, /(^|\/)id_(rsa|ed25519)$/, /(^|\/)relay\.env$/];
const SECRET_LINES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, /\bsk-[A-Za-z0-9_-]{32,}\b/, /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\blin_api_[A-Za-z0-9]{30,}\b/, /\bAIza[0-9A-Za-z_-]{35}\b/,
];

export function scanSecrets(files, addedLines) {
  const hits = [];
  for (const f of files) if (SECRET_FILES.some((r) => r.test(f.path))) hits.push(`secret-like file: ${f.path}`);
  for (const { path, text } of addedLines) if (SECRET_LINES.some((r) => r.test(text))) hits.push(`secret-like content in ${path}`);
  return [...new Set(hits)];
}

export function verdictProblems(verdict, task) {
  if (!verdict || typeof verdict !== "object") return ["no review verdict"];
  const p = [];
  if (verdict.schema !== VERDICT_SCHEMA) p.push("verdict schema mismatch");
  if (verdict.reviewer !== "shinsa") p.push("verdict is not from the shinsa profile");
  if (verdict.issue !== task.issue) p.push("verdict is for another issue");
  if (!["approve", "reject", "owner-decision"].includes(verdict.decision)) p.push("verdict decision missing");
  if (!Array.isArray(verdict.findings) || !Array.isArray(verdict.checks) || !Array.isArray(verdict.acceptance)) p.push("verdict lists missing");
  return p;
}

/** @returns {{action: "merge"|"draft"|"hold", reasons: {level: "hold"|"draft", text: string}[]}} */
export function decide({ task, verdict, files = [], addedLines = [], tests = [], pr = null }) {
  const reasons = [];
  const hold = (text) => reasons.push({ level: "hold", text });
  const draft = (text) => reasons.push({ level: "draft", text });

  if (!task || !/^[A-Z]+-\d+$/.test(task.issue ?? "")) hold("task has no Linear issue key");
  const [org] = String(task?.repo ?? "").split("/");
  if (!ALLOWED_ORGS.includes(org) || EXCLUDED_REPOS.includes(task.repo)) hold(`repository ${task?.repo} is outside the owner's allowed organisations`);
  if (!files.length) hold("no changes to deliver");

  for (const h of scanSecrets(files, addedLines)) hold(h);
  if (files.some((f) => /(^|\/)\.agent-output\//.test(f.path))) hold("scratch output staged for commit");

  const vp = verdictProblems(verdict, task ?? {});
  vp.forEach(hold);
  if (!vp.length) {
    if (verdict.decision === "reject") hold("review rejected the change");
    if (verdict.decision === "owner-decision") draft(`review asks for an owner decision: ${verdict.owner_question ?? "unspecified"}`);
    for (const f of verdict.findings) if (["critical", "high"].includes(f.severity) && f.fixed !== true) hold(`unfixed ${f.severity} finding: ${f.where ?? "?"}`);
    // An item this unit cannot meet on a host (device, deployment, live service) may be deferred to its
    // own issue: it does not block the merge, but the Linear issue is then not closed by the merge.
    for (const a of verdict.acceptance) if (a.met !== true && a.deferred !== true) draft(`acceptance item not met or not verified: ${a.item ?? "?"}`);
    if (!verdict.acceptance.some((a) => a.met === true)) draft("no acceptance item is met");
    if (!verdict.acceptance.length) draft("review lists no acceptance items");
  }

  if (!tests.length) draft("no test command declared for this task");
  for (const t of tests) if (t.exit !== 0) hold(`test failed outside the sandbox: ${t.cmd}`);

  const owner = files.filter((f) => OWNER_PATHS.some((r) => r.test(f.path)));
  if (owner.length) draft(`owner-reviewed paths changed: ${owner.slice(0, 5).map((f) => f.path).join(", ")}`);
  if (files.length > LIMITS.files) draft(`${files.length} files changed (limit ${LIMITS.files})`);
  const added = files.reduce((n, f) => n + (f.added ?? 0), 0);
  if (added > LIMITS.addedLines) draft(`${added} lines added (limit ${LIMITS.addedLines})`);
  for (const f of files) if (f.binary && (f.bytes ?? 0) > LIMITS.binaryBytes) draft(`large binary file: ${f.path}`);

  if (task?.merge !== "auto") draft(`task merge mode is ${task?.merge ?? "unset"}`);
  if (pr) {
    if (pr.failingChecks?.length) hold(`failing checks: ${pr.failingChecks.join(", ")}`);
    if (pr.pendingChecks?.length) draft(`checks still pending: ${pr.pendingChecks.join(", ")}`);
    if (pr.mergeable === false) hold("pull request is not mergeable");
  }
  const deferred = (verdict?.acceptance ?? []).filter((a) => a.met !== true && a.deferred === true).map((a) => a.item);
  const action = reasons.some((r) => r.level === "hold") ? "hold" : reasons.some((r) => r.level === "draft") ? "draft" : "merge";
  return { action, reasons, deferred };
}
