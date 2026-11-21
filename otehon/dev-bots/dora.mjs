#!/usr/bin/env node
// Weekly DORA software delivery metrics for developer-bot work. Tracking: AWAI-3617
// (owner instruction 2026-11-21: improve the pipeline by these numbers).
//
//   node dora.mjs --repos <owner/name,...> --since <YYYY-MM-DD>
//        [--state <queue-sync state dir>] [--ledger <file.jsonl>] [--json]
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
//   {"kind":"classified-through","at":"2026-11-21T00:00:00Z"}
// Only changes merged up to the latest `classified-through` time have been
// looked at, so only a week that lies wholly before it gets a fail rate and a
// rework rate (a measured zero included). Anything else is "unknown", not 0.
//
// summarize() is pure. Importing this file runs nothing.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_ORGS, EXCLUDED_REPOS } from "./gate.mjs";
import { NAME_RE, REPO_RE } from "./queue.mjs";

export const UNKNOWN = "unknown";
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

/** Ledger text -> {failures: Map, rework: Set, classifiedThrough: ms|null, bad: number}. */
export function parseLedger(text) {
  const out = { failures: new Map(), rework: new Set(), classifiedThrough: null, bad: 0 };
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let e = null;
    try { e = JSON.parse(line); } catch { e = null; }
    const okRef = (r) => r && typeof r === "object" && REPO_RE.test(r.repo ?? "") && Number.isInteger(r.pr) && r.pr > 0;
    if (e?.kind === "classified-through" && ms(e.at) !== null) out.classifiedThrough = Math.max(out.classifiedThrough ?? 0, ms(e.at));
    else if (e?.kind === "failure" && okRef(e)) out.failures.set(key(e.repo, e.pr), okRef(e.fixed_by) ? key(e.fixed_by.repo, e.fixed_by.pr) : null);
    else if (e?.kind === "rework" && okRef(e)) out.rework.add(key(e.repo, e.pr));
    else out.bad += 1;
  }
  return out;
}

const round1 = (x) => Math.round(x * 10) / 10;
const rate = (num, den) => (den > 0 ? round1((100 * num) / den) : UNKNOWN);

/**
 * @param {{repo: string, pr: number, mergedAt: string, startedAt?: string|null, fixCommits?: number|null}[]} changes
 * @param {ReturnType<typeof parseLedger>} ledger
 * @returns one row per ISO week that has a merged change, oldest first
 */
export function summarize(changes, ledger = parseLedger("")) {
  const mergedAt = new Map();
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
    const classified = ledger.classifiedThrough !== null && cs.every((c) => c.t <= ledger.classifiedThrough);
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

export function toMarkdown(rows) {
  const head = "| Week | Deployments (merges) | Lead time, median min (n) | Change fail rate % | Recovery, median min (n) | Rework rate % | Clean merge % (n) |\n| -- | -- | -- | -- | -- | -- | -- |";
  const body = rows.map((r) => `| ${r.week} | ${r.deployments} | ${r.leadTimeMedianMin} (${r.leadTimeN}) | ${r.changeFailRatePct}${!r.classified && r.knownFailures ? ` (${r.knownFailures} known)` : ""} | ${r.recoveryMedianMin} (${r.recoveryN}) | ${r.reworkRatePct} | ${r.cleanMergeRatePct} (${r.cleanMergeN}) |`);
  return [head, ...body].join("\n");
}

/** Commits a review added: every commit after the first, merges of the base branch aside. */
export function fixCommitCount(commits) {
  if (!Array.isArray(commits) || !commits.length) return null;
  return Math.max(0, commits.filter((c) => !/^Merge /.test(String(c?.messageHeadline ?? ""))).length - 1);
}

export function parseArgs(argv) {
  const o = { json: false, state: null, ledger: null };
  const want = { "--repos": "repos", "--since": "since", "--state": "state", "--ledger": "ledger" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") o.json = true;
    else if (want[argv[i]] && i + 1 < argv.length) o[want[argv[i]]] = argv[++i];
    else return { error: `unknown or incomplete argument: ${argv[i]}` };
  }
  if (!o.repos || !o.since) return { error: "--repos and --since are required" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.since) || ms(o.since) === null) return { error: "--since must be YYYY-MM-DD" };
  o.repos = o.repos.split(",").map((s) => s.trim()).filter(Boolean);
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
    for (const repo of o.repos) {
      const prs = gh(["pr", "list", "-R", repo, "--state", "merged", "--search", `head:muse/ merged:>=${o.since}`, "--limit", "200", "--json", "number,headRefName,mergedAt"]);
      for (const p of prs.filter((x) => String(x.headRefName).startsWith("muse/"))) {
        const commits = gh(["pr", "view", String(p.number), "-R", repo, "--json", "commits"]).commits;
        changes.push({ repo, pr: p.number, mergedAt: p.mergedAt, startedAt: started.get(`${repo} ${p.headRefName}`) ?? null, fixCommits: fixCommitCount(commits) });
      }
    }
  } catch (e) { console.error(`dora: ${e.message}`); return 1; }
  let ledger = parseLedger("");
  if (o.ledger) { try { ledger = parseLedger(readFileSync(o.ledger, "utf8")); } catch (e) { console.error(`dora: ${e.message}`); return 2; } }
  const rows = summarize(changes, ledger);
  if (o.json) console.log(JSON.stringify({ since: o.since, repos: o.repos, changes: changes.length, ledgerLinesIgnored: ledger.bad, rows }, null, 1));
  else {
    console.log(toMarkdown(rows));
    console.log(`\n${changes.length} merged bot change(s) since ${o.since} in ${o.repos.join(", ")}. A merge stands in for a deployment. "unknown" means not measured, not zero.`);
    if (ledger.bad) console.log(`${ledger.bad} ledger line(s) ignored as malformed.`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
