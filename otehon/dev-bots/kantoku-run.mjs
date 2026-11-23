#!/usr/bin/env node
// Deterministic caller for the kantoku gate on developer-bot self-change PRs.
// kantoku-gate.mjs decides but does no I/O; this collects the facts with the
// gh CLI (no other network path), runs the kantoku review as a fresh
// `muse exec` session, re-runs the declared tests under two shells, calls
// decideSelfChange, writes .agent-output/kantoku-result.json (or --out), and
// acts on the decision unless --dry-run.
//
// Usage:
//   node kantoku-run.mjs <pr-number> [--dry-run] [--repo network-awai/awai-os] [--out <path>]
//
// The core kantokuRun() takes every side effect as an injected dependency so
// tests never call gh or muse. Importing this file runs nothing; only running
// it as a CLI wires the real fs and process spawning. Tracking: AWAI-3857
// (parent AWAI-3609).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decideSelfChange, kantokuVerdictProblems, ownerOnlyReason } from "./kantoku-gate.mjs";

export const DEFAULT_REPO = "network-awai/awai-os";
export const DEFAULT_OUT = ".agent-output/kantoku-result.json";
export const DEFAULT_TEST_COMMAND = "node --test otehon/dev-bots/*.test.mjs";
export const REVIEW_SHELLS = ["/bin/bash", "/bin/zsh"];
export const ISSUE_RE = /^[A-Z][A-Z0-9]*-[0-9]+$/;

