// Queue core for the dev-bots queue runner (queue-runner.sh).
//
// This module holds the logic that can be tested without processes:
// validating an entry, choosing the next entry, and building result.json.
// Every side effect lives in the shell script; importing this file runs
// nothing. Only running it as a CLI wires the real fs (validate-entry and
// write-result helpers the shell uses so the regexes live in exactly one
// place).
//
// Queue layout under <queue-dir>/:
//   inbox/<name>/   task.json + muse-prompt.md + ready
//   running/<name>/  entry being worked on
//   done/<name>/     result.json with state "done"
//   failed/<name>/   result.json with state "failed" and a reason
//   work/<name>/     clone of the task repository (never deleted by us)
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
export const ISSUE_RE = /^[A-Z][A-Z0-9]*-[0-9]+$/;
export const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
export const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/;

/** Split "owner/name" after it passed REPO_RE. */
export function splitRepo(repo) {
  const i = String(repo).indexOf("/");
  return { owner: String(repo).slice(0, i), name: String(repo).slice(i + 1) };
}

/** Parse a comma-separated owner allowlist; empty entries are dropped. */
export function parseOwners(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** null when the entry name is fine, otherwise a short fixed reason. */
export function validateName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) return "bad-name";
  return null;
}

/**
 * Parse and check task.json text.
 * @returns {{ok: true, task: {issue, repo, branch}} | {ok: false, reason: string}}
 * Reasons are fixed codes; they never echo task content.
 */
export function parseTask(text) {
  let task;
  try {
    task = JSON.parse(String(text ?? ""));
  } catch {
    return { ok: false, reason: "bad-task-json" };
  }
  if (task === null || typeof task !== "object" || Array.isArray(task)) {
    return { ok: false, reason: "bad-task-json" };
  }
  if (typeof task.issue !== "string" || !ISSUE_RE.test(task.issue)) {
    return { ok: false, reason: "bad-issue" };
  }
  if (
    typeof task.repo !== "string" ||
    !REPO_RE.test(task.repo) ||
    task.repo.includes("..")
  ) {
    return { ok: false, reason: "bad-repo" };
  }
  if (
    typeof task.branch !== "string" ||
    !BRANCH_RE.test(task.branch) ||
    task.branch.includes("..") ||
    task.branch.includes("//") ||
    task.branch.endsWith("/") ||
    task.branch.endsWith(".lock") ||
    task.branch === "main" ||
    task.branch === "master"
  ) {
    return { ok: false, reason: "bad-branch" };
  }
  return { ok: true, task: { issue: task.issue, repo: task.repo, branch: task.branch } };
}

/**
 * Validate one queue entry before anything is cloned. Fail closed.
 *
 * @param {{name: string, taskText: string|null, promptExists: boolean,
 *          promptNonEmpty: boolean, owners: string[]}} entry
 * @returns {{ok: true, task} | {ok: false, reason: string}}
 */
export function validateEntry({ name, taskText, promptExists, promptNonEmpty, owners = [] } = {}) {
  const badName = validateName(name);
  if (badName) return { ok: false, reason: badName };
  if (typeof taskText !== "string") return { ok: false, reason: "bad-task-json" };
  const parsed = parseTask(taskText);
  if (!parsed.ok) return parsed;
  if (!promptExists || !promptNonEmpty) return { ok: false, reason: "bad-prompt" };
  if (!owners.includes(splitRepo(parsed.task.repo).owner)) {
    return { ok: false, reason: "owner-not-allowed" };
  }
  return { ok: true, task: parsed.task };
}

/**
 * Choose the next entry: ascending name order, first one with a ready marker.
 * @param {{name: string, ready: boolean}[]} entries
 * @returns {string|null} the winning name, or null when none is ready.
 */
export function pickNext(entries = []) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of sorted) {
    if (e?.ready) return e.name;
  }
  return null;
}

/**
 * Read the delivery record out of a deliver.json text.
 * @returns {{decision, pr, merged} | null} null when absent or unparseable.
 */
