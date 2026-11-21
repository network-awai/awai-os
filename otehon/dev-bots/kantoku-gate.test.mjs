import test from "node:test";
import assert from "node:assert/strict";
import { decideSelfChange, kantokuVerdictProblems, ownerOnlyReason, KANTOKU_SCHEMA } from "./kantoku-gate.mjs";

const HEAD = "a".repeat(40);
const pr = { repo: "network-awai/awai-os", number: 337, head: HEAD, issue: "AWAI-1", state: "OPEN", mergeable: true, failingChecks: [], pendingChecks: [] };
const first = { action: "draft", reasons: [{ level: "draft", text: "owner-reviewed paths changed: otehon/dev-bots/queue-sync.mjs" }] };
const verdict = {
  schema: KANTOKU_SCHEMA, reviewer: "kantoku", issue: "AWAI-1", repo: "network-awai/awai-os", pr: 337, head: HEAD,
  decision: "approve", summary: "ok",
  checks: [{ cmd: "node --test", shell: "bash 3.2.57", result: "141/141" }],
  mutations: [{ what: "ignored the prompt digest", caught_by: "sync: prompt mismatch" }],
  findings: [], unverified: [],
};
const files = [{ path: "otehon/dev-bots/queue-sync.mjs", added: 120 }, { path: "otehon/dev-bots/queue-sync.test.mjs", added: 300 }];
const tests = [{ cmd: "node --test", shell: "bash 3.2.57", exit: 0 }, { cmd: "node --test", shell: "bash 5.3.9", exit: 0 }];
const ok = { pr, first, verdict, files, tests, addedLines: [{ path: "otehon/dev-bots/queue-sync.mjs", text: "const a = 1" }] };
const run = (over) => decideSelfChange({ ...ok, ...over });
const action = (over) => run(over).action;

test("an approved, re-tested change to an approvable pipeline file merges", () => {
  assert.deepEqual(decideSelfChange(ok), { action: "merge", reasons: [] });
});

test("the approve path: each required fact, taken away, stops the merge", () => {
  assert.equal(action({ verdict: null }), "hold");
  assert.equal(action({ verdict: [] }), "hold");
  assert.equal(action({ verdict: { ...verdict, schema: "itonami.dev.review-verdict.v1" } }), "hold");
  assert.equal(action({ verdict: { ...verdict, reviewer: "shinsa" } }), "hold");
  assert.equal(action({ verdict: { ...verdict, issue: "AWAI-2" } }), "hold");
  assert.equal(action({ verdict: { ...verdict, repo: "network-awai/app-drive" } }), "hold");
  assert.equal(action({ verdict: { ...verdict, pr: 336 } }), "hold");
  assert.equal(action({ verdict: { ...verdict, pr: "337" } }), "hold");
  assert.equal(action({ verdict: { ...verdict, decision: "merge" } }), "hold");
  for (const k of ["checks", "mutations", "findings", "unverified"]) {
    const v = { ...verdict }; delete v[k];
    assert.equal(action({ verdict: v }), "hold", k);
  }
});

test("a verdict for another commit is discarded, including a short or missing head", () => {
  assert.equal(action({ verdict: { ...verdict, head: "b".repeat(40) } }), "hold");
  assert.equal(action({ verdict: { ...verdict, head: HEAD.slice(0, 12) } }), "hold");
  assert.equal(action({ verdict: { ...verdict, head: undefined } }), "hold");
  // A head that is not a full commit never matches, even when both sides agree.
  assert.equal(action({ pr: { ...pr, head: "main" }, verdict: { ...verdict, head: "main" } }), "hold");
  assert.ok(kantokuVerdictProblems({ ...verdict, head: "b".repeat(40) }, pr).includes("kantoku verdict is for another commit"));
  // Both form checks stand on their own.
  assert.ok(kantokuVerdictProblems({ ...verdict, head: "main" }, { ...pr, head: "main" }).includes("kantoku verdict is for another commit"));
  assert.ok(run({ pr: { ...pr, head: "main" }, verdict: { ...verdict, head: "main" } }).reasons.some((x) => x.text === "pull request head commit missing"));
});

test("reject holds; owner-decision leaves the draft for a person", () => {
  assert.equal(action({ verdict: { ...verdict, decision: "reject" } }), "hold");
  const r = run({ verdict: { ...verdict, decision: "owner-decision", owner_question: "is this a policy change?" } });
  assert.equal(r.action, "owner");
  assert.ok(r.reasons[0].text.includes("is this a policy change?"));
});

test("an approve with no check, an open finding or an unverified item is a reject", () => {
  assert.equal(action({ verdict: { ...verdict, checks: [] } }), "hold");
  assert.equal(action({ verdict: { ...verdict, findings: [{ severity: "low", where: "a:1", what: "x" }] } }), "hold");
  assert.equal(action({ verdict: { ...verdict, unverified: ["bash 3.2 not available"] } }), "hold");
});

test("what a review bot may never approve stays with the owner, whatever the verdict says", () => {
  const ownerOnly = [
    "otehon/dev-bots/gate.mjs", "otehon/dev-bots/gate.test.mjs",
    "otehon/dev-bots/kantoku-gate.mjs", "otehon/dev-bots/kantoku-gate.test.mjs", "otehon/dev-bots/kantoku-review.sh",
    "otehon/dev-bots/kantoku/SOUL.md", "otehon/dev-bots/shinsa/SOUL.md", "otehon/dev-bots/shinsa/profile.yaml",
    "otehon/dev-bots/eval/set.json", "otehon/dev-bots/replay/case-1.json", "otehon/dev-bots/metrics/dora.json",
    ".github/workflows/ci.yml", "AGENTS.md", "SECURITY.md", "deploy/wrangler.toml", "README.md",
    "apps/x/otehon/dev-bots/queue.mjs", "otehon/dev-bots-other/x.mjs", "otehon/dev-bots",
  ];
  for (const path of ownerOnly) {
    assert.ok(ownerOnlyReason(path), path);
    assert.equal(action({ files: [...files, { path, added: 1 }] }), "owner", path);
  }
  for (const path of ["otehon/dev-bots/queue.mjs", "otehon/dev-bots/README.md", "otehon/dev-bots/deliver.mjs", "otehon/dev-bots/gatekeeper.mjs"]) {
    assert.equal(ownerOnlyReason(path), null, path);
  }
});

