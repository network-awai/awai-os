#!/usr/bin/env node
// Weekly DORA software delivery metrics for developer-bot work. Tracking: AWAI-3617
// (owner instruction 2026-11-21: improve the pipeline by these numbers).
//
//   node dora.mjs --repos <owner/name,...> --since <YYYY-MM-DD>
//        [--state <queue-sync state dir>] [--ledger <file.jsonl>] [--json]
//        [--check] [--unclassified] [--report]
//   node dora.mjs --discover --since <YYYY-MM-DD> ...
//
//   --discover       instead of --repos: every repository in the owned
//                    organisations with a merged `muse/*` pull request since
//                    that day, so a repository nobody listed is not left out.
//   --report         the weekly report as Markdown: the table, the changes not
//                    looked at, ledger problems, and the notes marked
//                    `borderline:` (see metrics/README.md, "Weekly run").
//
//   --ledger         defaults to metrics/dora-ledger.jsonl beside this file.
//   --check          exit 1 when the ledger has a problem (see ledgerProblems).
//   --unclassified   list the changes nobody has looked at yet, instead of the table.
//
// A "change" is a merged pull request whose head branch starts with `muse/`.
// Most of these repositories have no deploy step, so a merge to the default
// branch stands in for a deployment; say so wherever the numbers are shown.
//
//   deployment frequency   changes merged in the week
//   change lead time       task start -> merge, median. The start is the queue
//                          runner's `started` time in <state>/<name>/result.json;
//                          a change without one is left out and counted.
//   change fail rate       changes that needed a revert or an urgent fix
//   failed deployment      for those, merge of the change -> merge of its fix,
//     recovery time        median
//   rework rate            changes that are themselves an unplanned fix of an
//                          earlier change
//   clean merge rate       (supporting) changes merged without a commit added
//                          in review
//
// Failures and rework are not guessed from titles. They come from the ledger,
// one JSON object per line:
//   {"kind":"failure","repo":"o/n","pr":12,"fixed_by":{"repo":"o/n","pr":15},"note":"..."}
//   {"kind":"rework","repo":"o/n","pr":15,"note":"..."}
//   {"kind":"reviewed","repo":"o/n","pr":13,"note":"..."}
//   {"kind":"classified-through","at":"2026-11-21T00:00:00Z","repos":["o/n"]}
// `reviewed` says someone looked at the change and found neither. `fixed_by`
// may name any merged pull request, a bot change or not. `classified-through`
// covers the listed repositories (all of them when `repos` is absent), from
// the optional `from` time on. Only changes merged in that span have been
// looked at, so only a week whose changes all lie inside it gets a fail rate and a rework rate (a measured
// zero included). Anything else is "unknown", not 0. What counts as a failure
// or as rework, and how to add lines, is in metrics/README.md.
//
// summarize() is pure. Importing this file runs nothing.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_ORGS, EXCLUDED_REPOS } from "./gate.mjs";
import { NAME_RE, REPO_RE } from "./queue.mjs";

export const UNKNOWN = "unknown";
const DEFAULT_LEDGER = join(fileURLToPath(new URL(".", import.meta.url)), "metrics", "dora-ledger.jsonl");
const ms = (t) => { const n = Date.parse(t ?? ""); return Number.isFinite(n) ? n : null; };
const key = (repo, pr) => `${repo}#${pr}`;