export function parseDeliverRecord(text) {
  if (text === null || text === undefined) return null;
  let obj;
  try {
    obj = JSON.parse(String(text));
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
  return {
    decision: obj.decision ?? null,
    pr: obj.pr ?? null,
    merged: obj.merged ?? null,
  };
}

/**
 * Build the result.json object for a finished entry.
 * @param {{name: string, task: {issue, repo, branch}, state: "done"|"failed",
 *          reason: string, started: string, ended: string,
 *          pipeline: string, deliver: {decision, pr, merged}|null}} opts
 */
export function buildResult({ name, task = {}, state, reason, started = "", ended = "", pipeline = "", deliver = null } = {}) {
  return {
    name,
    issue: task.issue ?? "",
    repo: task.repo ?? "",
    branch: task.branch ?? "",
    state,
    reason,
    started,
    ended,
    pipeline,
    deliver: deliver ?? null,
  };
}

/**
 * One runner.log line: UTC timestamp, name, state, reason. The reason must be
 * a fixed code from the caller, never task content and never a token.
 */
export function formatLogLine({ now, name, state, reason }) {
  return `${now} ${name} ${state} ${reason}`;
}

function usage() {
  return [
    "usage:",
    "  node queue.mjs validate-entry <name> --task <task.json> --prompt <muse-prompt.md> --owners <csv>",
    "  node queue.mjs write-result --name <n> --task <task.json|-> --state <done|failed>",
    "    --reason <code> --started <ts> --ended <ts> --pipeline <text|-> --deliver <deliver.json|-> --out <result.json>",
  ].join("\n");
}

export function main(argv, deps = {}) {
  const {
    readFile = () => { throw new Error("queue: no readFile"); },
    fileExists = () => { throw new Error("queue: no fileExists"); },
    fileNonEmpty = () => { throw new Error("queue: no fileNonEmpty"); },
    writeFile = () => { throw new Error("queue: no writeFile"); },
    log = (line) => console.log(line),
    error = (line) => console.error(line),
  } = deps;
  const [cmd, ...rest] = argv;
  if (cmd === "validate-entry") {
    let name = null;
    let taskPath = null;
    let promptPath = null;
    let ownersCsv = "";
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--task") taskPath = rest[++i];
      else if (a === "--prompt") promptPath = rest[++i];
      else if (a === "--owners") ownersCsv = rest[++i] ?? "";
      else if (!a.startsWith("-") && name === null) name = a;
      else {
        error(usage());
        return 2;
      }
    }
    if (name === null || taskPath === null || promptPath === null) {
      error(usage());
      return 2;
    }
    let taskText = null;
    try {
      taskText = readFile(taskPath);
    } catch {
      taskText = null;
    }
    const r = validateEntry({
      name,
      taskText,
      promptExists: fileExists(promptPath),
      promptNonEmpty: fileNonEmpty(promptPath),
      owners: parseOwners(ownersCsv),
    });
    if (!r.ok) {
      log(`invalid ${r.reason}`);
      return 1;
    }
    log(`ok ${r.task.issue} ${r.task.repo} ${r.task.branch}`);
    return 0;
  }
  if (cmd === "write-result") {
    const opt = {};
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a.startsWith("--")) opt[a.slice(2)] = rest[++i];
      else {
        error(usage());
        return 2;
      }
    }
    const need = ["name", "task", "state", "reason", "started", "ended", "pipeline", "deliver", "out"];
    for (const k of need) {
      if (opt[k] === undefined) {
        error(usage());
        return 2;
      }
    }
    if (opt.state !== "done" && opt.state !== "failed") {
      error(usage());
      return 2;
    }
    let task = {};
    if (opt.task !== "-") {
      try {
        const parsed = parseTask(readFile(opt.task));
        if (parsed.ok) task = parsed.task;
      } catch {
        task = {};
      }
    } else if (opt.issue) {
      task = { issue: opt.issue, repo: opt.repo ?? "", branch: opt.branch ?? "" };
    }
    let pipeline = "";
    if (opt.pipeline !== "-") {
      try {
        pipeline = String(readFile(opt.pipeline)).trim();
      } catch {
        pipeline = "";
      }
    }
    let deliver = null;
    if (opt.deliver !== "-") {
      try {
        deliver = parseDeliverRecord(readFile(opt.deliver));
      } catch {
        deliver = null;
      }
    }
    writeFile(opt.out, `${JSON.stringify(buildResult({
      name: opt.name,
      task,
      state: opt.state,
      reason: opt.reason,
      started: opt.started,
      ended: opt.ended,
      pipeline,
      deliver,
    }), null, 1)}\n`);
    return 0;
  }
  error(usage());
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    readFile: (p) => readFileSync(p, "utf8"),
    fileExists: (p) => existsSync(p),
    fileNonEmpty: (p) => {
      try {
        return statSync(p).size > 0;
      } catch {
        return false;
      }
    },
    writeFile: (p, s) => writeFileSync(p, s),
  });
}
