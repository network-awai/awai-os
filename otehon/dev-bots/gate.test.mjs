import test from "node:test";
import assert from "node:assert/strict";
import { decide, scanSecrets, VERDICT_SCHEMA } from "./gate.mjs";

const task = { issue: "AWAI-1", repo: "network-awai/example", merge: "auto" };
const verdict = { schema: VERDICT_SCHEMA, reviewer: "shinsa", issue: "AWAI-1", decision: "approve", findings: [], checks: [{ cmd: "npm test", result: "pass" }], acceptance: [{ item: "tests pass", met: true }] };
const files = [{ path: "src/a.js", added: 10 }];
const tests = [{ cmd: "npm test", exit: 0 }];
const ok = { task, verdict, files, tests, addedLines: [{ path: "src/a.js", text: "const a = 1" }] };
const action = (over) => decide({ ...ok, ...over }).action;

test("a clean, approved, tested change in an owned org merges", () => {
  assert.deepEqual(decide(ok), { action: "merge", reasons: [] });
});
test("other organisations and excluded repositories are held", () => {
  assert.equal(action({ task: { ...task, repo: "apache/arrow" } }), "hold");
  assert.equal(action({ task: { ...task, repo: "kotoba-lang/hikari-baito-ludo" } }), "hold");
  assert.equal(action({ task: { ...task, repo: "mithril-lang/x" } }), "hold");
});
test("missing, foreign, rejected or malformed verdicts are held", () => {
  assert.equal(action({ verdict: null }), "hold");
  assert.equal(action({ verdict: { ...verdict, reviewer: "implementer" } }), "hold");
  assert.equal(action({ verdict: { ...verdict, issue: "AWAI-2" } }), "hold");
  assert.equal(action({ verdict: { ...verdict, decision: "reject" } }), "hold");
  assert.equal(action({ verdict: { ...verdict, schema: "x" } }), "hold");
  assert.equal(action({ verdict: { ...verdict, findings: [{ severity: "high", where: "a.js:1", fixed: false }] } }), "hold");
});
test("fixed findings and low findings do not block", () => {
  assert.equal(action({ verdict: { ...verdict, findings: [{ severity: "high", fixed: true }, { severity: "low", fixed: false }] } }), "merge");
});
test("failing or missing tests never merge", () => {
  assert.equal(action({ tests: [{ cmd: "npm test", exit: 1 }] }), "hold");
  assert.equal(action({ tests: [] }), "draft");
});
test("unmet acceptance, owner decisions and draft mode stay draft", () => {
  assert.equal(action({ verdict: { ...verdict, acceptance: [{ item: "device run", met: false }] } }), "draft");
  assert.equal(action({ verdict: { ...verdict, acceptance: [] } }), "draft");
  assert.equal(action({ verdict: { ...verdict, decision: "owner-decision", owner_question: "where?" } }), "draft");
  assert.equal(action({ task: { ...task, merge: "draft" } }), "draft");
});
test("owner-reviewed paths, size and binaries stay draft", () => {
  for (const path of [".github/workflows/ci.yml", "AGENTS.md", "docs/AGENTS.md", "wrangler.itonami-bots.jsonc", "otehon/dev-bots/gate.mjs", "SECURITY.md"])
    assert.equal(action({ files: [{ path, added: 1 }] }), "draft", path);
  assert.equal(action({ files: Array.from({ length: 61 }, (_, i) => ({ path: `src/${i}.js`, added: 1 })) }), "draft");
  assert.equal(action({ files: [{ path: "src/a.js", added: 4001 }] }), "draft");
  assert.equal(action({ files: [{ path: "a.bin", binary: true, bytes: 2 << 20 }] }), "draft");
});
test("secrets and scratch output are held", () => {
  assert.equal(action({ files: [{ path: ".env.local", added: 1 }] }), "hold");
  assert.equal(action({ files: [{ path: "certs/server.pem", added: 1 }] }), "hold");
  assert.equal(action({ files: [{ path: ".agent-output/run1.jsonl", added: 1 }] }), "hold");
  assert.equal(action({ addedLines: [{ path: "a.js", text: "-----BEGIN OPENSSH PRIVATE KEY-----" }] }), "hold");
  assert.equal(action({ addedLines: [{ path: "a.js", text: "t = 'ghp_" + "a".repeat(36) + "'" }] }), "hold");
  assert.deepEqual(scanSecrets(files, [{ path: "a.js", text: "const key = load()" }]), []);
});
test("pull request state gates the merge", () => {
  assert.equal(action({ pr: { failingChecks: ["ci"], pendingChecks: [], mergeable: true } }), "hold");
  assert.equal(action({ pr: { failingChecks: [], pendingChecks: ["ci"], mergeable: true } }), "draft");
  assert.equal(action({ pr: { failingChecks: [], pendingChecks: [], mergeable: false } }), "hold");
  assert.equal(action({ pr: { failingChecks: [], pendingChecks: [], mergeable: true } }), "merge");
});
test("nothing to deliver or no issue key is held", () => {
  assert.equal(action({ files: [] }), "hold");
  assert.equal(action({ task: { ...task, issue: "" } }), "hold");
});
