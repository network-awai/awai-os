#!/usr/bin/env node
// Deterministic delivery for one developer-bot task: re-run tests outside the agent sandbox, apply the
// merge gate, then commit, push, open the PR, merge (squash) when the gate allows, and record in Linear.
// Usage: node deliver.mjs <task-dir> [--dry-run]
// One delivery at a time on a host: a lock directory serialises the single reviewer/merger (shinsa).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decide } from "./gate.mjs";
import { resolveLinearSink, resolveTestShell, recordLinearEntry, sandboxReport } from "./runner-env.mjs";

const [dir, flag] = process.argv.slice(2);
const dry = flag === "--dry-run";
if (!dir) { console.error("usage: deliver.mjs <task-dir> [--dry-run]"); process.exit(2); }
const out = join(dir, ".agent-output");
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, ...o });
const json = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const task = json(join(out, "task.json"));
const verdict = json(join(out, "verdict.json"));
if (!task) { console.error("missing .agent-output/task.json"); process.exit(2); }

const lock = join(process.env.SHINSA_LOCK_DIR ?? join(homedir(), ".local/state/itonami-dev-bots"), "shinsa.lock");
mkdirSync(join(lock, ".."), { recursive: true });
for (let i = 0; ; i++) {
  try { mkdirSync(lock); break; } catch { if (i > 720) { console.error("lock busy"); process.exit(3); } spawnSync("sleep", ["5"]); }
}
const unlock = () => { try { rmdirSync(lock); } catch {} };
process.on("exit", unlock);

function usage() {
  const rows = [];
  for (const f of readdirSync(out).filter((n) => /^run\d+\.jsonl$/.test(n)).sort()) {
    const by = new Map(); // one run.usage stream per command; keep the last (cumulative) record of each
    for (const line of readFileSync(join(out, f), "utf8").split("\n")) {
      if (!line.includes('"run.usage"')) continue;
      try { const e = JSON.parse(line); if (e.payload_type === "run.usage") by.set(e.payload.command_id, e.payload); } catch {}
    }
    const t = { run: f.replace(".jsonl", ""), calls: 0, input: 0, cached: 0, output: 0, reasoning: 0, model: "unknown" };
    for (const u of by.values()) for (const m of u.models ?? []) {
      t.model = m.model; t.calls += m.calls; t.input += m.input_tokens; t.cached += m.cached_tokens; t.output += m.output_tokens; t.reasoning += m.reasoning_tokens;
    }
    rows.push(by.size ? t : { ...t, calls: "unknown", input: "unknown", cached: "unknown", output: "unknown", reasoning: "unknown" });
  }
  return rows;
}

// Commit whatever the bots left (scratch output excluded), then read the whole branch against its base, so
// a second delivery of an already pushed branch is judged on the same facts as the first.
const base = JSON.parse(execFileSync("gh", ["repo", "view", task.repo, "--json", "defaultBranchRef"], { encoding: "utf8" })).defaultBranchRef.name;
sh("git", ["add", "-A", "--", ".", ":!.agent-output", ":!**/target/**", ":!**/node_modules/**"]);
const staged = sh("git", ["diff", "--cached", "--name-only"]).trim() !== "";
function readChange(range) {
  const files = sh("git", ["diff", ...range, "--numstat", "-z"]).split("\0").filter(Boolean).map((l) => {
    const [a, , path] = l.split("\t");
    const binary = a === "-";
    let bytes = 0; try { bytes = statSync(join(dir, path)).size; } catch {}
    return { path, added: binary ? 0 : Number(a), binary, bytes };
  });
  const addedLines = [];
  let cur = "";
  for (const l of sh("git", ["diff", ...range, "--unified=0", "--no-color"]).split("\n")) {
    if (l.startsWith("+++ b/")) cur = l.slice(6);
    else if (l.startsWith("+") && !l.startsWith("+++")) addedLines.push({ path: cur, text: l.slice(1) });
  }
  return { files, addedLines };
}
sh("git", ["fetch", "-q", "origin", base]);
const mergeBase = sh("git", ["merge-base", "HEAD", `origin/${base}`]).trim();
// Index against the merge base = committed branch work plus what is staged now.
const { files, addedLines } = readChange(["--cached", mergeBase]);