/** ISO 8601 week of a time, as "2026-W47" (UTC). */
export function isoWeek(time) {
  const d = new Date(ms(time));
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function median(xs) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * Ledger text -> {failures: Map change->fix|null, rework: Set, reviewed: Set,
 * through: Map repo|"*" -> ms, from: Map repo|"*" -> ms (-Infinity when no line gave one), classifiedThrough: ms|null (the "*" entry),
 * bad: number of lines ignored, badLines: numbers of the lines with a problem
 * (the ignored ones, and a failure whose fixed_by is unreadable), conflicts: number[],
 * borderline: the lines whose note starts with "borderline:", for the weekly review}.
 */
export function parseLedger(text) {
  const out = { failures: new Map(), rework: new Set(), reviewed: new Set(), through: new Map(), from: new Map(), classifiedThrough: null, bad: 0, badLines: [], conflicts: [], borderline: [] };
  const okRef = (r) => r && typeof r === "object" && REPO_RE.test(r.repo ?? "") && Number.isInteger(r.pr) && r.pr > 0;
  const okRepos = (rs) => rs === undefined || (Array.isArray(rs) && rs.length > 0 && rs.every((r) => typeof r === "string" && REPO_RE.test(r)));
  String(text ?? "").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let e = null;
    try { e = JSON.parse(line); } catch { e = null; }
    if (["failure", "rework", "reviewed"].includes(e?.kind) && okRef(e) && /^borderline:/.test(String(e.note ?? ""))) out.borderline.push({ kind: e.kind, change: key(e.repo, e.pr), note: String(e.note) });
    if (e?.kind === "classified-through" && ms(e.at) !== null && okRepos(e.repos) && (e.from === undefined || (ms(e.from) !== null && ms(e.from) <= ms(e.at)))) {
      for (const r of e.repos ?? ["*"]) {
        out.through.set(r, Math.max(out.through.get(r) ?? 0, ms(e.at)));
        out.from.set(r, Math.min(out.from.get(r) ?? Infinity, e.from === undefined ? -Infinity : ms(e.from)));
      }
    } else if (e?.kind === "failure" && okRef(e)) {
      const k = key(e.repo, e.pr);
      const fix = okRef(e.fixed_by) ? key(e.fixed_by.repo, e.fixed_by.pr) : null;
      // A failure whose fix cannot be read still counts as a failure; the line is reported.
      if (e.fixed_by !== undefined && !fix) out.badLines.push(i + 1);
      // Two lines naming different fixes for one change: keep the first, report the second.
      if (out.failures.get(k) && fix && out.failures.get(k) !== fix) out.conflicts.push(i + 1);
      else out.failures.set(k, fix ?? out.failures.get(k) ?? null);
    } else if (e?.kind === "rework" && okRef(e)) out.rework.add(key(e.repo, e.pr));
    else if (e?.kind === "reviewed" && okRef(e)) out.reviewed.add(key(e.repo, e.pr));
    else { out.bad += 1; out.badLines.push(i + 1); }
  });
  out.classifiedThrough = out.through.get("*") ?? null;
  return out;
}

const looked = (ledger, c) => [c.repo, "*"].some((r) => ledger.through.has(r) && c.t <= ledger.through.get(r) && c.t >= ledger.from.get(r));

const round1 = (x) => Math.round(x * 10) / 10;
const rate = (num, den) => (den > 0 ? round1((100 * num) / den) : UNKNOWN);

/**
 * @param {{repo: string, pr: number, mergedAt: string, startedAt?: string|null, fixCommits?: number|null}[]} changes
 * @param {ReturnType<typeof parseLedger>} ledger
 * @param {Map<string, string>} fixMergedAt "repo#pr" -> merge time of a fix that is not itself in `changes`
 * @returns one row per ISO week that has a merged change, oldest first
 */
export function summarize(changes, ledger = parseLedger(""), fixMergedAt = new Map()) {
  const mergedAt = new Map();
  for (const [k, t] of fixMergedAt) if (ms(t) !== null) mergedAt.set(k, ms(t));
  const weeks = new Map();
  for (const c of changes) {
    const t = ms(c?.mergedAt);
    if (t === null || !REPO_RE.test(c?.repo ?? "") || !Number.isInteger(c?.pr)) continue;
    mergedAt.set(key(c.repo, c.pr), t);
    const w = isoWeek(c.mergedAt);
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push({ ...c, t });
  }
  const rows = [];
  for (const [week, cs] of [...weeks].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const lead = cs.map((c) => (ms(c.startedAt) !== null && c.t >= ms(c.startedAt) ? (c.t - ms(c.startedAt)) / 60000 : null)).filter((x) => x !== null);
    const classified = cs.every((c) => looked(ledger, c));
    const failed = cs.filter((c) => ledger.failures.has(key(c.repo, c.pr)));
    const recovery = failed.map((c) => {
      const fix = mergedAt.get(ledger.failures.get(key(c.repo, c.pr)) ?? "");
      return fix !== undefined && fix >= c.t ? (fix - c.t) / 60000 : null;
    }).filter((x) => x !== null);
    const reviewed = cs.filter((c) => Number.isInteger(c.fixCommits) && c.fixCommits >= 0);
    rows.push({
      week,
      deployments: cs.length,
      leadTimeMedianMin: lead.length ? round1(median(lead)) : UNKNOWN,
      leadTimeN: lead.length,
      changeFailRatePct: classified ? rate(failed.length, cs.length) : UNKNOWN,
      knownFailures: failed.length,
      recoveryMedianMin: recovery.length ? round1(median(recovery)) : UNKNOWN,
      recoveryN: recovery.length,
      reworkRatePct: classified ? rate(cs.filter((c) => ledger.rework.has(key(c.repo, c.pr))).length, cs.length) : UNKNOWN,
      cleanMergeRatePct: rate(reviewed.filter((c) => c.fixCommits === 0).length, reviewed.length),
      cleanMergeN: reviewed.length,
      classified,
    });
  }
  return rows;
}