test("paths that are not plain repository paths are never approvable", () => {
  for (const path of ["otehon/dev-bots/../../.github/workflows/x.yml", "/otehon/dev-bots/queue.mjs", "otehon/dev-bots//queue.mjs", "otehon/dev-bots/./queue.mjs", "", null, undefined, 7]) {
    assert.ok(ownerOnlyReason(path), String(path));
    assert.notEqual(action({ files: [{ path, added: 1 }] }), "merge", String(path));
  }
});

test("only a draft whose single objection was the paths can be lifted", () => {
  assert.equal(action({ first: null }), "owner");
  assert.equal(action({ first: { action: "draft" } }), "owner");
  assert.equal(action({ first: { action: "draft", reasons: [] } }), "owner");
  assert.equal(action({ first: { action: "hold", reasons: first.reasons } }), "owner");
  assert.equal(action({ first: { action: "merge", reasons: [] } }), "owner");
  const r = run({ first: { action: "draft", reasons: [...first.reasons, { level: "draft", text: "task merge mode is draft" }] } });
  assert.equal(r.action, "owner");
  assert.ok(r.reasons.some((x) => x.text.includes("task merge mode is draft")));
  assert.equal(action({ first: { action: "draft", reasons: [{ level: "hold", text: "owner-reviewed paths changed: x" }] } }), "owner");
  assert.equal(action({ first: { action: "draft", reasons: [{ level: "draft", text: "no test command declared for this task" }] } }), "owner");
});

test("the pull request must be open, mergeable, green and in an owned organisation", () => {
  assert.equal(action({ pr: null }), "hold");
  assert.equal(action({ pr: { ...pr, state: "MERGED" } }), "hold");
  assert.equal(action({ pr: { ...pr, state: "CLOSED" } }), "hold");
  assert.equal(action({ pr: { ...pr, mergeable: false } }), "hold");
  assert.equal(action({ pr: { ...pr, mergeable: null } }), "hold");
  assert.equal(action({ pr: { ...pr, failingChecks: ["ci"] } }), "hold");
  assert.equal(action({ pr: { ...pr, pendingChecks: ["ci"] } }), "hold");
  // Verdict and pull request agree here, so only the pull request's own form check can stop it.
  assert.equal(action({ pr: { ...pr, issue: "none" }, verdict: { ...verdict, issue: "none" } }), "hold");
  assert.equal(action({ pr: { ...pr, number: 0 }, verdict: { ...verdict, pr: 0 } }), "hold");
  for (const repo of ["NousResearch/hermes-agent", "kotoba-lang/hikari-baito-ludo", "mithril-lang/x"]) {
    assert.equal(action({ pr: { ...pr, repo }, verdict: { ...verdict, repo } }), "hold", repo);
  }
});

test("the tests must have been re-run here, under two shells, and passed", () => {
  assert.equal(action({ tests: [] }), "owner");
  assert.equal(action({ tests: [tests[0]] }), "owner");
  assert.equal(action({ tests: [tests[0], { ...tests[0] }] }), "owner");
  assert.equal(action({ tests: [tests[0], { ...tests[1], exit: 1 }] }), "hold");
  assert.equal(action({ tests: [tests[0], { cmd: "node --test", shell: "bash 5.3.9" }] }), "hold");
});

test("secrets hold; size and binaries go to the owner; an empty change is held", () => {
  assert.equal(action({ files: [] }), "hold");
  assert.equal(action({ addedLines: [{ path: "otehon/dev-bots/queue.mjs", text: `token ghp_${"A".repeat(36)}` }] }), "hold");
  assert.equal(action({ files: [...files, { path: "otehon/dev-bots/relay.env", added: 1 }] }), "hold");
  assert.equal(action({ files: [{ path: "otehon/dev-bots/queue.mjs", added: 4001 }] }), "owner");
  assert.equal(action({ files: Array.from({ length: 61 }, (_, i) => ({ path: `otehon/dev-bots/f${i}.mjs`, added: 1 })) }), "owner");
  assert.equal(action({ files: [...files, { path: "otehon/dev-bots/blob.bin", binary: true, bytes: 10 }] }), "owner");
});

test("hold outranks owner, and every reason is reported", () => {
  const r = run({ verdict: { ...verdict, decision: "reject" }, files: [...files, { path: "otehon/dev-bots/gate.mjs", added: 1 }] });
  assert.equal(r.action, "hold");
  assert.deepEqual(r.reasons.map((x) => x.level).sort(), ["hold", "owner"]);
});

test("real cases: awai-os#337 would merge, awai-os#336 (the kantoku profile) stays with the owner", () => {
  assert.equal(action({ files: [
    { path: "otehon/dev-bots/README.md", added: 12 }, { path: "otehon/dev-bots/queue-sync.mjs", added: 276 }, { path: "otehon/dev-bots/queue-sync.test.mjs", added: 411 },
  ] }), "merge");
  assert.equal(action({ files: [
    { path: "otehon/dev-bots/README.md", added: 1 }, { path: "otehon/dev-bots/kantoku/SOUL.md", added: 47 },
  ] }), "owner");
});
