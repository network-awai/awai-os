import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEST_COMMAND,
  buildFiles,
  buildKantokuPrompt,
  kantokuRun,
  main,
  parseChecksCommands,
  parseDiff,
  parseFirstGate,
  parseIssueKey,
  selectTestCommands,
  shapePr,
  splitChecks,
} from "./kantoku-run.mjs";
import { KANTOKU_SCHEMA } from "./kantoku-gate.mjs";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const SOUL = "# kantoku\nYou review self-change PRs.";

function body({ action = "draft", reasons = ["- draft: owner-reviewed paths changed: otehon/dev-bots/queue.mjs"], checks = null } = {}) {
  const checksSection = checks === null
    ? "None"
    : checks.map((c) => `- [x] \`${c}\` (exit 0, run outside the agent sandbox)`).join("\n");
  return `Linear: AWAI-3857

## Review (shinsa)

looks fine

## Checks

${checksSection}

## Gate

Decision: **${action}**

${reasons.join("\n")}

## Runner

- Test shell: \`/bin/zsh\`
`;
}

function view(over = {}) {
  return {
    number: 12,
    state: "OPEN",
    headRefOid: HEAD,
    baseRefOid: BASE,
    mergeable: "MERGEABLE",
    body: body(),
    title: "AWAI-3857: kantoku-run caller",
    files: [{ path: "otehon/dev-bots/queue.mjs", additions: 10, deletions: 2 }],
    statusCheckRollup: [],
    ...over,
  };
}

const diff = (over = "") => `diff --git a/otehon/dev-bots/queue.mjs b/otehon/dev-bots/queue.mjs
--- a/otehon/dev-bots/queue.mjs
+++ b/otehon/dev-bots/queue.mjs
@@ -1 +1 @@
-const a = 1;
+const a = 2;
${over}`;

function verdict(over = {}) {
  return {
    schema: KANTOKU_SCHEMA,
    reviewer: "kantoku",
    issue: "AWAI-3857",
    repo: "network-awai/awai-os",
    pr: 12,
    head: HEAD,
    decision: "approve",
    summary: "ok",
    checks: [{ cmd: "node --test", shell: "bash", result: "1/1" }],
    mutations: [],
    findings: [],
    unverified: [],
    ...over,
  };
}

// In-memory deps: gh serves the canned view/diff, runReview drops the canned
// verdict where the caller told it to, tests exit as told. Nothing spawns.
function harness({ view: v = view(), diffText = diff(), verdict: vd = verdict(), reviewStatus = 0, testExit = 0, shells = ["/bin/bash", "/bin/zsh"] } = {}) {
  const ghCalls = [];
  const reviewCalls = [];
  const testCalls = [];
  const writes = new Map();
  const lines = [];
  const deps = {
    gh: (args) => {
      ghCalls.push(args);
      if (args[1] === "view") {
        assert.deepEqual(args.slice(0, 5), ["pr", "view", "12", "-R", "network-awai/awai-os"]);
        assert.ok(args.includes("number,state,headRefOid,baseRefOid,mergeable,body,title,files,statusCheckRollup"));
        return JSON.stringify(v);
      }
      if (args[1] === "diff") return diffText;
      return "";
    },
    runReview: ({ promptFile, verdictFile }) => {
      reviewCalls.push({ promptFile, verdictFile });
      if (vd !== null) writes.set(verdictFile, JSON.stringify(vd));
      return { status: reviewStatus };
    },
    runTest: ({ cmd, shell }) => {
      testCalls.push({ cmd, shell });
      return { exit: testExit };
    },
    readFile: (p) => {
      if (String(p).endsWith("kantoku/SOUL.md")) return SOUL;
      if (writes.has(p)) return writes.get(p);
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    },
    writeFile: (p, s) => writes.set(p, s),
    mkdir: () => {},
    exists: (p) => shells.includes(p),
    soulPath: "/repo/otehon/dev-bots/kantoku/SOUL.md",
    log: (line) => lines.push(line),
  };
  return { ghCalls, reviewCalls, testCalls, writes, lines, deps };
}

const run = (opts, h) => kantokuRun({ number: 12, out: "/o/kantoku-result.json", ...opts }, h.deps);

test("body-gate parsing: draft with only owner-path reasons", () => {
  assert.deepEqual(parseFirstGate(body()), {
    action: "draft",
    reasons: [{ level: "draft", text: "owner-reviewed paths changed: otehon/dev-bots/queue.mjs" }],
  });
});

test("body-gate parsing: draft with extra reasons keeps every line", () => {
  const first = parseFirstGate(body({
    reasons: [
      "- draft: owner-reviewed paths changed: otehon/dev-bots/queue.mjs",
      "- draft: task merge mode is draft",
    ],
  }));
  assert.equal(first.action, "draft");
  assert.deepEqual(first.reasons, [
    { level: "draft", text: "owner-reviewed paths changed: otehon/dev-bots/queue.mjs" },
    { level: "draft", text: "task merge mode is draft" },
  ]);
});