const valid = (changes) => changes.filter((c) => ms(c?.mergedAt) !== null && REPO_RE.test(c?.repo ?? "") && Number.isInteger(c?.pr)).map((c) => ({ ...c, t: ms(c.mergedAt) }));

/** Changes nobody has looked at yet (merged outside their repository's classified span), oldest first. */
export function unclassified(changes, ledger) {
  return valid(changes).filter((c) => !looked(ledger, c)).sort((a, b) => a.t - b.t).map(({ t, ...c }) => c);
}

/**
 * What is wrong with a ledger, as sentences; empty when nothing is.
 * - a line that is not a ledger line, or a second, different fix for one change
 * - a classified-through time later than `now`
 * - a change inside its classified-through time with no line of its own
 *   (the mark was moved without looking at the change)
 * - a fix that is not merged, or was merged before the change it fixes
 * Lines about changes outside `changes` cannot be checked here and are left alone.
 */
export function ledgerProblems(changes, ledger, fixMergedAt = new Map(), now = Date.now()) {
  const out = [];
  if (ledger.badLines.length) out.push(`line(s) ${ledger.badLines.join(", ")}: not a valid ledger line`);
  if (ledger.conflicts.length) out.push(`line(s) ${ledger.conflicts.join(", ")}: a different fix is already recorded for this change`);
  for (const [r, t] of ledger.through) if (t > now) out.push(`classified-through for ${r === "*" ? "all repositories" : r} is in the future`);
  const cs = valid(changes);
  const at = new Map(cs.map((c) => [key(c.repo, c.pr), c.t]));
  for (const [k, t] of fixMergedAt) if (ms(t) !== null && !at.has(k)) at.set(k, ms(t));
  for (const c of cs) {
    const k = key(c.repo, c.pr);
    if (looked(ledger, c) && !ledger.failures.has(k) && !ledger.rework.has(k) && !ledger.reviewed.has(k)) out.push(`${k} is inside the classified span but has no ledger line`);
    const fix = ledger.failures.get(k);
    if (fix && !at.has(fix)) out.push(`${k}: its fix ${fix} is not a merged pull request this run could read`);
    else if (fix && at.get(fix) < c.t) out.push(`${k}: its fix ${fix} was merged before it`);
  }
  return out;
}

export function toMarkdown(rows) {
  const head = "| Week | Deployments (merges) | Lead time, median min (n) | Change fail rate % | Recovery, median min (n) | Rework rate % | Clean merge % (n) |\n| -- | -- | -- | -- | -- | -- | -- |";
  const body = rows.map((r) => `| ${r.week} | ${r.deployments} | ${r.leadTimeMedianMin} (${r.leadTimeN}) | ${r.changeFailRatePct}${!r.classified && r.knownFailures ? ` (${r.knownFailures} known)` : ""} | ${r.recoveryMedianMin} (${r.recoveryN}) | ${r.reworkRatePct} | ${r.cleanMergeRatePct} (${r.cleanMergeN}) |`);
  return [head, ...body].join("\n");
}

