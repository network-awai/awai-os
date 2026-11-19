import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectTestShell, linearSink, sandboxArgs, sandboxSummary, writeOutbox } from "./env.mjs";

test("test shell defaults to zsh where it exists, bash otherwise", () => {
  assert.equal(selectTestShell({}, { existsSync: () => true }), "/bin/zsh");
  assert.equal(selectTestShell({}, { existsSync: () => false }), "/bin/bash");
  assert.equal(selectTestShell({ DEV_BOTS_TEST_SHELL: "/bin/dash" }, { existsSync: () => true }), "/bin/dash");
});

test("test shell honours the environment on this host", () => {
  const got = selectTestShell();
  assert.ok(["/bin/zsh", "/bin/bash"].includes(got) || got === process.env.DEV_BOTS_TEST_SHELL);
});

test("Linear sink defaults to orca and selects outbox explicitly", () => {
  assert.equal(linearSink({}), "orca");
  assert.equal(linearSink({ DEV_BOTS_LINEAR: "orca" }), "orca");
  assert.equal(linearSink({ DEV_BOTS_LINEAR: "outbox" }), "outbox");
  assert.equal(linearSink({ DEV_BOTS_LINEAR: "pigeon" }), "orca");
});

test("sandbox keeps network sandbox by default and disables only on off", () => {
  assert.deepEqual(sandboxArgs({}), { args: ["--sandbox-network", "enabled"], mode: "enabled" });
  assert.deepEqual(sandboxArgs({ MUSE_SANDBOX: "on" }), { args: ["--sandbox-network", "enabled"], mode: "enabled" });
  assert.deepEqual(sandboxArgs({ MUSE_SANDBOX: "off" }), { args: ["--disable-sandbox"], mode: "disabled" });
});

test("sandbox summary names the runs that ran without a sandbox", () => {
  assert.equal(sandboxSummary([]), "enabled");
  assert.equal(sandboxSummary([{ run: "run1", sandbox: "enabled" }]), "enabled");
  assert.equal(sandboxSummary([{ run: "run1", sandbox: "enabled" }, { run: "run2", sandbox: "disabled" }]), "disabled (run2)");
});

test("outbox writes one JSON record per Linear write and returns its path", () => {
  const out = mkdtempSync(join(tmpdir(), "outbox-"));
  const rel = writeOutbox(out, { kind: "comment", issue: "AWAI-1", body: "hello", at: "2026-11-19T00:00:00.000Z" });
  assert.ok(rel.startsWith("linear-outbox/AWAI-1-comment-"));
  assert.ok(existsSync(join(out, rel)));
  assert.deepEqual(JSON.parse(readFileSync(join(out, rel), "utf8")).body, "hello");
  const rel2 = writeOutbox(out, { kind: "status", issue: "AWAI-1", to: "Done", at: "2026-11-19T00:00:00.000Z" });
  assert.ok(rel2.includes("-status-"));
});