test("body-gate parsing: missing section is null; missing decision has a null action", () => {
  assert.equal(parseFirstGate("Linear: AWAI-1\n\nno gate here\n"), null);
  const noDecision = parseFirstGate("## Gate\n\n- draft: something\n");
  assert.equal(noDecision.action, null);
  assert.deepEqual(noDecision.reasons, [{ level: "draft", text: "something" }]);
});

test("issue key comes from the body first, then the title", () => {
  assert.equal(parseIssueKey(body(), "other"), "AWAI-3857");
  assert.equal(parseIssueKey("no linear line", "AWAI-99: thing"), "AWAI-99");
  assert.equal(parseIssueKey("no linear line", "no key here"), null);
});

test("test commands come from the Checks section, else the dev-bots default", () => {
  assert.deepEqual(parseChecksCommands(body({ checks: ["npm test", "node --test x"] })), ["npm test", "node --test x"]);
  assert.deepEqual(selectTestCommands(body({ checks: ["npm test"] })), { cmds: ["npm test"], source: "pr-body" });
  assert.deepEqual(selectTestCommands(body({ checks: [] })), { cmds: [DEFAULT_TEST_COMMAND], source: "default" });
  assert.deepEqual(selectTestCommands("Linear: AWAI-1\n"), { cmds: [DEFAULT_TEST_COMMAND], source: "default" });
});

test("fact-shaping: pr state, mergeability and check rollup follow deliver.mjs", () => {
  const pr = shapePr(view({
    mergeable: "MERGEABLE",
    statusCheckRollup: [
      { name: "ci", conclusion: "FAILURE" },
      { name: "lint", state: "IN_PROGRESS" },
      { name: "ok", conclusion: "SUCCESS", state: "SUCCESS" },
    ],
  }), "network-awai/awai-os", "AWAI-3857");
  assert.equal(pr.mergeable, true);
  assert.deepEqual(pr.failingChecks, ["ci"]);
  assert.deepEqual(pr.pendingChecks, ["lint"]);
  assert.equal(shapePr(view({ mergeable: "CONFLICTING" }), "r", "AWAI-1").mergeable, false);
  assert.equal(shapePr(view({ mergeable: "UNKNOWN" }), "r", "AWAI-1").mergeable, null);
});

test("fact-shaping: added lines and binary flags come from the diff", () => {
  const { addedLines, binary } = parseDiff(`${diff()}\nBinary files a/otehon/dev-bots/blob.bin and b/otehon/dev-bots/blob.bin differ\n`);
  assert.ok(addedLines.some((l) => l.path === "otehon/dev-bots/queue.mjs" && l.text === "const a = 2;"));
  assert.ok(!addedLines.some((l) => l.text.startsWith("---") || l.text.startsWith("const a = 1")));
  assert.ok(binary.has("otehon/dev-bots/blob.bin"));
  const files = buildFiles(
    [{ path: "otehon/dev-bots/queue.mjs", additions: 3 }, { path: "otehon/dev-bots/blob.bin", additions: 0 }],
    binary,
  );
  assert.deepEqual(files, [
    { path: "otehon/dev-bots/queue.mjs", added: 3 },
    { path: "otehon/dev-bots/blob.bin", added: 0, binary: true },
  ]);
});

test("prompt carries the profile, the head, the verdict file and the no-write rule", () => {
  const prompt = buildKantokuPrompt({
    soul: SOUL, repo: "network-awai/awai-os", number: 12, head: HEAD, base: BASE,
    issue: "AWAI-3857", cmds: ["npm test"], verdictFile: "/o/kantoku-verdict.json",
  });
  assert.ok(prompt.includes(SOUL));
  assert.ok(prompt.includes(HEAD));
  assert.ok(prompt.includes("/o/kantoku-verdict.json"));
  assert.ok(prompt.includes("must not commit, push, mark ready, merge, or write to Linear"));
});

test("a clean self-change merges: ready then squash, result written, exit 0", () => {
  const h = harness({ view: view({ body: body({ checks: ["npm test"] }) }) });
  const { result, exitCode } = run({ dryRun: false }, h);
  assert.equal(exitCode, 0);
  assert.equal(result.decision.action, "merge");
  assert.deepEqual(result.testSource, "pr-body");
  assert.deepEqual(result.testCmds, ["npm test"]);
  assert.deepEqual(result.tests, [
    { cmd: "npm test", shell: "/bin/bash", exit: 0 },
    { cmd: "npm test", shell: "/bin/zsh", exit: 0 },
  ]);
  const kinds = h.ghCalls.map((a) => a.slice(0, 2).join(" "));
  assert.deepEqual(kinds, ["pr view", "pr diff", "pr ready", "pr merge"]);
  assert.deepEqual(h.ghCalls[3], ["pr", "merge", "12", "--squash", "-R", "network-awai/awai-os"]);
  assert.equal(result.acted, "merged");
  const written = JSON.parse(h.writes.get("/o/kantoku-result.json"));
  assert.equal(written.decision.action, "merge");
  assert.ok(h.writes.get("/o/kantoku-prompt.md").includes("must not commit"));
});