/** Commits a review added: every commit after the first, merges of the base branch aside. */
/**
 * The weekly report, as Markdown. Pure: everything it prints is passed in.
 * @param {{since: string, repos: string[], changes: number, ledger: boolean, rows: object[], todo: object[], problems: string[], borderline: object[]}} r
 */
export function toReport(r) {
  const out = [`**DORA weekly report** (bot changes merged since ${r.since}; a merge stands in for a deployment; "unknown" means not measured, not zero)`, ""];
  out.push(r.rows.length ? toMarkdown(r.rows) : "No merged bot change in this period.", "");
  out.push(`${r.changes} merged bot change(s) in ${r.repos.length} repositor${r.repos.length === 1 ? "y" : "ies"}.`);
  if (!r.ledger) out.push("No ledger was read: fail rate, recovery time and rework rate cannot be measured.");
  out.push("", `**Not looked at yet: ${r.todo.length}**`);
  for (const c of r.todo.slice(0, 100)) out.push(`- ${c.repo}#${c.pr} (merged ${c.mergedAt})`);
  if (r.todo.length > 100) out.push(`- and ${r.todo.length - 100} more`);
  out.push("", `**Ledger problems: ${r.problems.length}**`);
  for (const p of r.problems) out.push(`- ${p}`);
  out.push("", `**Borderline decisions to review: ${r.borderline.length}**`);
  for (const b of r.borderline) out.push(`- ${b.change} (${b.kind}): ${b.note}`);
  return out.join("\n");
}

export function fixCommitCount(commits) {
  if (!Array.isArray(commits) || !commits.length) return null;
  return Math.max(0, commits.filter((c) => !/^Merge /.test(String(c?.messageHeadline ?? ""))).length - 1);
}

export function parseArgs(argv) {
  const o = { json: false, check: false, unclassified: false, discover: false, report: false, state: null, ledger: null };
  const want = { "--repos": "repos", "--since": "since", "--state": "state", "--ledger": "ledger" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") o.json = true;
    else if (argv[i] === "--check") o.check = true;
    else if (argv[i] === "--unclassified") o.unclassified = true;
    else if (argv[i] === "--discover") o.discover = true;
    else if (argv[i] === "--report") o.report = true;
    else if (want[argv[i]] && i + 1 < argv.length) o[want[argv[i]]] = argv[++i];
    else return { error: `unknown or incomplete argument: ${argv[i]}` };
  }
  if (!o.since || (!o.repos && !o.discover)) return { error: "--since and one of --repos or --discover are required" };
  if (o.repos && o.discover) return { error: "--repos and --discover cannot be combined" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.since) || ms(o.since) === null) return { error: "--since must be YYYY-MM-DD" };
  o.repos = (o.repos ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const r of o.repos) {
    if (!REPO_RE.test(r) || !ALLOWED_ORGS.includes(r.split("/")[0]) || EXCLUDED_REPOS.includes(r)) return { error: `repository not in an owned organisation: ${r}` };
  }
  return o;
}

