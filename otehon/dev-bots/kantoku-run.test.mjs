import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { commentBody, defaultShells, dirtyPaths, inputProblems, issueOf, parseArgs, prFacts, readChange, run, taskSettings, testEnv } from "./kantoku-run.mjs";
import { KANTOKU_SCHEMA } from "./kantoku-gate.mjs";

const REPO = "network-awai/awai-os";
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const TASK = { issue: "AWAI-1", repo: REPO, branch: "muse/awai-1-x", title: "t", merge: "auto", tests: ["node --test"], done_on_merge: true };
const RESULT = { name: "n", issue: "AWAI-1", repo: REPO, branch: "muse/awai-1-x", state: "done", deliver: {
  decision: { action: "draft", reasons: [{ level: "draft", text: "owner-reviewed paths changed: otehon/dev-bots/queue.mjs" }], deferred: [] },
  pr: `https://github.com/${REPO}/pull/7`, merged: null } };
const VIEW = { number: 7, title: "AWAI-1: t", body: "body", state: "OPEN", isDraft: true, headRefOid: HEAD, headRefName: "muse/awai-1-x", baseRefName: "main", mergeable: "MERGEABLE", statusCheckRollup: [] };
const VERDICT = { schema: KANTOKU_SCHEMA, reviewer: "kantoku", issue: "AWAI-1", repo: REPO, pr: 7, head: HEAD, decision: "approve", summary: "ok",
  checks: [{ cmd: "node --test", shell: "bash 3.2", result: "9/9" }], mutations: [], findings: [], unverified: [] };

test("parseArgs: required values, a numeric pull request, no unknown flags", () => {
  const ok = ["--repo", REPO, "--pr", "7", "--task", "t.json", "--result", "r.json", "--work", "w"];
  assert.deepEqual(parseArgs(ok), { dryRun: false, reuseVerdict: false, repo: REPO, pr: 7, task: "t.json", result: "r.json", work: "w" });
  assert.equal(parseArgs([...ok, "--dry-run", "--reuse-verdict"]).dryRun, true);
  assert.ok(parseArgs(ok.slice(0, 8)).error);
  assert.ok(parseArgs([...ok, "--force"]).error);
  assert.ok(parseArgs(["--repo"]).error);
  for (const bad of ["0", "7; rm -rf x", "-1", "abc", "07"]) assert.ok(parseArgs(ok.map((a) => (a === "7" ? bad : a))).error, bad);
  for (const bad of ["awai-os", "a/b/c", "../x/y", "-R/x"]) assert.ok(parseArgs(ok.map((a) => (a === REPO ? bad : a))).error, bad);
});

test("issueOf reads the key only from the start of the title", () => {
  assert.equal(issueOf("AWAI-3596: x"), "AWAI-3596");
  assert.equal(issueOf("AWAI-3596 x"), "AWAI-3596");
  for (const t of ["fix AWAI-3596: x", "AWAI-3596x", "awai-1: x", "AWAI-: x", "", null]) assert.equal(issueOf(t), null, String(t));
});

