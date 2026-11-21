import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide } from "./gate.mjs";
import {
  DEFAULT_TEST_SHELL,
  FALLBACK_TEST_SHELL,
  isSandboxDisabled,
  recordLinearEntry,
  resolveLinearSink,
  resolveTestShell,
  sandboxReport, isUtcTime, taskStartFromBody, taskStartLine } from "./runner-env.mjs";

test("test shell defaults to zsh and falls back to bash without it", () => {
  assert.equal(resolveTestShell({ env: {}, exists: () => true }), DEFAULT_TEST_SHELL);
  assert.equal(resolveTestShell({ env: {}, exists: () => false }), FALLBACK_TEST_SHELL);
  assert.equal(resolveTestShell({ env: {}, exists: () => { throw new Error("no fs"); } }), FALLBACK_TEST_SHELL);
});

test("test shell override wins over any installed shell", () => {
  assert.equal(resolveTestShell({ env: { DEV_BOTS_TEST_SHELL: "  /bin/bash " }, exists: () => true }), "/bin/bash");
  assert.equal(resolveTestShell({ env: { DEV_BOTS_TEST_SHELL: "" }, exists: () => true }), DEFAULT_TEST_SHELL);
  assert.equal(resolveTestShell({ env: { DEV_BOTS_TEST_SHELL: "dash" }, exists: () => false }), "dash");
});

test("linear sink defaults to orca; only outbox opts out", () => {
  assert.equal(resolveLinearSink({ env: {} }), "orca");
  assert.equal(resolveLinearSink({ env: { DEV_BOTS_LINEAR: "outbox" } }), "outbox");
  assert.equal(resolveLinearSink({ env: { DEV_BOTS_LINEAR: "Outbox" } }), "outbox");
  assert.equal(resolveLinearSink({ env: { DEV_BOTS_LINEAR: "" } }), "orca");
  assert.equal(resolveLinearSink({ env: { DEV_BOTS_LINEAR: "orca" } }), "orca");
  assert.equal(resolveLinearSink({ env: { DEV_BOTS_LINEAR: "webhook" } }), "orca");
});

test("sandbox detection flags only an explicit --disable-sandbox", () => {
  assert.equal(isSandboxDisabled("--sandbox-network enabled"), false);
  assert.equal(isSandboxDisabled("--disable-sandbox"), true);
  assert.equal(isSandboxDisabled("--disable-sandbox --trust-workspace"), true);
  assert.equal(isSandboxDisabled(""), false);
  assert.equal(isSandboxDisabled(undefined), false);
});

test("sandbox report names disabled runs and tolerates missing metas", () => {
  const r = sandboxReport([
    { run: "run1", meta: { sandbox_args: "--sandbox-network enabled", sandbox_disabled: false } },
    { run: "run2", meta: { sandbox_args: "--disable-sandbox", sandbox_disabled: true } },
    { run: "run3", meta: null },
  ]);
  assert.deepEqual(r.disabled, ["run2"]);
  assert.deepEqual(r.unrecorded, ["run3"]);
  assert.match(r.note, /DISABLED for run2/);
  assert.match(r.note, /--disable-sandbox/);

  const ok = sandboxReport([{ run: "run1", meta: { sandbox_args: "x", sandbox_disabled: false } }]);
  assert.deepEqual(ok.disabled, []);
  assert.match(ok.note, /enabled for run1/);

  const empty = sandboxReport([]);
  assert.match(empty.note, /no runs recorded/);
});