export function main(argv) {
  const o = parseArgs(argv);
  if (o.error) { console.error(`dora: ${o.error}`); return 2; }
  const gh = (args) => {
    const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${String(r.stderr ?? "").trim().slice(0, 200)}`);
    return JSON.parse(r.stdout);
  };
  const started = new Map(); // "repo branch" -> started
  if (o.state) {
    for (const n of existsSync(o.state) ? readdirSync(o.state) : []) {
      if (!NAME_RE.test(n)) continue;
      try {
        const r = JSON.parse(readFileSync(join(o.state, n, "result.json"), "utf8"));
        if (typeof r.repo === "string" && typeof r.branch === "string" && ms(r.started) !== null) started.set(`${r.repo} ${r.branch}`, r.started);
      } catch { /* no result yet */ }
    }
  }
  const changes = [];
  try {
    // Every owned organisation, one search each; a repository outside them or excluded is dropped.
    for (const org of o.discover ? ALLOWED_ORGS : []) {
      const found = gh(["search", "prs", "--owner", org, "--merged", "--limit", "1000", "--json", "repository,number", "head:muse/", `merged:>=${o.since}`]);
      for (const f of found) {
        const repo = String(f?.repository?.nameWithOwner ?? "");
        if (!REPO_RE.test(repo) || repo.split("/")[0] !== org || EXCLUDED_REPOS.includes(repo)) continue;
        const v = gh(["pr", "view", String(f.number), "-R", repo, "--json", "commits,headRefName,mergedAt"]);
        if (!String(v.headRefName).startsWith("muse/") || ms(v.mergedAt) === null) continue;
        changes.push({ repo, pr: f.number, head: v.headRefName, mergedAt: v.mergedAt, startedAt: started.get(`${repo} ${v.headRefName}`) ?? null, fixCommits: fixCommitCount(v.commits) });
        if (!o.repos.includes(repo)) o.repos.push(repo);
      }
    }
    o.repos.sort();
    for (const repo of o.discover ? [] : o.repos) {
      const prs = gh(["pr", "list", "-R", repo, "--state", "merged", "--search", `head:muse/ merged:>=${o.since}`, "--limit", "200", "--json", "number,headRefName,mergedAt"]);
      for (const p of prs.filter((x) => String(x.headRefName).startsWith("muse/"))) {
        const commits = gh(["pr", "view", String(p.number), "-R", repo, "--json", "commits"]).commits;
        changes.push({ repo, pr: p.number, head: p.headRefName, mergedAt: p.mergedAt, startedAt: started.get(`${repo} ${p.headRefName}`) ?? null, fixCommits: fixCommitCount(commits) });
      }
    }
  } catch (e) { console.error(`dora: ${e.message}`); return 1; }
  const ledgerFile = o.ledger ?? (existsSync(DEFAULT_LEDGER) ? DEFAULT_LEDGER : null);
  let ledger = parseLedger("");
  if (ledgerFile) { try { ledger = parseLedger(readFileSync(ledgerFile, "utf8")); } catch (e) { console.error(`dora: ${e.message}`); return 2; } }
  // Merge time of each fix that is not a bot change in this run. Unreadable or unmerged: left out.
  const have = new Set(changes.map((c) => key(c.repo, c.pr)));
  const fixMergedAt = new Map();
  for (const c of changes) {
    const fix = ledger.failures.get(key(c.repo, c.pr));
    if (!fix || have.has(fix) || fixMergedAt.has(fix)) continue;
    const [repo, pr] = fix.split("#");
    if (!ALLOWED_ORGS.includes(repo.split("/")[0]) || EXCLUDED_REPOS.includes(repo)) continue;
    try { const v = gh(["pr", "view", pr, "-R", repo, "--json", "mergedAt"]); if (ms(v.mergedAt) !== null) fixMergedAt.set(fix, v.mergedAt); } catch { /* reported by ledgerProblems */ }
  }
  const rows = summarize(changes, ledger, fixMergedAt);
  const problems = ledgerFile ? ledgerProblems(changes, ledger, fixMergedAt) : [];
  const todo = unclassified(changes, ledger);
  if (o.json) console.log(JSON.stringify({ since: o.since, repos: o.repos, changes: changes.length, ledger: ledgerFile, ledgerLinesIgnored: ledger.bad, ledgerProblems: problems, unclassified: todo.map((c) => ({ repo: c.repo, pr: c.pr, mergedAt: c.mergedAt })), rows }, null, 1));
  else if (o.report) console.log(toReport({ since: o.since, repos: o.repos, changes: changes.length, ledger: Boolean(ledgerFile), rows, todo, problems, borderline: ledger.borderline }));
  else if (o.unclassified) {
    for (const c of todo) console.log(`${c.repo}#${c.pr}\t${c.mergedAt}\t${c.head ?? ""}`);
    console.log(`${todo.length} of ${changes.length} merged bot change(s) since ${o.since} not looked at yet.`);
  } else {
    console.log(toMarkdown(rows));
    console.log(`\n${changes.length} merged bot change(s) since ${o.since} in ${o.repos.join(", ")}. A merge stands in for a deployment. "unknown" means not measured, not zero.`);
    console.log(ledgerFile ? `Ledger: ${ledgerFile}. ${todo.length} change(s) not looked at yet.` : "No ledger: fail rate, recovery time and rework rate cannot be measured.");
  }
  for (const p of problems) console.error(`dora: ledger: ${p}`);
  return o.check && problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