test("prFacts: a check counts as good only when it says so", () => {
  const f = (roll) => prFacts(REPO, { ...VIEW, statusCheckRollup: roll });
  assert.deepEqual([f([]).failingChecks, f([]).pendingChecks], [[], []]);
  // A commit status has a context and a state, no name or conclusion (seen on awai-os#339: tatara/ci PENDING).
  assert.deepEqual(f([{ __typename: "StatusContext", context: "tatara/ci", state: "PENDING" }]).pendingChecks, ["tatara/ci"]);
  assert.deepEqual(f([{ context: "tatara/ci", state: "PENDING" }]).pendingChecks, ["tatara/ci"]);
  assert.deepEqual(f([{ __typename: "StatusContext", context: "c", state: "EXPECTED" }]).pendingChecks, ["c"]);
  assert.deepEqual(f([{ __typename: "StatusContext", context: "c", state: "FAILURE" }]).failingChecks, ["c"]);
  assert.deepEqual(f([{ __typename: "StatusContext", context: "c", state: "ERROR" }]).failingChecks, ["c"]);
  assert.deepEqual(f([{ __typename: "StatusContext", context: "c", state: "SUCCESS" }]).pendingChecks, []);
  assert.deepEqual(f([{ __typename: "CheckRun", name: "ci", status: "IN_PROGRESS", conclusion: "" }]).pendingChecks, ["ci"]);
  assert.deepEqual(f([{ __typename: "CheckRun", name: "ci", status: "QUEUED" }]).pendingChecks, ["ci"]);
  // A re-run in progress still carries the previous conclusion.
  assert.deepEqual(f([{ __typename: "CheckRun", name: "ci", status: "IN_PROGRESS", conclusion: "SUCCESS" }]).pendingChecks, ["ci"]);
  for (const c of ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]) {
    assert.deepEqual(f([{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: c }]).failingChecks, ["ci"], c);
  }
  for (const c of ["SUCCESS", "NEUTRAL", "SKIPPED"]) {
    const r = f([{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: c }]);
    assert.deepEqual([r.failingChecks, r.pendingChecks], [[], []], c);
  }
  assert.deepEqual(f([{ __typename: "CheckRun", name: "ci", status: "COMPLETED" }]).pendingChecks, ["ci"]);
  assert.deepEqual(f([{}]).pendingChecks, ["unnamed"]);
  assert.equal(prFacts(REPO, { ...VIEW, mergeable: "UNKNOWN" }).mergeable, null);
  assert.equal(prFacts(REPO, { ...VIEW, mergeable: "CONFLICTING" }).mergeable, false);
  assert.equal(prFacts(REPO, VIEW).mergeable, true);
});

test("inputProblems: the task and result files must describe this pull request", () => {
  const pr = prFacts(REPO, VIEW);
  const p = (over = {}) => inputProblems({ repo: REPO, pr, taskText: JSON.stringify(TASK), resultText: JSON.stringify(RESULT), ...over });
  assert.deepEqual(p(), []);
  assert.ok(p({ taskText: "{" }).length);
  assert.ok(p({ taskText: JSON.stringify({ ...TASK, repo: "network-awai/app-drive" }) }).length);
  assert.ok(p({ taskText: JSON.stringify({ ...TASK, issue: "AWAI-2" }) }).length);
  assert.ok(p({ taskText: JSON.stringify({ ...TASK, branch: "muse/other" }) }).length);
  // Task and result agree with each other but not with the pull request's branch.
  assert.ok(p({ taskText: JSON.stringify({ ...TASK, branch: "muse/other" }), resultText: JSON.stringify({ ...RESULT, branch: "muse/other" }) }).length);
  assert.ok(p({ resultText: "nope" }).length);
  assert.ok(p({ resultText: JSON.stringify({ ...RESULT, issue: "AWAI-2" }) }).length);
  assert.ok(p({ resultText: JSON.stringify({ ...RESULT, deliver: { ...RESULT.deliver, pr: `https://github.com/${REPO}/pull/8` } }) }).length);
  assert.ok(p({ resultText: JSON.stringify({ ...RESULT, deliver: { ...RESULT.deliver, pr: `https://github.com/${REPO}/pull/77` } }) }).length);
  assert.ok(p({ resultText: JSON.stringify({ ...RESULT, deliver: null }) }).length);
  assert.ok(inputProblems({ repo: REPO, pr: { ...pr, issue: null }, taskText: JSON.stringify(TASK), resultText: JSON.stringify(RESULT) }).length);
});

test("readChange, dirtyPaths and testEnv", () => {
  const c = readChange("3\t1\totehon/dev-bots/a.mjs\0-\t-\totehon/dev-bots/b.bin\0", "+++ b/otehon/dev-bots/a.mjs\n@@ -1 +1 @@\n+const a = 1\n-x\n+++ not a header\n");
  assert.deepEqual(c.files, [{ path: "otehon/dev-bots/a.mjs", added: 3, binary: false }, { path: "otehon/dev-bots/b.bin", added: 0, binary: true }]);
  assert.deepEqual(c.addedLines, [{ path: "otehon/dev-bots/a.mjs", text: "const a = 1" }]);
  assert.deepEqual(dirtyPaths("?? .agent-output/x\n M otehon/dev-bots/a.mjs\n?? new.txt\n?? \".agent-output/sp ace\"\n"), ["otehon/dev-bots/a.mjs", "new.txt"]);
  assert.deepEqual(dirtyPaths(""), []);
  const e = testEnv({ PATH: "/usr/bin", HOME: "/Users/me", GH_TOKEN: "t", GITHUB_TOKEN: "t", LINEAR_API_KEY: "k", TMPDIR: "/tmp/x" }, "/bin/bash", "/w/home");
  assert.deepEqual(e, { PATH: "/bin:/usr/bin", HOME: "/w/home", LANG: "C", TMPDIR: "/tmp/x" });
});