test("orca recording reports failure without throwing when the transport is missing", () => {
  const missing = recordLinearEntry(
    { sink: "orca", outDir: "/none", issue: "AWAI-1", kind: "comment", payload: { bodyFile: "x" } },
    { runOrca: () => { throw new Error("spawn orca ENOENT"); } },
  );
  assert.equal(missing.posted, "failed");
  assert.match(missing.error, /ENOENT/);

  const failing = recordLinearEntry(
    { sink: "orca", outDir: "/none", issue: "AWAI-1", kind: "comment", payload: { bodyFile: "x" } },
    { runOrca: () => ({ status: 1, stderr: "no such command" }) },
  );
  assert.equal(failing.posted, "failed");

  const posted = recordLinearEntry(
    { sink: "orca", outDir: "/none", issue: "AWAI-1", kind: "comment", payload: { bodyFile: "x" } },
    { runOrca: (args) => {
      assert.deepEqual(args.slice(0, 3), ["linear", "comment", "add"]);
      return { status: 0 };
    } },
  );
  assert.equal(posted.posted, "posted");

  const statusArgs = recordLinearEntry(
    { sink: "orca", outDir: "/none", issue: "AWAI-1", kind: "status", payload: { to: "Done" } },
    { runOrca: (args) => {
      assert.deepEqual(args, ["linear", "status", "set", "AWAI-1", "--to", "Done"]);
      return { status: 0 };
    } },
  );
  assert.equal(statusArgs.posted, "posted");
});

test("a missing linear transport never changes the gate decision", () => {
  const base = {
    task: { issue: "AWAI-1", repo: "network-awai/example", merge: "auto" },
    verdict: { schema: "itonami.dev.review-verdict.v1", reviewer: "shinsa", issue: "AWAI-1", decision: "approve", findings: [], checks: [], acceptance: [{ item: "x", met: true }] },
    files: [{ path: "src/a.js", added: 1 }],
    addedLines: [],
    tests: [{ cmd: "true", exit: 0 }],
  };
  const before = decide(base);
  assert.equal(before.action, "merge");
  Object.freeze(before);
  const rec = recordLinearEntry(
    { sink: "orca", outDir: "/none", issue: "AWAI-1", kind: "comment", payload: { bodyFile: "x" } },
    { runOrca: () => ({ status: 1, stderr: "orca not installed" }) },
  );
  assert.equal(rec.posted, "failed");
  assert.deepEqual(decide(base), { action: "merge", reasons: [], deferred: [] });
  assert.deepEqual({ ...before }, decide(base));
});