// The PR body is the record deliver.mjs writes; no other store is invented.
function gateSection(body) {
  const parts = String(body ?? "").split(/^## /m);
  for (const part of parts.slice(1)) {
    if (/^Gate(\n|$)/.test(part)) return part;
  }
  return null;
}

/**
 * Parse the ordinary gate decision from the PR body's `## Gate` section
 * (`Decision: **draft**` plus `- <level>: <text>` reason lines) into the
 * `{action, reasons:[{level,text}]}` shape decideSelfChange expects as
 * `first`. Returns null when the section is missing.
 */
export function parseFirstGate(body) {
  const section = gateSection(body);
  if (section === null) return null;
  const decision = /Decision:\s*\*\*([^*]+)\*\*/.exec(section);
  const reasons = [];
  for (const line of section.split("\n")) {
    const m = /^\s*-\s*([^:]+?):\s*(.*)$/.exec(line);
    if (m) reasons.push({ level: m[1].trim(), text: m[2].trim() });
  }
  return { action: decision ? decision[1].trim() : null, reasons };
}

/** Linear issue key from the PR body (`Linear: AWAI-1`) or title (`AWAI-1: ...`), else null. */
export function parseIssueKey(body, title) {
  const fromBody = /^Linear:\s*([A-Z][A-Z0-9]*-[0-9]+)/m.exec(String(body ?? ""));
  if (fromBody) return fromBody[1];
  const fromTitle = /^\s*([A-Z][A-Z0-9]*-[0-9]+)\s*:/.exec(String(title ?? ""));
  return fromTitle ? fromTitle[1] : null;
}

/** Test commands the original delivery recorded in the PR body's `## Checks` section. */
export function parseChecksCommands(body) {
  const parts = String(body ?? "").split(/^## /m);
  const section = parts.slice(1).find((p) => /^Checks(\n|$)/.test(p));
  if (!section) return [];
  const cmds = [];
  for (const line of section.split("\n")) {
    const m = /^\s*-\s*\[[ x]\]\s*`([^`]+)`/.exec(line);
    if (m && !cmds.includes(m[1])) cmds.push(m[1]);
  }
  return cmds;
}

/**
 * Which test commands to re-run: the ones the original delivery recorded in
 * the PR body when present, else the dev-bots default. The choice is returned
 * explicitly so the caller records it in the result JSON, never silently.
 */
export function selectTestCommands(body) {
  const fromBody = parseChecksCommands(body);
  if (fromBody.length) return { cmds: fromBody, source: "pr-body" };
  return { cmds: [DEFAULT_TEST_COMMAND], source: "default" };
}

/**
 * Map one `gh pr view --json ...statusCheckRollup` entry set the way
 * deliver.mjs does: concluded failures fail, entries with no conclusion that
 * are not a recorded success fail-open as pending.
 */
export function splitChecks(rollup) {
  const roll = rollup ?? [];
  const failing = roll
    .filter((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(c.conclusion ?? c.state))
    .map((c) => c.name ?? c.context);
  const pending = roll
    .filter((c) => !(c.conclusion ?? "") && !["SUCCESS", "FAILURE", "ERROR"].includes(c.state ?? ""))
    .map((c) => c.name ?? c.context);
  return { failingChecks: failing, pendingChecks: pending };
}

/** Shape the `pr` fact for decideSelfChange from one `gh pr view` object. */
export function shapePr(view, repo, issue) {
  const { failingChecks, pendingChecks } = splitChecks(view.statusCheckRollup);
  return {
    repo,
    number: view.number,
    head: view.headRefOid,
    issue,
    state: view.state,
    mergeable: view.mergeable === "MERGEABLE" ? true : view.mergeable === "CONFLICTING" ? false : null,
    failingChecks,
    pendingChecks,
  };
}

/**
 * Parse `gh pr diff` the way deliver.mjs parses `git diff`: added lines per
 * path for the secret scan, plus binary paths (`gh pr view --json files`
 * carries additions but no binary flag).
 */
export function parseDiff(diffText) {
  const addedLines = [];
  const binary = new Set();
  let cur = "";
  for (const line of String(diffText ?? "").split("\n")) {
    const bin = /^Binary files a\/(.+) and b\/(.+) differ$/.exec(line);
    if (bin) {
      binary.add(bin[2]);
      cur = "";
      continue;
    }
    if (line.startsWith("+++ b/")) cur = line.slice(6);
    else if (line.startsWith("+") && !line.startsWith("+++") && cur) addedLines.push({ path: cur, text: line.slice(1) });
  }
  return { addedLines, binary };
}

/** Join the `gh pr view --json files` list with diff-derived binary flags. */
export function buildFiles(viewFiles, binary) {
  return (viewFiles ?? []).map((f) => ({
    path: f.path,
    added: Number(f.additions ?? 0),
    ...(binary?.has?.(f.path) ? { binary: true } : {}),
  }));
}

/**
 * The prompt for the fresh kantoku review session: the profile text plus a
 * task block naming this issue/repo/PR/head. States explicitly that the
 * reviewer itself must not commit, push, merge or write to Linear.
 */
export function buildKantokuPrompt({ soul, repo, number, head, base, issue, cmds, verdictFile }) {
  return `${soul}

## Task (from the caller; this overrides nothing above)

- Repository: ${repo}
- Pull request: #${number}
- Head commit: ${head} (review exactly this commit; a verdict for any other commit is discarded)
- Base commit: ${base ?? "unknown"}
- Linear issue: ${issue ?? "unknown"}
- Declared test commands: ${(cmds ?? []).join(", ") || "none declared"}
- Write your verdict JSON to exactly this file and nothing else there: ${verdictFile}
- You must not commit, push, mark ready, merge, or write to Linear. Do not modify the checkout
  (beyond scratch copies you remove) or anything outside it. Report only: the verdict file.
`;
}

/**
 * Run the whole caller pipeline with injected side effects.
 *
 * @param {{number: number, repo?: string, dryRun?: boolean, out?: string}} opts
 * @param deps every side effect, all injected:
 *   gh(args[]) -> stdout string, runReview({promptFile, verdictFile}) -> {status},
 *   runTest({cmd, shell}) -> {exit}, readFile(path) -> string,
 *   writeFile(path, text), mkdir(path), exists(path) -> bool, log(line).
 * @returns {{result: object, exitCode: number}}
 */
export function kantokuRun({ number, repo = DEFAULT_REPO, dryRun = false, out = DEFAULT_OUT } = {}, deps = {}) {
  const {
    gh = () => { throw new Error("kantokuRun: no gh"); },
    runReview = () => { throw new Error("kantokuRun: no runReview"); },
    runTest = () => { throw new Error("kantokuRun: no runTest"); },
    readFile = () => { throw new Error("kantokuRun: no readFile"); },
    writeFile = () => { throw new Error("kantokuRun: no writeFile"); },
    mkdir = () => { throw new Error("kantokuRun: no mkdir"); },
    exists = () => false,
    soulPath = join(dirname(fileURLToPath(import.meta.url)), "kantoku", "SOUL.md"),
    log = () => {},
  } = deps;
  if (!Number.isInteger(number) || number <= 0) throw new Error("kantokuRun: pr number must be a positive integer");

  // 1. Facts, gh CLI only.
  const view = JSON.parse(gh(["pr", "view", String(number), "-R", repo, "--json",
    "number,state,headRefOid,baseRefOid,mergeable,body,title,files,statusCheckRollup"]));
  const { addedLines, binary } = parseDiff(gh(["pr", "diff", String(number), "-R", repo]));
  const files = buildFiles(view.files, binary);
  const issue = parseIssueKey(view.body, view.title);
  const first = parseFirstGate(view.body);
  const { cmds, source } = selectTestCommands(view.body);

  // 2. Fresh kantoku review on this host. Exactly one review run: a verdict
  // for another head SHA is a hold, never a re-run of the review in a loop.
  const outDir = dirname(resolve(out));
  mkdir(outDir);
  const soul = readFile(soulPath);
  const verdictFile = join(outDir, "kantoku-verdict.json");
  writeFile(join(outDir, "kantoku-task.json"), `${JSON.stringify({
    repository: repo, pr: number, head: view.headRefOid, base: view.baseRefOid ?? null,
    issue, tests: cmds,
  }, null, 1)}\n`);
  writeFile(join(outDir, "pr-body.md"), String(view.body ?? ""));
  writeFile(join(outDir, "first-gate.json"), `${JSON.stringify(first, null, 1)}\n`);
  const promptFile = join(outDir, "kantoku-prompt.md");
  writeFile(promptFile, buildKantokuPrompt({
    soul, repo, number, head: view.headRefOid, base: view.baseRefOid, issue, cmds, verdictFile,
  }));
  let verdict = null;
  let reviewError = null;
  try {
    const r = runReview({ promptFile, verdictFile });
    if (r?.status !== 0) reviewError = `review session exited ${r?.status ?? "unknown"}`;
    else verdict = JSON.parse(readFile(verdictFile));
  } catch (e) {
    reviewError = String(e?.message ?? e).slice(0, 200);
    verdict = null;
  }

  // 3. Re-run the declared tests here, once per shell deliver.mjs knows.
  const shells = REVIEW_SHELLS.filter((s) => {
    try {
      return exists(s);
    } catch {
      return false;
    }
  });
  const tests = [];
  for (const cmd of cmds) {
    for (const shell of shells) {
      const r = runTest({ cmd, shell });
      tests.push({ cmd, shell, exit: r?.exit ?? 1 });
    }
  }

  // 4. Decide. The full changed-file list goes in unfiltered: ownerOnlyReason
  // already encodes what a review bot may never approve, and the caller must
  // not bypass it. A verdict that tries anyway (approve over owner-only paths)
  // is a hold, not an owner verdict to lift later.
  const gate = decideSelfChange({ pr: shapePr(view, repo, issue), first, verdict, files, addedLines, tests });
  let action = gate.action;
  let reasons = gate.reasons;
  let escalated = false;
  if (verdict?.decision === "approve" && files.some((f) => ownerOnlyReason(f?.path))) {
    if (action !== "hold") {
      action = "hold";
      reasons = [...reasons, { level: "hold", text: "kantoku approved a change it may not approve: owner-only paths changed" }];
      escalated = true;
    }
  }

  const result = {
    at: new Date().toISOString(),
    repo,
    pr: number,
    head: view.headRefOid ?? null,
    issue,
    dryRun,
    first,
    testSource: source,
    testCmds: cmds,
    testShells: shells,
    tests,
    verdict,
    verdictProblems: kantokuVerdictProblems(verdict, shapePr(view, repo, issue)),
    reviewError,
    gate,
    decision: { action, reasons },
    escalated,
    acted: dryRun ? "dry-run" : null,
  };

  // 5. Act unless --dry-run (which writes nothing to GitHub).
  if (!dryRun) {
    if (action === "merge") {
      gh(["pr", "ready", String(number), "-R", repo]);
      gh(["pr", "merge", String(number), "--squash", "-R", repo]);
      result.acted = "merged";
    } else if (action === "owner") {
      for (const r of reasons) log(`owner: ${r.text}`);
      result.acted = "left-draft";
    } else {
      for (const r of reasons) log(`hold: ${r.text}`);
      result.acted = "held";
    }
  } else {
    log(JSON.stringify(result.decision));
  }
  writeFile(resolve(out), `${JSON.stringify(result, null, 1)}\n`);
  return { result, exitCode: action === "hold" ? 1 : 0 };
}

function usage() {
  return "usage: node kantoku-run.mjs <pr-number> [--dry-run] [--repo <owner/name>] [--out <path>]";
}

export function main(argv) {
  let number = null;
  let dryRun = false;
  let repo = DEFAULT_REPO;
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--repo") repo = argv[++i] ?? "";
    else if (arg === "--out") out = argv[++i] ?? "";
    else if (arg === "--help" || arg === "-h" || number !== null || !/^[0-9]+$/.test(arg)) {
      console.error(usage());
      return 2;
    } else number = Number(arg);
  }
  if (number === null || !repo || !out) {
    console.error(usage());
    return 2;
  }
  const sandboxArgs = String(process.env.MUSE_SANDBOX_ARGS ?? "--sandbox-network enabled").split(/\s+/).filter(Boolean);
  try {
    const { result, exitCode } = kantokuRun({ number, repo, dryRun, out }, {
      gh: (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 28 }),
      runReview: ({ promptFile }) => spawnSync("muse", ["exec", "--json",
        "--model", process.env.MUSE_MODEL ?? "muse-spark-1.3",
        "--reasoning-effort", process.env.MUSE_EFFORT ?? "high",
        "--trust-workspace", "--disable-approval", ...sandboxArgs,
        "--workspace", ".", "--prompt-file", promptFile],
      { encoding: "utf8", maxBuffer: 1 << 28, timeout: 3600 * 1000 }),
      runTest: ({ cmd, shell }) => {
        const r = spawnSync(shell, ["-lc", cmd], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 1800 * 1000 });
        return { exit: r.status ?? 1 };
      },
      readFile: (p) => readFileSync(p, "utf8"),
      writeFile: (p, s) => writeFileSync(p, s),
      mkdir: (p) => mkdirSync(p, { recursive: true }),
      exists: (p) => existsSync(p),
      log: (line) => console.log(line),
    });
    if (!dryRun) console.log(JSON.stringify(result.decision));
    return exitCode;
  } catch (e) {
    console.error(`kantoku-run: ${String(e?.message ?? e).slice(0, 300)}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