test("defaultShells: the system bash and the first other bash on PATH, or the override", () => {
  assert.deepEqual(defaultShells({ PATH: "/opt/homebrew/bin:/usr/bin:/bin" }, (p) => p === "/opt/homebrew/bin/bash" || p === "/bin/bash"), ["/bin/bash", "/opt/homebrew/bin/bash"]);
  assert.deepEqual(defaultShells({ PATH: "/usr/bin:/bin" }, (p) => p === "/bin/bash"), ["/bin/bash"]);
  assert.deepEqual(defaultShells({ DEV_BOTS_KANTOKU_SHELLS: "/bin/bash, /bin/zsh" }, () => true), ["/bin/bash", "/bin/zsh"]);
});

// ---- run() with every side effect faked ----
function world(over = {}) {
  const w = {
    view: { ...VIEW }, views: [], verdict: VERDICT, head: HEAD, status: "?? .agent-output/kantoku-verdict.json\n",
    testExit: () => 0, reviewRc: 0, ghCalls: [], gitCalls: [], files: new Map(), linear: [], logs: [], reviewed: 0, tests: [], workExists: false,
    numstat: "5\t0\totehon/dev-bots/queue.mjs\0", diff: "+++ b/otehon/dev-bots/queue.mjs\n+const a = 1\n", ...over,
  };
  const deps = {
    gh: (args) => {
      w.ghCalls.push(args.join(" "));
      if (args[1] === "view" && args.includes("state,mergedAt,mergeCommit")) return JSON.stringify({ state: "MERGED", mergedAt: "2026-11-21T00:00:00Z", mergeCommit: { oid: "c".repeat(40) } });
      if (args[1] === "view") return JSON.stringify(w.views.length ? w.views.shift() : w.view);
      return "";
    },
    git: (args) => {
      w.gitCalls.push(args.join(" "));
      if (args[0] === "clone") { w.workExists = true; return ""; }
      if (args[0] === "rev-parse") return `${w.head}\n`;
      if (args[0] === "merge-base") return `${BASE}\n`;
      if (args[0] === "status") return w.status;
      if (args[0] === "diff") return args.includes("--numstat") ? w.numstat : w.diff;
      return "";
    },
    review: () => { w.reviewed += 1; if (w.verdict) w.files.set(join("/w", ".agent-output", "kantoku-verdict.json"), JSON.stringify(w.verdict)); return w.reviewRc; },
    runTest: (shell, cmd, cwd, env) => { w.tests.push({ shell, cmd, cwd, env }); return { status: w.testExit(shell), output: "out" }; },
    shellLabel: (s) => `${s} v`,
    readFile: (p) => { if (!w.files.has(p)) throw new Error("ENOENT"); return w.files.get(p); },
    writeFile: (p, s) => w.files.set(p, s),
    mkdirp: () => {},
    exists: () => w.workExists,
    sleep: () => {},
    recordLinear: (issue, kind, payload) => { w.linear.push({ issue, kind, payload }); return "posted"; },
    log: (l) => w.logs.push(l),
  };
  const opts = { repo: REPO, pr: 7, taskText: JSON.stringify(TASK), resultText: JSON.stringify(RESULT), work: "/w", shells: ["/bin/bash", "/opt/bash"], env: { PATH: "/usr/bin", GH_TOKEN: "secret" } };
  return { w, go: (o = {}) => run({ ...opts, ...o }, deps) };
}
const wrote = (w) => w.ghCalls.filter((c) => !c.startsWith("pr view"));