// Tests run here, outside the agent sandbox; the agent's own report is not trusted.
// The shell is /bin/zsh when it exists, otherwise /bin/bash (override: DEV_BOTS_TEST_SHELL).
const TEST_SHELL = resolveTestShell({ env: process.env, exists: existsSync });
let testIndex = 0;
const tests = (task.tests ?? []).map((cmd) => {
  const r = spawnSync(TEST_SHELL, ["-lc", cmd], { cwd: join(dir, task.test_cwd ?? "."), encoding: "utf8", maxBuffer: 1 << 28, timeout: (task.test_timeout_s ?? 1800) * 1000 });
  writeFileSync(join(out, `deliver-test-${testIndex++}.log`), `$ ${cmd}\nshell=${TEST_SHELL}\n${r.stdout ?? ""}\n${r.stderr ?? ""}\nexit=${r.status}\n`);
  return { cmd, shell: TEST_SHELL, exit: r.status ?? 1 };
});

// Sandbox the implementer/review runs used (recorded by run-task.sh in run<N>.meta).
// Display only: a missing sandbox never changes the gate decision, it is reported.
function collectSandbox() {
  let metas = [];
  try {
    metas = readdirSync(out).filter((n) => /^run\d+\.meta$/.test(n)).sort().map((n) => {
      let meta = null;
      try { meta = JSON.parse(readFileSync(join(out, n), "utf8")); } catch {}
      return { run: n.replace(/\.meta$/, ""), meta };
    });
  } catch {}
  return sandboxReport(metas);
}
const sandbox = collectSandbox();

// Linear record sink: "orca" (default) or "outbox" (DEV_BOTS_LINEAR=outbox writes
// JSON under .agent-output/linear-outbox/ instead of calling orca). Recording
// never changes the gate decision, which is already computed above.
const linearSink = resolveLinearSink({ env: process.env });
const linearOutboxFiles = [];
const recordLinear = (kind, payload) => {
  const r = recordLinearEntry(
    { sink: linearSink, outDir: out, issue: task.issue, kind, payload },
    {
      runOrca: (args) => spawnSync("orca", args, { encoding: "utf8" }),
      writeFile: (p, s) => writeFileSync(p, s),
      mkdir: (p) => mkdirSync(p, { recursive: true }),
      readFile: (p) => readFileSync(p, "utf8"),
    },
  );
  if (r.file) linearOutboxFiles.push(r.file);
  return r;
};

let decision = decide({ task, verdict, files, addedLines, tests });
const report = { task: task.issue, at: new Date().toISOString(), decision, tests, files: files.length, usage: usage(), testShell: TEST_SHELL, linearSink, sandbox: { disabled: sandbox.disabled, note: sandbox.note } };
const finish = (extra) => { Object.assign(report, extra); writeFileSync(join(out, "deliver.json"), JSON.stringify(report, null, 1)); console.log(JSON.stringify(report.decision), report.pr ?? ""); };
if (dry || !files.length) { finish({ dryRun: dry }); process.exit(0); }

// A hold means something is wrong (failed tests, rejected review, secret-like content, wrong repository).
// Nothing leaves the host: no commit, no push, no PR. Only the Linear record says why.
if (decision.action === "hold") {
  sh("git", ["reset", "-q"]);
  const why = decision.reasons.map((r) => `- ${r.level}: ${r.text}`).join("\n");
  const tested = tests.map((t) => `- \`${t.cmd}\` exit ${t.exit}`).join("\n") || "- none declared";
  writeFileSync(join(out, "linear-comment.md"), `Developer-bot delivery for ${task.issue}: **held**, nothing was committed or pushed.\n\n**Reasons**\n${why}\n\n**Tests run outside the agent sandbox** (shell: \`${TEST_SHELL}\`)\n${tested}\n\n**Review (shinsa)**: ${verdict?.summary ?? "no verdict"}\n\n${sandbox.note}\n\nThe change stays in the task directory on the host until the reason is fixed.`);
  const c = recordLinear("comment", { bodyFile: join(out, "linear-comment.md") });
  finish({ held: true, linearSink, linearComment: c.posted, ...(c.file ? { linearOutbox: [...linearOutboxFiles] } : {}) });
  process.exit(0);
}

const usageTable = ["| Run | Model | Calls | Input | of which cached | Output | of which reasoning |", "| -- | -- | -- | -- | -- | -- | -- |",
  ...report.usage.map((u) => `| ${u.run} | ${u.model} | ${u.calls} | ${u.input} | ${u.cached} | ${u.output} | ${u.reasoning} |`)].join("\n");
const reasons = decision.reasons.map((r) => `- ${r.level}: ${r.text}`).join("\n") || "- none";
const checks = tests.map((t) => `- [${t.exit === 0 ? "x" : " "}] \`${t.cmd}\` (exit ${t.exit}, run outside the agent sandbox)`).join("\n") || "- none declared";
const summary = verdict?.summary ?? "No review summary.";
const unverified = [...(decision.deferred ?? []).map((x) => `deferred acceptance item: ${x}`), ...(verdict?.unverified ?? [])].map((u) => `- ${u}`).join("\n") || "- none recorded";

