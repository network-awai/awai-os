#!/usr/bin/env node
// Second review and delivery for one pull request that changes the developer
// bots themselves (otehon/dev-bots/). Tracking: AWAI-3609.
//
//   node kantoku-run.mjs --repo <owner/name> --pr <number> --task <task.json>
//        --result <result.json> --work <new-empty-dir> [--dry-run] [--reuse-verdict]
//
// Run it from a trusted checkout (the default branch), never from the pull
// request under review: the gate, this step and the kantoku prompt are read
// from the directory this file is in.
//
//   --task    the task file the implementing host was given (queue-sync keeps
//             it as <state>/<name>/task.json): issue, repo, branch, tests.
//   --result  that entry's result.json (<state>/<name>/result.json): it holds
//             the ordinary gate's decision for the delivery.
//   --work    a directory that does not exist yet. The pull request head is
//             cloned there; scratch files go under <work>/.agent-output/.
//
// Steps: read the pull request from GitHub -> clone its head -> kantoku review
// (a Muse session, prompt = kantoku/SOUL.md) -> confirm the checkout is
// untouched -> re-run the declared tests under each shell -> read the pull
// request again -> kantoku-gate.mjs decides. Only on `merge`: mark ready,
// re-read, squash-merge that exact head. `--dry-run` stops before any write to
// GitHub or Linear. Exit: 0 a decision was reached, 1 a step failed, 2 usage
// or the inputs do not describe this pull request.
//
// Environment: MUSE_MODEL, MUSE_EFFORT, MUSE_SANDBOX_ARGS as in run-task.sh;
// DEV_BOTS_KANTOKU_SHELLS (comma-separated shell paths; default /bin/bash and
// the bash on PATH); DEV_BOTS_CLONE_BASE; DEV_BOTS_LINEAR (orca | outbox).
//
// run() takes every side effect as an injected dependency. Importing this
// file runs nothing.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decideSelfChange } from "./kantoku-gate.mjs";
import { ISSUE_RE, REPO_RE, parseTask } from "./queue.mjs";
import { recordLinearEntry, resolveLinearSink } from "./runner-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHA_RE = /^[0-9a-f]{40}$/;
const PR_FIELDS = "number,title,body,state,isDraft,headRefOid,headRefName,baseRefName,mergeable,statusCheckRollup";
const OK_CONCLUSIONS = ["SUCCESS", "NEUTRAL", "SKIPPED"];

export function parseArgs(argv) {
  const o = { dryRun: false, reuseVerdict: false };
  const want = { "--repo": "repo", "--pr": "pr", "--task": "task", "--result": "result", "--work": "work" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--reuse-verdict") o.reuseVerdict = true;
    else if (want[a]) {
      if (i + 1 >= argv.length) return { error: `${a} needs a value` };
      o[want[a]] = argv[++i];
    } else return { error: `unknown argument: ${a}` };
  }
  for (const k of Object.values(want)) if (!o[k]) return { error: `--${k} is required` };
  if (!REPO_RE.test(o.repo)) return { error: "--repo must be <owner>/<name>" };
  if (!/^[1-9][0-9]{0,8}$/.test(o.pr)) return { error: "--pr must be a pull request number" };
  o.pr = Number(o.pr);
  return o;
}

/** The Linear key a developer-bot pull request title starts with, or null. */
export function issueOf(title) {
  const m = /^([A-Z][A-Z0-9]*-[0-9]+)(?=[: ])/.exec(String(title ?? ""));
  return m && ISSUE_RE.test(m[1]) ? m[1] : null;
}

/**
 * GitHub's view of a pull request, as the facts the gate takes. A check or
 * status whose result is not known to be good counts as pending: a commit
 * status has no name or conclusion, only a context and a state.
 */