test("run: an approved change is marked ready and squash-merged at exactly the reviewed head", () => {
  const { w, go } = world();
  const r = go();
  assert.equal(r.exitCode, 0);
  assert.equal(r.report.decision.action, "merge");
  assert.deepEqual(wrote(w), [`pr ready 7 -R ${REPO}`, `pr merge 7 -R ${REPO} --squash --match-head-commit ${HEAD}`]);
  assert.deepEqual(r.report.merged, { commit: "c".repeat(40), at: "2026-11-21T00:00:00Z" });
  assert.deepEqual(w.linear.map((l) => `${l.issue} ${l.kind}`), ["AWAI-1 comment", "AWAI-1 status"]);
  assert.equal(w.reviewed, 1);
  // The tests ran once per shell, without this host's credentials.
  assert.deepEqual(w.tests.map((t) => t.shell), ["/bin/bash", "/opt/bash"]);
  for (const t of w.tests) { assert.equal(t.env.GH_TOKEN, undefined); assert.equal(t.env.HOME, join("/w", ".agent-output", "home")); }
  assert.ok(w.gitCalls.some((c) => c.includes("+refs/pull/7/head:refs/remotes/origin/kantoku-head")));
  assert.ok(JSON.parse(w.files.get(join("/w", ".agent-output", "kantoku-task.json"))).head === HEAD);
});

test("run: a reject, a missing verdict or a failing test changes nothing on GitHub", () => {
  for (const over of [{ verdict: { ...VERDICT, decision: "reject" } }, { verdict: null }, { testExit: (s) => (s === "/bin/bash" ? 1 : 0) }]) {
    const { w, go } = world(over);
    const r = go();
    assert.equal(r.exitCode, 0);
    assert.equal(r.report.decision.action, "hold");
    assert.deepEqual(wrote(w), []);
    assert.equal(r.report.merged, null);
    assert.deepEqual(w.linear.map((l) => l.kind), ["comment"]);
  }
});

test("run: an owner-only path is left as a draft", () => {
  const { w, go } = world({ numstat: "5\t0\totehon/dev-bots/gate.mjs\0" });
  const r = go();
  assert.equal(r.report.decision.action, "owner");
  assert.deepEqual(wrote(w), []);
});

test("run: a verdict for a head the pull request no longer has is not acted on", () => {
  const moved = { ...VIEW, headRefOid: "d".repeat(40) };
  const { w, go } = world({ views: [VIEW, moved] });
  const r = go();
  assert.equal(r.report.decision.action, "hold");
  assert.deepEqual(wrote(w), []);
});

test("run: a check that appears after marking ready undoes it and does not merge", () => {
  const pending = { ...VIEW, isDraft: false, statusCheckRollup: [{ __typename: "StatusContext", context: "tatara/ci", state: "PENDING" }] };
  const { w, go } = world({ views: [VIEW, VIEW, pending] });
  const r = go();
  assert.equal(r.report.decision.action, "hold");
  assert.deepEqual(wrote(w), [`pr ready 7 -R ${REPO}`, `pr ready 7 -R ${REPO} --undo`]);
  assert.equal(r.report.merged, null);
});

test("run: a reviewer that touched the checkout or moved HEAD stops the run before the gate", () => {
  for (const over of [{ status: " M otehon/dev-bots/queue.mjs\n" }, { status: "?? stray.txt\n" }]) {
    const { w, go } = world(over);
    const r = go();
    assert.equal(r.exitCode, 1);
    assert.deepEqual(wrote(w), []);
    assert.equal(w.tests.length, 0);
  }
  let n = 0;
  const r = run({ repo: REPO, pr: 7, taskText: JSON.stringify(TASK), resultText: JSON.stringify(RESULT), work: "/w", shells: ["/bin/bash", "/opt/bash"], env: {} }, {
    gh: () => JSON.stringify(VIEW),
    git: (args) => (args[0] === "rev-parse" ? `${++n === 1 ? HEAD : "e".repeat(40)}\n` : args[0] === "merge-base" ? BASE : ""),
    review: () => 0, runTest: () => { throw new Error("must not run"); }, shellLabel: () => "", readFile: () => JSON.stringify(VERDICT), writeFile: () => {}, mkdirp: () => {},
    exists: () => false, sleep: () => {}, recordLinear: () => "posted", log: () => {},
  });
  assert.equal(r.exitCode, 1);
});