if (staged) sh("git", ["commit", "-q", "-m", `${task.issue}: ${task.title}\n\nImplemented by an Itonami developer bot on Muse (muse-spark-1.3); reviewed by the shinsa profile.\nGate decision: ${decision.action}.`]);
const head = sh("git", ["rev-parse", "HEAD"]).trim();
sh("git", ["push", "-q", "-u", "origin", task.branch]);
const linearRecord = linearSink === "outbox"
  ? "outbox (JSON in `.agent-output/linear-outbox/`, not posted to Linear)"
  : "orca";
const body = `Linear: ${task.issue}\n\n## Review (shinsa)\n\n${summary}\n\n## Checks\n\n${checks}\n\n## Gate\n\nDecision: **${decision.action}**\n\n${reasons}\n\n## Runner\n\n- Test shell: \`${TEST_SHELL}\`\n- ${sandbox.note}\n- Linear record: ${linearRecord}\n\n## Not verified\n\n${unverified}\n\nImplemented and reviewed by Itonami developer bots on Muse; delivered by \`otehon/dev-bots/deliver.mjs\`.\n`;
writeFileSync(join(out, "pr-body.md"), body);
let pr = null, wasDraft = false;
try { const e = JSON.parse(sh("gh", ["pr", "view", task.branch, "-R", task.repo, "--json", "url,isDraft,state"])); if (e.state === "OPEN") { pr = e.url; wasDraft = e.isDraft; } } catch {}
if (pr) sh("gh", ["pr", "edit", pr, "--body-file", join(out, "pr-body.md")]);
else {
  const prArgs = ["pr", "create", "-R", task.repo, "--head", task.branch, "--title", `${task.issue}: ${task.title}`, "--body-file", join(out, "pr-body.md")];
  if (decision.action !== "merge") prArgs.push("--draft");
  pr = sh("gh", prArgs).trim().split("\n").pop();
}
if (decision.action === "merge" && wasDraft) sh("gh", ["pr", "ready", pr]);

let merged = null;
if (decision.action === "merge") {
  spawnSync("sleep", ["20"]);
  const v = JSON.parse(sh("gh", ["pr", "view", pr, "--json", "mergeable,statusCheckRollup,headRefOid"]));
  const roll = v.statusCheckRollup ?? [];
  const prState = {
    mergeable: v.mergeable === "MERGEABLE" ? true : v.mergeable === "CONFLICTING" ? false : undefined,
    failingChecks: roll.filter((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(c.conclusion ?? c.state)).map((c) => c.name ?? c.context),
    pendingChecks: roll.filter((c) => !(c.conclusion ?? "") && !["SUCCESS", "FAILURE", "ERROR"].includes(c.state ?? "")).map((c) => c.name ?? c.context),
  };
  decision = decide({ task, verdict, files, addedLines, tests, pr: prState });
  report.decision = decision;
  if (decision.action === "merge" && v.headRefOid === head) {
    sh("gh", ["pr", "merge", pr, "--squash", "--match-head-commit", head]);
    const m = JSON.parse(sh("gh", ["pr", "view", pr, "--json", "state,mergedAt,mergeCommit"]));
    if (m.state === "MERGED") merged = { commit: m.mergeCommit?.oid, at: m.mergedAt };
  } else sh("gh", ["pr", "ready", pr, "--undo"]);
}

const state = merged ? `Merged (squash) as \`${merged.commit}\` at ${merged.at}.` : `Not merged: gate decision **${decision.action}**.`;
const comment = `Developer-bot delivery for ${task.issue} — PR ${pr} (head \`${head}\`). ${state}\n\n**Review (shinsa)**: ${summary}\n\n**Checks**\n${checks}\n\n**Gate reasons**\n${decision.reasons.map((r) => `- ${r.level}: ${r.text}`).join("\n") || "- none"}\n\n**Not verified**\n${unverified}\n\n**Muse usage** (source: \`run.usage\` events of \`muse exec --json\`; \`unknown\` where a run recorded none)\n\n${usageTable}\n\nA merge does not prove deployment or device acceptance.`;
writeFileSync(join(out, "linear-comment.md"), comment);
const c = recordLinear("comment", { bodyFile: join(out, "linear-comment.md") });
if (merged && task.done_on_merge !== false && !decision.deferred?.length) recordLinear("status", { to: "Done" });
finish({ pr, head, merged, linearSink, linearComment: c.posted, ...(linearOutboxFiles.length ? { linearOutbox: [...linearOutboxFiles] } : {}) });