export function prFacts(repo, view) {
  const failing = [];
  const pending = [];
  for (const c of Array.isArray(view?.statusCheckRollup) ? view.statusCheckRollup : []) {
    const name = String(c?.name ?? c?.context ?? "unnamed");
    if (c?.__typename === "StatusContext" || (c?.context !== undefined && c?.conclusion === undefined)) {
      if (c.state === "SUCCESS") continue;
      (["FAILURE", "ERROR"].includes(c.state) ? failing : pending).push(name);
    } else if (c?.status !== undefined && c.status !== "COMPLETED") pending.push(name);
    else if (OK_CONCLUSIONS.includes(c?.conclusion)) continue;
    else if (c?.conclusion) failing.push(name);
    else pending.push(name);
  }
  return {
    repo,
    number: view?.number,
    head: view?.headRefOid,
    issue: issueOf(view?.title),
    state: view?.state,
    isDraft: view?.isDraft === true,
    mergeable: view?.mergeable === "MERGEABLE" ? true : view?.mergeable === "CONFLICTING" ? false : null,
    failingChecks: failing,
    pendingChecks: pending,
    branch: view?.headRefName,
    base: view?.baseRefName,
    title: String(view?.title ?? ""),
    body: String(view?.body ?? ""),
  };
}

/** Why the task and result files do not describe this pull request ([] when they do). */
export function inputProblems({ repo, pr, taskText, resultText }) {
  const p = [];
  const t = parseTask(taskText ?? "");
  if (!t.ok) return [`task file: ${t.reason}`];
  if (t.task.repo !== repo) p.push("task file is for another repository");
  if (t.task.issue !== pr.issue) p.push("task file is for another issue than the pull request title");
  if (t.task.branch !== pr.branch) p.push("task file is for another branch");
  let result = null;
  try { result = JSON.parse(resultText ?? ""); } catch { result = null; }
  if (!result || typeof result !== "object") return [...p, "result file is not JSON"];
  if (result.repo !== repo || result.issue !== t.task.issue || result.branch !== t.task.branch) p.push("result file is for another task");
  const url = String(result.deliver?.pr ?? "");
  if (url !== `https://github.com/${repo}/pull/${pr.number}`) p.push("result file names another pull request");
  return p;
}

/**
 * The task file's test settings. parseTask() keeps only issue, repo and branch;
 * the rest is read here, and anything not of the expected kind is dropped.
 */
export function taskSettings(taskText) {
  let t = {};
  try { t = JSON.parse(String(taskText ?? "")) ?? {}; } catch { t = {}; }
  const tests = Array.isArray(t.tests) ? t.tests.filter((c) => typeof c === "string" && c.trim() !== "") : [];
  const cwd = typeof t.test_cwd === "string" && t.test_cwd !== "" && !t.test_cwd.startsWith("/")
    && !t.test_cwd.split("/").includes("..") ? t.test_cwd : ".";
  const timeout = Number.isInteger(t.test_timeout_s) && t.test_timeout_s > 0 && t.test_timeout_s <= 7200 ? t.test_timeout_s : 1800;
  return { tests, test_cwd: cwd, test_timeout_s: timeout, done_on_merge: t.done_on_merge !== false };
}

/** files and added lines from `git diff --no-renames --numstat -z` and `--unified=0`. */
export function readChange(numstatZ, diffText) {
  const files = String(numstatZ).split("\0").filter(Boolean).map((l) => {
    const [a, , ...rest] = l.split("\t");
    const binary = a === "-";
    return { path: rest.join("\t"), added: binary ? 0 : Number(a), binary };
  });
  const addedLines = [];
  let cur = "";
  for (const l of String(diffText).split("\n")) {
    if (l.startsWith("+++ b/")) cur = l.slice(6);
    else if (l.startsWith("+") && !l.startsWith("+++")) addedLines.push({ path: cur, text: l.slice(1) });
  }
  return { files, addedLines };
}

