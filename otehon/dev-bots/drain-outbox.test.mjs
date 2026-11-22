import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drainOutbox } from "./drain-outbox.mjs";

const comment = (issue, body, extra = {}) => JSON.stringify({ issue, kind: "comment", body, ...extra });
const status = (issue, to) => JSON.stringify({ issue, kind: "status", to });

// In-memory outbox: store maps file name -> text. rename() moves keys the way
// the real fs would, so a second drainOutbox() call models a second run.
function harness(initial = {}, { orca = null, renameFails = [] } = {}) {
  const store = new Map(Object.entries(initial));
  const calls = { orca: [], renames: [], writes: [], removes: [], reads: [] };
  const lines = [];
  const failNames = new Set(renameFails);
  let tmpCount = 0;
  const deps = {
    listDir: (d) => {
      assert.equal(d, "/o");
      return [...store.keys()];
    },
    readFile: (p) => {
      calls.reads.push(p);
      const name = p.replace(/^\/o\//, "");
      if (!store.has(name)) {
        const e = new Error(`ENOENT: no such file '${p}'`);
        e.code = "ENOENT";
        throw e;
      }
      return store.get(name);
    },
    writeFile: (p, s) => calls.writes.push([p, s]),
    removeFile: (p) => calls.removes.push(p),
    tempFile: () => `/tmp/body-${tmpCount++}.md`,
    rename: (from, to) => {
      calls.renames.push([from, to]);
      const f = from.replace(/^\/o\//, "");
      const t = to.replace(/^\/o\//, "");
      if (failNames.has(f)) throw new Error("disk full");
      store.set(t, store.get(f));
      store.delete(f);
    },
    runOrca: (args) => {
      calls.orca.push(args);
      return orca ? orca(args) : { status: 0, stderr: "" };
    },
    log: (line) => lines.push(line),
  };
  return { store, calls, lines, deps };
}

function summaryOf(lines) {
  return JSON.parse(lines[lines.length - 1]);
}

test("records post in ascending file-name order with recordLinearEntry's orca arguments", () => {
  const { store, calls, lines, deps } = harness({
    "2026-11-19T00-00-02-000Z-status.json": status("AWAI-1", "In Progress"),
    "2026-11-19T00-00-01-000Z-comment.json":
      comment("AWAI-1", "hello body", { bodyFile: "/other/machine/linear-comment.md" }),
  });
  const { summary, exitCode } = drainOutbox({ dir: "/o" }, deps);
  assert.equal(exitCode, 0);
  assert.deepEqual(summary, { posted: 2, failed: 0, invalid: 0, skipped: 0, dryRun: false });
  // Comment first (time order), posted from the embedded body staged to a
  // temp file; the foreign bodyFile path is never trusted or passed on.
  assert.equal(calls.orca.length, 2);
  const [commentArgs, statusArgs] = calls.orca;
  assert.deepEqual(commentArgs.slice(0, 4), ["linear", "comment", "add", "AWAI-1"]);
  assert.equal(commentArgs[4], "--body-file");
  assert.ok(!commentArgs.some((a) => String(a).includes("/other/machine")));
  const staged = calls.writes.find(([p]) => p === commentArgs[5]);
  assert.deepEqual(staged, [commentArgs[5], "hello body"]);
  // State travels as a separate argv entry, even with a space in it.
  assert.deepEqual(statusArgs, ["linear", "status", "set", "AWAI-1", "--to", "In Progress"]);
  // Exactly-once markers: originals renamed, temp file cleaned up.
  assert.deepEqual(calls.renames, [
    ["/o/2026-11-19T00-00-01-000Z-comment.json", "/o/2026-11-19T00-00-01-000Z-comment.json.posted"],
    ["/o/2026-11-19T00-00-02-000Z-status.json", "/o/2026-11-19T00-00-02-000Z-status.json.posted"],
  ]);
  assert.deepEqual(calls.removes, [commentArgs[5]]);
  assert.deepEqual([...store.keys()].sort(), [
    "2026-11-19T00-00-01-000Z-comment.json.posted",
    "2026-11-19T00-00-02-000Z-status.json.posted",
  ]);
  // One line per record plus a final summary; the body is never printed.
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^posted AWAI-1 comment 2026-11-19T00-00-01-000Z-comment\.json$/);
  assert.match(lines[1], /^posted AWAI-1 status 2026-11-19T00-00-02-000Z-status\.json$/);
  assert.deepEqual(summaryOf(lines), summary);
  for (const line of lines) assert.ok(!line.includes("hello body"), `body leaked: ${line}`);
});

test("a second run posts nothing: .posted files are never read or posted again", () => {
  const { store, calls, lines, deps } = harness({
    "2026-11-19T00-00-01-000Z-comment.json": comment("AWAI-1", "hi"),
  });
  assert.equal(drainOutbox({ dir: "/o" }, deps).exitCode, 0);
  assert.equal(calls.orca.length, 1);
  lines.length = 0;
  calls.reads.length = 0;
  const second = drainOutbox({ dir: "/o" }, deps);
  assert.equal(second.exitCode, 0);
  assert.deepEqual(second.summary, { posted: 0, failed: 0, invalid: 0, skipped: 0, dryRun: false });
  assert.equal(calls.orca.length, 1);
  assert.deepEqual(calls.reads, []);
  assert.equal(lines.length, 1);
  assert.deepEqual(summaryOf(lines), second.summary);
  assert.deepEqual([...store.keys()], ["2026-11-19T00-00-01-000Z-comment.json.posted"]);
});

test("a failed post stops later records of the same issue but continues other issues", () => {
  const { store, calls, lines, deps } = harness(
    {
      "a-comment.json": comment("AWAI-1", "first"),
      "b-status.json": status("AWAI-1", "Done"),
      "c-comment.json": comment("AWAI-2", "other"),
    },
    { orca: (args) => (args.includes("AWAI-1") ? { status: 1, stderr: "boom" } : { status: 0, stderr: "" }) },
  );
  const { summary, exitCode } = drainOutbox({ dir: "/o" }, deps);
  assert.equal(exitCode, 1);
  assert.deepEqual(summary, { posted: 1, failed: 1, invalid: 0, skipped: 1, dryRun: false });
  // AWAI-1 status is never attempted (comment-before-status order kept).
  assert.deepEqual(calls.orca.map((a) => a[3]), ["AWAI-1", "AWAI-2"]);
  assert.match(lines[0], /^failed AWAI-1 comment a-comment\.json: boom$/);
  assert.match(lines[1], /^skipped AWAI-1 status b-status\.json/);
  assert.match(lines[2], /^posted AWAI-2 comment c-comment\.json$/);
  assert.deepEqual(summaryOf(lines), summary);
  assert.ok(store.has("a-comment.json"));
  assert.ok(store.has("b-status.json"));
  assert.ok(store.has("c-comment.json.posted"));
});

test("a rename failure after a successful post names the file and exits non-zero", () => {
  const { store, calls, lines, deps } = harness(
    { "a-comment.json": comment("AWAI-1", "hi") },
    { renameFails: ["a-comment.json"] },
  );
  const { summary, exitCode } = drainOutbox({ dir: "/o" }, deps);
  assert.equal(exitCode, 1);
  assert.deepEqual(summary, { posted: 0, failed: 1, invalid: 0, skipped: 0, dryRun: false });
  assert.equal(calls.orca.length, 1);
  assert.match(lines[0], /^failed AWAI-1 comment a-comment\.json: .*a-comment\.json\.posted failed.*may be posted twice/);
  assert.deepEqual(summaryOf(lines), summary);
  assert.ok(store.has("a-comment.json"));
});

const invalidCases = [
  ["unparseable JSON", "rec-comment.json", "{oops"],
  ["non-object JSON array", "rec-comment.json", "[]"],
  ["non-object JSON number", "rec-comment.json", "42"],
  ["non-object JSON null", "rec-comment.json", "null"],
  ["missing issue", "rec-status.json", JSON.stringify({ kind: "status", to: "Done" })],
  ["numeric issue", "rec-status.json", JSON.stringify({ issue: 7, kind: "status", to: "Done" })],
  ["lowercase issue", "rec-status.json", JSON.stringify({ issue: "awai-1", kind: "status", to: "Done" })],
  ["issue without digits", "rec-status.json", JSON.stringify({ issue: "AWAI-", kind: "status", to: "Done" })],
  ["issue with trailing junk", "rec-status.json", JSON.stringify({ issue: "AWAI-1x", kind: "status", to: "Done" })],
  ["unknown kind", "rec-comment.json", JSON.stringify({ issue: "AWAI-1", kind: "note", body: "x" })],
  ["missing kind", "rec-comment.json", JSON.stringify({ issue: "AWAI-1", body: "x" })],
  ["comment missing body", "rec-comment.json", JSON.stringify({ issue: "AWAI-1", kind: "comment" })],
  ["comment empty body", "rec-comment.json", comment("AWAI-1", "")],
  ["comment null body", "rec-comment.json", comment("AWAI-1", null)],
  ["comment numeric body", "rec-comment.json", comment("AWAI-1", 42)],
  ["comment bodyFile without body", "rec-comment.json", JSON.stringify({ issue: "AWAI-1", kind: "comment", bodyFile: "/elsewhere/x.md" })],
  ["status missing to", "rec-status.json", JSON.stringify({ issue: "AWAI-1", kind: "status" })],
  ["status empty to", "rec-status.json", status("AWAI-1", "")],
  ["status to with leading dash", "rec-status.json", status("AWAI-1", "-Done")],
  ["status numeric to", "rec-status.json", status("AWAI-1", 3)],
];

for (const [label, name, content] of invalidCases) {
  test(`invalid: ${label} is reported, left in place, never sent`, () => {
    const { store, calls, lines, deps } = harness({ [name]: content });
    const { summary, exitCode } = drainOutbox({ dir: "/o" }, deps);
    assert.equal(exitCode, 1);
    assert.deepEqual(summary, { posted: 0, failed: 0, invalid: 1, skipped: 0, dryRun: false });
    assert.deepEqual(calls.orca, []);
    assert.deepEqual(calls.renames, []);
    assert.ok(store.has(name));
    assert.equal(lines.length, 2);
    assert.match(lines[0], new RegExp(`^invalid ${name}: `));
    assert.deepEqual(summaryOf(lines), summary);
  });
}

test("an invalid record never leaks its body into the output", () => {
  // Invalid because of the issue key, so the secret body is present but unsent.
  const { calls, lines, deps } = harness({
    "rec-comment.json": JSON.stringify({ issue: "nope", kind: "comment", body: "s3cret-body-text" }),
  });
  assert.equal(drainOutbox({ dir: "/o" }, deps).exitCode, 1);
  assert.deepEqual(calls.orca, []);
  for (const line of lines) assert.ok(!line.includes("s3cret-body-text"), `body leaked: ${line}`);
});

test("an invalid record stops later records of the same issue", () => {
  const { calls, lines, deps } = harness({
    "a-comment.json": JSON.stringify({ issue: "AWAI-3", kind: "comment" }),
    "b-status.json": status("AWAI-3", "Done"),
  });
  const { summary, exitCode } = drainOutbox({ dir: "/o" }, deps);
  assert.equal(exitCode, 1);
  assert.deepEqual(summary, { posted: 0, failed: 0, invalid: 1, skipped: 1, dryRun: false });
  assert.deepEqual(calls.orca, []);
  assert.match(lines[1], /^skipped AWAI-3 status b-status\.json/);
});

test("dry-run posts nothing and changes nothing", () => {
  const before = {
    "2026-11-19T00-00-01-000Z-comment.json": comment("AWAI-1", "s3cret-body-text"),
    "2026-11-19T00-00-02-000Z-status.json": status("AWAI-1", "Done"),
  };
  const { store, calls, lines, deps } = harness({ ...before });
  const { summary, exitCode } = drainOutbox({ dir: "/o", dryRun: true }, deps);
  assert.equal(exitCode, 0);
  assert.deepEqual(summary, { posted: 2, failed: 0, invalid: 0, skipped: 0, dryRun: true });
  assert.deepEqual(calls.orca, []);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.removes, []);
  assert.deepEqual(calls.renames, []);
  assert.deepEqual(Object.fromEntries(store), before);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^would-post AWAI-1 comment 2026-11-19T00-00-01-000Z-comment\.json$/);
  assert.match(lines[1], /^would-post AWAI-1 status 2026-11-19T00-00-02-000Z-status\.json$/);
  assert.deepEqual(summaryOf(lines), summary);
  for (const line of lines) assert.ok(!line.includes("s3cret-body-text"), `body leaked: ${line}`);
});