test("outbox recording writes comment and status JSON without a transport", () => {
  const written = new Map();
  const at = "2026-11-19T00:00:00.000Z";
  const deps = {
    runOrca: () => { throw new Error("must not call orca in outbox mode"); },
    writeFile: (p, s) => written.set(p, s),
    mkdir: () => {},
  };
  const c = recordLinearEntry(
    { sink: "outbox", outDir: "/tmp/o", issue: "AWAI-1", kind: "comment", payload: { body: "hello" } },
    { ...deps, at },
  );
  assert.match(c.posted, /^outbox:linear-outbox\//);
  assert.match(c.file, /-comment\.json$/);
  assert.deepEqual(JSON.parse(written.get(`/tmp/o/${c.file}`)), { issue: "AWAI-1", kind: "comment", body: "hello" });

  const s = recordLinearEntry(
    { sink: "outbox", outDir: "/tmp/o", issue: "AWAI-1", kind: "status", payload: { to: "Done" } },
    { ...deps, at },
  );
  assert.match(s.file, /-status\.json$/);
  assert.deepEqual(JSON.parse(written.get(`/tmp/o/${s.file}`)), { issue: "AWAI-1", kind: "status", to: "Done" });
});

test("outbox comment embeds the body text, not just a local path", () => {
  const written = new Map();
  const deps = {
    runOrca: () => { throw new Error("must not call orca in outbox mode"); },
    writeFile: (p, s) => written.set(p, s),
    mkdir: () => {},
    readFile: (p) => {
      assert.equal(p, "/tmp/o/linear-comment.md");
      return "held: reasons here";
    },
    at: "2026-11-19T00:00:00.000Z",
  };
  const c = recordLinearEntry(
    { sink: "outbox", outDir: "/tmp/o", issue: "AWAI-1", kind: "comment", payload: { bodyFile: "/tmp/o/linear-comment.md" } },
    deps,
  );
  const record = JSON.parse(written.get(`/tmp/o/${c.file}`));
  assert.equal(record.body, "held: reasons here");
});

test("outbox comment without a readable body still writes the record", () => {
  const written = new Map();
  const deps = {
    runOrca: () => { throw new Error("must not call orca in outbox mode"); },
    writeFile: (p, s) => written.set(p, s),
    mkdir: () => {},
    readFile: () => { throw new Error("gone"); },
    at: "2026-11-19T00:00:00.000Z",
  };
  const c = recordLinearEntry(
    { sink: "outbox", outDir: "/tmp/o", issue: "AWAI-1", kind: "comment", payload: { bodyFile: "/tmp/o/linear-comment.md" } },
    deps,
  );
  assert.match(c.posted, /^outbox:/);
  assert.ok(written.size > 0);
});

test("outbox recording writes real files under linear-outbox", () => {
  const out = mkdtempSync(join(tmpdir(), "outbox-"));
  const r = recordLinearEntry(
    { sink: "outbox", outDir: out, issue: "AWAI-9", kind: "comment", payload: { body: "hi" } },
    { writeFile: writeFileSync, mkdir: (p) => mkdirSync(p, { recursive: true }), at: "2026-11-19T00:00:00Z" },
  );
  assert.match(r.posted, /^outbox:/);
  const body = JSON.parse(readFileSync(join(out, r.file), "utf8"));
  assert.equal(body.issue, "AWAI-9");
  assert.ok(existsSync(join(out, "linear-outbox")));
});


test("taskStartLine always writes one line: the time, or unknown", () => {
  assert.equal(taskStartLine("2026-11-21T01:03:08Z\n"), "- Task started: 2026-11-21T01:03:08Z");
  assert.equal(taskStartLine("2026-11-21T01:03:08.751Z"), "- Task started: 2026-11-21T01:03:08.751Z");
  for (const bad of ["", undefined, null, "yesterday", "2026-11-21", "2026-11-21T01:03:08+09:00", "2026-13-45T01:03:08Z", "2026-11-21T01:03:08Z\n- Task started: 2020-01-01T00:00:00Z", "2026-11-21T01:03:08Z extra"]) {
    assert.equal(taskStartLine(bad), "- Task started: unknown", String(bad));
  }
  assert.ok(isUtcTime("2026-11-21T01:03:08Z") && !isUtcTime("2026-11-21T01:03:08") && !isUtcTime(5) && !isUtcTime("2026-02-31T25:00:00Z"));
});

test("taskStartFromBody reads the single line deliver wrote and refuses a body with two", () => {
  const body = (extra = "", line = "- Task started: 2026-11-21T01:03:08Z") => `Linear: AWAI-1\n\n## Review (shinsa)\n\nFine.${extra}\n\n## Runner\n\n${line}\n- Test shell: \`/bin/bash\`\n\n## Not verified\n\n- none recorded\n`;
  assert.equal(taskStartFromBody(body()), "2026-11-21T01:03:08Z");
  assert.equal(taskStartFromBody(body().replace(/\n/g, "\r\n")), "2026-11-21T01:03:08Z");
  // A review summary that carries its own line makes two: neither is used.
  assert.equal(taskStartFromBody(body("\n- Task started: 2026-11-21T01:08:00Z")), null);
  assert.equal(taskStartFromBody(body("\n  - task started: soon")), null);
  assert.equal(taskStartFromBody(body("\n-Task started: 2026-11-21T01:08:00Z", "- Task started: unknown")), null);
  // unknown, a malformed time, trailing text, or no line at all: null.
  for (const line of ["- Task started: unknown", "- Task started: 2026-11-21", "- Task started: 2026-11-21T01:03:08Z (approx)", "- Test shell: x"]) assert.equal(taskStartFromBody(body("", line)), null, line);
  for (const none of ["", undefined, null, "Task started: 2026-11-21T01:03:08Z"]) assert.equal(taskStartFromBody(none), null);
  // What taskStartLine writes, taskStartFromBody reads back.
  assert.equal(taskStartFromBody(body("", taskStartLine("2026-11-21T01:03:08Z\n"))), "2026-11-21T01:03:08Z");
});