/** Paths `git status --porcelain` reports outside the scratch directory. */
export function dirtyPaths(porcelain) {
  return String(porcelain).split("\n").filter(Boolean).map((l) => l.slice(3)).filter((p) => !/^"?\.agent-output\//.test(p));
}

/** The environment the pull request's tests get: no credentials, a scratch home, one shell first on PATH. */
export function testEnv(env, shellPath, home) {
  const out = { PATH: [dirname(shellPath), env.PATH ?? "/usr/bin:/bin"].join(delimiter), HOME: home, LANG: env.LANG ?? "C" };
  for (const k of ["TMPDIR", "TERM", "TZ"]) if (env[k]) out[k] = env[k];
  return out;
}

export function commentBody({ pr, decision, verdict, tests, merged, dryRun }) {
  const state = dryRun ? "Dry run: nothing was changed on GitHub."
    : merged ? `Merged (squash) as \`${merged.commit}\` at ${merged.at}.`
    : `Not merged: decision **${decision.action}**; the pull request was left as it was.`;
  const reasons = decision.reasons.map((r) => `- ${r.level}: ${r.text}`).join("\n") || "- none";
  const ran = tests.map((t) => `- \`${t.cmd}\` under ${t.shell}: exit ${t.exit}`).join("\n") || "- none";
  const v = verdict && typeof verdict === "object" ? verdict : {};
  const list = (xs, f) => (Array.isArray(xs) && xs.length ? xs.map(f).join("\n") : "- none");
  return [
    `Second review (kantoku) of https://github.com/${pr.repo}/pull/${pr.number} at head \`${pr.head}\`. ${state}`,
    `**kantoku**: ${String(v.decision ?? "no verdict")} — ${String(v.summary ?? "no summary").slice(0, 600)}`,
    `**Findings**\n${list(v.findings, (f) => `- ${String(f?.severity ?? "?")}: ${String(f?.where ?? "?")} ${String(f?.what ?? "").slice(0, 200)}`)}`,
    `**Mutations tried**\n${list(v.mutations, (m) => `- ${String(m?.what ?? "?").slice(0, 160)} → ${m?.caught_by ? `caught by ${String(m.caught_by).slice(0, 120)}` : "not caught"}`)}`,
    `**Not verified by kantoku**\n${list(v.unverified, (u) => `- ${String(u).slice(0, 200)}`)}`,
    `**Tests re-run by the delivery step**\n${ran}`,
    `**Gate reasons**\n${reasons}`,
    "A merge does not prove deployment or device acceptance.",
  ].join("\n\n");
}

/**
 * @param {{repo: string, pr: number, taskText: string, resultText: string, work: string,
 *          dryRun?: boolean, reuseVerdict?: boolean, shells: string[], env: object}} opts
 * @param {object} deps  gh(args) -> stdout; git(args, cwd?) -> stdout; review(work) -> exit code;
 *        runTest(shell, cmd, cwd, env, timeoutMs) -> {status, output}; shellLabel(shell) -> string;
 *        readFile, writeFile, mkdirp, exists, sleep(seconds), recordLinear(issue, kind, payload), log
 */
export function run(opts, deps) {
  const { repo, work, dryRun = false, reuseVerdict = false, shells, env } = opts;
  const { gh, git, review, runTest, shellLabel, readFile, writeFile, mkdirp, exists, sleep, recordLinear, log } = deps;
  const out = join(work, ".agent-output");
  const view = () => prFacts(repo, JSON.parse(gh(["pr", "view", String(opts.pr), "-R", repo, "--json", PR_FIELDS])));
  const fail = (code, text) => { log(`error ${text}`); return { exitCode: code, error: text }; };

  // 1. the pull request, and whether the inputs describe it
  let pr;
  try { pr = view(); } catch (e) { return fail(1, `cannot read the pull request: ${String(e?.message ?? e).slice(0, 200)}`); }
  if (!SHA_RE.test(pr.head ?? "")) return fail(1, "GitHub gave no head commit");
  const ip = inputProblems({ repo, pr, taskText: opts.taskText, resultText: opts.resultText });
  if (ip.length) return fail(2, ip.join("; "));
  const task = taskSettings(opts.taskText);
  const first = JSON.parse(opts.resultText).deliver?.decision ?? null;
  if (pr.state !== "OPEN") return fail(2, `pull request is ${pr.state}`);

  // 2. a clean checkout of exactly that head
  if (exists(work) && !reuseVerdict) return fail(2, "--work must not exist yet");
  if (!exists(work)) {
    try {
      git(["clone", "-q", "--filter=blob:none", `${env.DEV_BOTS_CLONE_BASE ?? "https://github.com/"}${repo}.git`, work]);
      git(["fetch", "-q", "origin", `+refs/pull/${pr.number}/head:refs/remotes/origin/kantoku-head`, `+refs/heads/${pr.base}:refs/remotes/origin/kantoku-base`], work);
      git(["checkout", "-q", "--detach", "refs/remotes/origin/kantoku-head"], work);
    } catch (e) { return fail(1, `checkout failed: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  const headNow = () => git(["rev-parse", "HEAD"], work).trim();
  if (headNow() !== pr.head) return fail(1, "the checkout is not the pull request head");
  const mergeBase = git(["merge-base", "HEAD", "refs/remotes/origin/kantoku-base"], work).trim();
  mkdirp(out);

  // 3. the review (a model; its output is a claim the gate checks)
  if (!reuseVerdict) {
    writeFile(join(out, "kantoku-task.json"), `${JSON.stringify({
      repo, pr: pr.number, head: pr.head, base: mergeBase, issue: pr.issue, tests: task.tests, test_cwd: task.test_cwd,
    }, null, 1)}\n`);
    writeFile(join(out, "pr-body.md"), pr.body);
    const rc = review(work);
    if (rc !== 0) return fail(1, `the kantoku session exited ${rc}`);
  }
  let verdict = null;
  try { verdict = JSON.parse(readFile(join(out, "kantoku-verdict.json"))); } catch { verdict = null; }

  // 4. the reviewer must have left the checkout as it was
  const dirty = dirtyPaths(git(["status", "--porcelain", "--untracked-files=all"], work));
  if (headNow() !== pr.head || dirty.length) {
    return fail(1, `the checkout changed during the review: ${dirty.slice(0, 5).join(", ") || "HEAD moved"}`);
  }

  // 5. the declared tests, here, once per shell, without this host's credentials
  const { files, addedLines } = readChange(
    git(["diff", "--no-renames", "--numstat", "-z", mergeBase, "HEAD"], work),
    git(["diff", "--no-renames", "--unified=0", "--no-color", mergeBase, "HEAD"], work),
  );
  const home = join(out, "home");
  mkdirp(home);
  const tests = [];
  let n = 0;
  for (const shell of shells) {
    const label = shellLabel(shell);
    for (const cmd of task.tests) {
      const r = runTest(shell, cmd, join(work, task.test_cwd), testEnv(env, shell, home), task.test_timeout_s * 1000);
      writeFile(join(out, `kantoku-test-${n++}.log`), `$ ${cmd}\nshell=${shell} (${label})\n${r.output ?? ""}\nexit=${r.status}\n`);
      tests.push({ cmd, shell: label, exit: r.status ?? 1 });
    }
  }

  // 6. decide on GitHub's facts as they are now
  const decideNow = () => {
    const now = view();
    return { now, decision: decideSelfChange({ pr: now, first, verdict, files, addedLines, tests }) };
  };
  let { now, decision } = decideNow();
  let merged = null;
  if (decision.action === "merge" && !dryRun) {
    if (now.isDraft) gh(["pr", "ready", String(pr.number), "-R", repo]);
    sleep(20);
    ({ now, decision } = decideNow()); // marking ready can start checks
    if (decision.action === "merge" && now.head === pr.head) {
      gh(["pr", "merge", String(pr.number), "-R", repo, "--squash", "--match-head-commit", pr.head]);
      const m = JSON.parse(gh(["pr", "view", String(pr.number), "-R", repo, "--json", "state,mergedAt,mergeCommit"]));
      if (m.state === "MERGED") merged = { commit: m.mergeCommit?.oid, at: m.mergedAt };
    } else if (pr.isDraft) gh(["pr", "ready", String(pr.number), "-R", repo, "--undo"]);
  }

  // 7. record
  const report = { repo, pr: pr.number, head: pr.head, issue: pr.issue, decision, tests, files: files.length, merged, dryRun };
  writeFile(join(out, "kantoku-comment.md"), commentBody({ pr, decision, verdict, tests, merged, dryRun }));
  if (!dryRun) {
    report.linearComment = recordLinear(pr.issue, "comment", { bodyFile: join(out, "kantoku-comment.md") });
    if (merged && task.done_on_merge && !(first?.deferred ?? []).length) report.linearStatus = recordLinear(pr.issue, "status", { to: "Done" });
  }
  writeFile(join(out, "kantoku-result.json"), `${JSON.stringify(report, null, 1)}\n`);
  log(`${decision.action} ${repo}#${pr.number} ${pr.head}${merged ? ` merged ${merged.commit}` : ""}${dryRun ? " dry-run" : ""}`);
  for (const r of decision.reasons) log(`  ${r.level}: ${r.text}`);
  return { exitCode: 0, report };
}

export function defaultShells(env, exists) {
  if (env.DEV_BOTS_KANTOKU_SHELLS) return env.DEV_BOTS_KANTOKU_SHELLS.split(",").map((s) => s.trim()).filter(Boolean);
  const found = ["/bin/bash"];
  for (const d of String(env.PATH ?? "").split(delimiter)) {
    const p = join(d, "bash");
    if (d && p !== "/bin/bash" && exists(p)) { found.push(p); break; }
  }
  return found;
}

export function main(argv, env = process.env) {
  const o = parseArgs(argv);
  if (o.error) { console.error(`kantoku-run: ${o.error}`); return 2; }
  let taskText, resultText;
  try { taskText = readFileSync(o.task, "utf8"); resultText = readFileSync(o.result, "utf8"); } catch (e) {
    console.error(`kantoku-run: ${e.message}`); return 2;
  }
  const work = resolve(o.work);
  const cmd = (bin, args, opt = {}) => {
    const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 1 << 28, ...opt });
    if (r.status !== 0) throw new Error(`${bin} ${args.slice(0, 3).join(" ")}: ${String(r.stderr ?? r.error?.message ?? "").trim().slice(0, 300)}`);
    return r.stdout;
  };
  const sink = resolveLinearSink({ env });
  const sandbox = (env.MUSE_SANDBOX_ARGS ?? "--sandbox-network enabled").split(/\s+/).filter(Boolean);
  const r = run({ ...o, taskText, resultText, work, shells: defaultShells(env, existsSync), env }, {
    gh: (args) => cmd("gh", args),
    git: (args, cwd) => cmd("git", args, cwd ? { cwd } : {}),
    review: (dir) => {
      const out = join(dir, ".agent-output");
      writeFileSync(join(out, "kantoku-prompt.md"), readFileSync(join(HERE, "kantoku", "SOUL.md"), "utf8"));
      writeFileSync(join(out, "kantoku.start"), `${new Date().toISOString()}\n`);
      const m = spawnSync("muse", ["exec", "--json", "--model", env.MUSE_MODEL ?? "muse-spark-1.3", "--reasoning-effort", env.MUSE_EFFORT ?? "high",
        "--trust-workspace", "--disable-approval", ...sandbox, "--workspace", ".", "--prompt-file", ".agent-output/kantoku-prompt.md"],
      { cwd: dir, encoding: "utf8", maxBuffer: 1 << 30 });
      writeFileSync(join(out, "kantoku.jsonl"), m.stdout ?? "");
      writeFileSync(join(out, "kantoku.err"), m.stderr ?? "");
      writeFileSync(join(out, "kantoku.end"), `${new Date().toISOString()}\n`);
      return m.status ?? 1;
    },
    runTest: (shell, c, cwd, e, timeout) => {
      const t = spawnSync(shell, ["-c", c], { cwd, env: e, encoding: "utf8", maxBuffer: 1 << 28, timeout });
      return { status: t.status ?? 1, output: `${t.stdout ?? ""}\n${t.stderr ?? ""}` };
    },
    shellLabel: (shell) => {
      const v = spawnSync(shell, ["-c", 'printf "%s %s" "${0##*/}" "${BASH_VERSION:-${ZSH_VERSION:-unknown}}"'], { encoding: "utf8" });
      return `${shell} ${(v.stdout ?? "").trim().split(" ").pop() || "unknown"}`;
    },
    readFile: (p) => readFileSync(p, "utf8"),
    writeFile: (p, s) => writeFileSync(p, s),
    mkdirp: (p) => mkdirSync(p, { recursive: true }),
    exists: (p) => existsSync(p),
    sleep: (s) => spawnSync("sleep", [String(s)]),
    recordLinear: (issue, kind, payload) => recordLinearEntry(
      { sink, outDir: join(work, ".agent-output"), issue, kind, payload },
      { runOrca: (args) => spawnSync("orca", args, { encoding: "utf8" }), writeFile: (p, s) => writeFileSync(p, s),
        mkdir: (p) => mkdirSync(p, { recursive: true }), readFile: (p) => readFileSync(p, "utf8") },
    ).posted,
    log: (line) => console.log(line),
  });
  return r.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