test("run: inputs for another pull request, a closed one, an existing work directory or a failed session stop early", () => {
  let x = world(); assert.equal(x.go({ taskText: JSON.stringify({ ...TASK, issue: "AWAI-2" }) }).exitCode, 2); assert.equal(x.w.reviewed, 0); assert.deepEqual(x.w.gitCalls, []);
  x = world({ view: { ...VIEW, state: "MERGED" } }); assert.equal(x.go().exitCode, 2); assert.equal(x.w.reviewed, 0);
  x = world({ workExists: true }); assert.equal(x.go().exitCode, 2); assert.equal(x.w.reviewed, 0);
  x = world({ reviewRc: 3 }); assert.equal(x.go().exitCode, 1); assert.deepEqual(wrote(x.w), []);
  x = world({ head: "f".repeat(40) }); assert.equal(x.go().exitCode, 1); assert.equal(x.w.reviewed, 0);
  x = world({ view: { ...VIEW, headRefOid: "main" } }); assert.equal(x.go().exitCode, 1); assert.deepEqual(x.w.gitCalls, []);
});

test("run: --dry-run decides but writes nothing to GitHub or Linear; --reuse-verdict skips the session", () => {
  let x = world();
  let r = x.go({ dryRun: true });
  assert.equal(r.report.decision.action, "merge");
  assert.deepEqual(wrote(x.w), []);
  assert.deepEqual(x.w.linear, []);
  x = world({ workExists: true });
  x.w.files.set(join("/w", ".agent-output", "kantoku-verdict.json"), JSON.stringify(VERDICT));
  r = x.go({ reuseVerdict: true, dryRun: true });
  assert.equal(x.w.reviewed, 0);
  assert.equal(r.report.decision.action, "merge");
  assert.equal(x.w.gitCalls.some((c) => c.startsWith("clone")), false);
});

test("run: Done is not set when the task says so or an acceptance item was deferred", () => {
  let x = world(); x.go({ taskText: JSON.stringify({ ...TASK, done_on_merge: false }) });
  assert.deepEqual(x.w.linear.map((l) => l.kind), ["comment"]);
  x = world(); x.go({ resultText: JSON.stringify({ ...RESULT, deliver: { ...RESULT.deliver, decision: { ...RESULT.deliver.decision, deferred: ["device check"] } } }) });
  assert.deepEqual(x.w.linear.map((l) => l.kind), ["comment"]);
});

test("commentBody states what happened and truncates model text", () => {
  const pr = prFacts(REPO, VIEW);
  const d = { action: "hold", reasons: [{ level: "hold", text: "kantoku rejected the change" }] };
  const b = commentBody({ pr, decision: d, verdict: { ...VERDICT, decision: "reject", summary: "x".repeat(5000), findings: [{ severity: "high", where: "a:1", what: "bad" }] }, tests: [{ cmd: "node --test", shell: "/bin/bash 3.2", exit: 0 }], merged: null, dryRun: false });
  assert.ok(b.includes("Not merged: decision **hold**"));
  assert.ok(b.includes("- high: a:1 bad"));
  assert.ok(b.length < 2500);
  assert.ok(commentBody({ pr, decision: { action: "merge", reasons: [] }, verdict: null, tests: [], merged: { commit: "c", at: "t" }, dryRun: false }).includes("Merged (squash) as `c`"));
  assert.ok(commentBody({ pr, decision: d, verdict: VERDICT, tests: [], merged: null, dryRun: true }).includes("Dry run"));
});

test("taskSettings keeps only well-formed test settings", () => {
  assert.deepEqual(taskSettings(JSON.stringify(TASK)), { tests: ["node --test"], test_cwd: ".", test_timeout_s: 1800, done_on_merge: true });
  assert.deepEqual(taskSettings(JSON.stringify({ tests: ["a", 7, "", null, " "], test_cwd: "otehon/dev-bots", test_timeout_s: 60, done_on_merge: false })),
    { tests: ["a"], test_cwd: "otehon/dev-bots", test_timeout_s: 60, done_on_merge: false });
  for (const cwd of ["/etc", "../x", "a/../../b", "", 7]) assert.equal(taskSettings(JSON.stringify({ test_cwd: cwd })).test_cwd, ".", String(cwd));
  for (const t of [0, -1, 99999, "60", 1.5]) assert.equal(taskSettings(JSON.stringify({ test_timeout_s: t })).test_timeout_s, 1800, String(t));
  assert.deepEqual(taskSettings("{").tests, []);
  assert.deepEqual(taskSettings("null").tests, []);
  assert.deepEqual(taskSettings(JSON.stringify({ tests: "node --test" })).tests, []);
});