test("a missing directory is a clean no-op with exit 0", () => {
  const lines = [];
  const missing = new Error("ENOENT: no such file or directory");
  missing.code = "ENOENT";
  const { summary, exitCode } = drainOutbox({ dir: "/o" }, {
    listDir: () => { throw missing; },
    log: (line) => lines.push(line),
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(summary, { posted: 0, failed: 0, invalid: 0, skipped: 0, dryRun: false });
  assert.deepEqual(lines, [JSON.stringify(summary)]);
});

test("an empty directory and a directory with only .posted markers are clean no-ops", () => {
  for (const names of [[], ["2026-11-19T00-00-01-000Z-comment.json.posted"]]) {
    const reads = [];
    const lines = [];
    const { summary, exitCode } = drainOutbox({ dir: "/o" }, {
      listDir: () => names,
      readFile: (p) => { reads.push(p); throw new Error("must not read"); },
      log: (line) => lines.push(line),
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(summary, { posted: 0, failed: 0, invalid: 0, skipped: 0, dryRun: false });
    assert.deepEqual(reads, []);
    assert.deepEqual(lines, [JSON.stringify(summary)]);
  }
});

const cliPath = fileURLToPath(new URL("./drain-outbox.mjs", import.meta.url));

function runCli(args, { cwd = tmpdir() } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", cwd });
}

test("CLI: a missing outbox directory exits 0 with a zero summary", () => {
  const r = runCli([join(mkdtempSync(join(tmpdir(), "drain-")), "no-such-dir")]);
  assert.equal(r.status, 0);
  const last = r.stdout.trim().split("\n").pop();
  assert.deepEqual(JSON.parse(last), { posted: 0, failed: 0, invalid: 0, skipped: 0, dryRun: false });
});

test("CLI: --dry-run on a real outbox posts nothing and changes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "drain-"));
  const outbox = join(dir, "linear-outbox");
  mkdirSync(outbox);
  writeFileSync(join(outbox, "2026-11-19T00-00-01-000Z-comment.json"), comment("AWAI-9", "real body text"));
  writeFileSync(join(outbox, "2026-11-19T00-00-02-000Z-status.json"), status("AWAI-9", "Done"));
  const r = runCli([outbox, "--dry-run"]);
  assert.equal(r.status, 0);
  assert.deepEqual(readdirSync(outbox).sort(), [
    "2026-11-19T00-00-01-000Z-comment.json",
    "2026-11-19T00-00-02-000Z-status.json",
  ]);
  assert.match(r.stdout, /would-post AWAI-9 comment 2026-11-19T00-00-01-000Z-comment\.json/);
  assert.match(r.stdout, /would-post AWAI-9 status 2026-11-19T00-00-02-000Z-status\.json/);
  const last = r.stdout.trim().split("\n").pop();
  assert.deepEqual(JSON.parse(last), { posted: 2, failed: 0, invalid: 0, skipped: 0, dryRun: true });
  assert.ok(!r.stdout.includes("real body text"));
});

test("CLI: no directory argument is a usage error", () => {
  const r = runCli([]);
  assert.equal(r.status, 2);
});

test("CLI: comment body is staged in a private per-run directory that is removed", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "drain-tmp-"));
  try {
    const outbox = join(tmpRoot, "outbox");
    mkdirSync(outbox);
    const body = "private body text";
    writeFileSync(join(outbox, "2026-11-19T00-00-01-000Z-comment.json"), comment("AWAI-9", body));
    const fakeBin = join(tmpRoot, "bin");
    mkdirSync(fakeBin);
    const capture = join(tmpRoot, "capture.json");
    const orcaPath = join(fakeBin, "orca");
    writeFileSync(orcaPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const i = args.indexOf("--body-file");
const bodyFile = i >= 0 ? args[i + 1] : "";
const seen = i >= 0 ? readFileSync(bodyFile, "utf8") : "";
writeFileSync(process.env.DRAIN_CAPTURE, JSON.stringify({ args, bodyFile, body: seen }));
`);
    chmodSync(orcaPath, 0o755);
    const r = spawnSync(process.execPath, [cliPath, outbox], {
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmpRoot, PATH: `${fakeBin}${delimiter}${process.env.PATH}`, DRAIN_CAPTURE: capture },
    });
    assert.equal(r.status, 0, r.stderr);
    const seen = JSON.parse(readFileSync(capture, "utf8"));
    assert.deepEqual(seen.args.slice(0, 4), ["linear", "comment", "add", "AWAI-9"]);
    assert.equal(seen.args[4], "--body-file");
    assert.equal(seen.args[5], seen.bodyFile);
    assert.ok(seen.bodyFile.startsWith(join(tmpRoot, "linear-outbox-")), seen.bodyFile);
    assert.equal(dirname(dirname(seen.bodyFile)), tmpRoot);
    assert.ok(basename(dirname(seen.bodyFile)).startsWith("linear-outbox-"), seen.bodyFile);
    assert.equal(seen.body, body);
    assert.deepEqual(readdirSync(tmpRoot).filter((n) => n.startsWith("linear-outbox-")), []);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