test("dry-run collects facts and prints the decision but makes no mutating calls", () => {
  const h = harness({ view: view({ body: body({ checks: ["npm test"] }) }) });
  const { result, exitCode } = run({ dryRun: true }, h);
  assert.equal(exitCode, 0);
  assert.equal(result.decision.action, "merge");
  assert.equal(result.acted, "dry-run");
  assert.deepEqual(h.ghCalls.map((a) => a[1]), ["view", "diff"]);
  assert.deepEqual(result.tests.map((t) => t.shell), ["/bin/bash", "/bin/zsh"]);
  assert.equal(h.lines.length, 1);
  assert.equal(JSON.parse(h.lines[0]).action, "merge");
  assert.ok(h.writes.has("/o/kantoku-result.json"));
});

test("owner-decision leaves the draft: no ready, no merge, exit 0", () => {
  const h = harness({ verdict: verdict({ decision: "owner-decision", owner_question: "is this a policy change?" }) });
  const { result, exitCode } = run({ dryRun: false }, h);
  assert.equal(exitCode, 0);
  assert.equal(result.decision.action, "owner");
  assert.ok(result.decision.reasons.some((r) => r.text.includes("is this a policy change?")));
  assert.equal(result.acted, "left-draft");
  assert.deepEqual(h.ghCalls.map((a) => a[1]), ["view", "diff"]);
  assert.ok(h.lines.some((l) => l.startsWith("owner:")));
});

test("a failing re-run holds: no ready, no merge, exit 1", () => {
  const h = harness({ testExit: 1 });
  const { result, exitCode } = run({ dryRun: false }, h);
  assert.equal(exitCode, 1);
  assert.equal(result.decision.action, "hold");
  assert.equal(result.acted, "held");
  assert.deepEqual(h.ghCalls.map((a) => a[1]), ["view", "diff"]);
  assert.ok(h.lines.some((l) => l.startsWith("hold:")));
});

test("a verdict for another head is a hold after exactly one review run", () => {
  const h = harness({ verdict: verdict({ head: "b".repeat(40) }) });
  const { result, exitCode } = run({ dryRun: false }, h);
  assert.equal(exitCode, 1);
  assert.equal(result.decision.action, "hold");
  assert.equal(h.reviewCalls.length, 1);
  assert.deepEqual(h.ghCalls.map((a) => a[1]), ["view", "diff"]);
});

test("an approve over owner-only paths is a hold, never a merge", () => {
  const h = harness({
    view: view({ files: [{ path: "otehon/dev-bots/gate.mjs", additions: 5, deletions: 0 }] }),
    diffText: "diff --git a/otehon/dev-bots/gate.mjs b/otehon/dev-bots/gate.mjs\n+++ b/otehon/dev-bots/gate.mjs\n+const a = 2;\n",
  });
  const { result, exitCode } = run({ dryRun: false }, h);
  assert.equal(exitCode, 1);
  assert.equal(result.decision.action, "hold");
  assert.equal(result.escalated, true);
  assert.ok(result.gate.reasons.some((r) => r.text.includes("a review bot may not approve")));
  assert.ok(result.decision.reasons.some((r) => r.text.includes("may not approve")));
  assert.deepEqual(h.ghCalls.map((a) => a[1]), ["view", "diff"]);
});

test("one shell only is an owner verdict: the tests ran but not under two shells", () => {
  const h = harness({ shells: ["/bin/bash"] });
  const { result, exitCode } = run({ dryRun: false }, h);
  assert.equal(exitCode, 0);
  assert.equal(result.decision.action, "owner");
  assert.ok(result.decision.reasons.some((r) => r.text.includes("fewer than two shells")));
  assert.deepEqual(result.testShells, ["/bin/bash"]);
});

test("main: --help and missing args exit 2 with usage and touch nothing", () => {
  const errors = [];
  const orig = console.error;
  console.error = (m) => errors.push(m);
  try {
    assert.equal(main(["--help"]), 2);
    assert.equal(main([]), 2);
    assert.equal(main(["12", "--bogus"]), 2);
  } finally {
    console.error = orig;
  }
  assert.ok(errors.every((m) => m.includes("usage: node kantoku-run.mjs")));
});
