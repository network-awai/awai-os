import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildResult,
  formatLogLine,
  main as queueMain,
  parseDeliverRecord,
  parseOwners,
  parseTask,
  pickNext,
  splitRepo,
  validateEntry,
} from "./queue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "queue-runner.sh");

const GOOD_TASK = { issue: "AWAI-3588", repo: "testowner/testrepo", branch: "muse/awai-3588-x" };

function validEntry(over = {}) {
  return {
    name: "01-first",
    taskText: JSON.stringify({ ...GOOD_TASK, ...(over.task ?? {}) }),
    promptExists: true,
    promptNonEmpty: true,
    owners: ["testowner"],
    ...over,
  };
}

// --- pure core: validation ---

test("validateEntry accepts a well-formed entry", () => {
  const r = validateEntry(validEntry());
  assert.deepEqual(r, { ok: true, task: GOOD_TASK });
});

test("validateEntry rejects bad names", () => {
  for (const name of ["", "-lead", ".dot", "a/b", "has space", "semi;colon", "x".repeat(82)]) {
    const r = validateEntry(validEntry({ name }));
    assert.deepEqual(r, { ok: false, reason: "bad-name" }, name);
  }
  // 81 chars (1 + 80) is the limit and passes.
  assert.equal(validateEntry(validEntry({ name: `a${"x".repeat(80)}` })).ok, true);
});

test("validateEntry rejects unparseable or non-object task.json", () => {
  for (const taskText of ["{nope", "", null, "[1]", '"s"', "42", "null"]) {
    assert.deepEqual(validateEntry(validEntry({ taskText })), { ok: false, reason: "bad-task-json" });
  }
});

test("validateEntry rejects bad issue keys", () => {
  for (const issue of ["awai-1", "AWAI-", "AWAI", "1-AWAI", "AWAI-1x", "", 7, null]) {
    const r = validateEntry(validEntry({ task: { issue } }));
    assert.deepEqual(r, { ok: false, reason: "bad-issue" }, String(issue));
  }
  assert.equal(validateEntry(validEntry({ task: { issue: "A-1" } })).ok, true);
});

test("validateEntry rejects bad repos", () => {
  for (const repo of [
    "no-slash",
    "/lead",
    "trail/",
    "../evil/x",
    "a/../b",
    "a/b..c",
    "under_score/x",
    "a/",
    "",
    "a/b/c",
  ]) {
    const r = validateEntry(validEntry({ task: { repo } }));
    assert.deepEqual(r, { ok: false, reason: "bad-repo" }, repo);
  }
  assert.equal(validateEntry(validEntry({ task: { repo: "a-1/b.c_d-e" }, owners: ["a-1"] })).ok, true);
});

test("validateEntry rejects bad branches", () => {
  for (const branch of [
    "main",
    "master",
    "a/",
    "a//b",
    "a/../b",
    "..a",
    "x.lock",
    "-lead",
    "/lead",
    "",
    `a${"x".repeat(121)}`,
  ]) {
    const r = validateEntry(validEntry({ task: { branch } }));
    assert.deepEqual(r, { ok: false, reason: "bad-branch" }, branch);
  }
  assert.equal(validateEntry(validEntry({ task: { branch: "muse/AWAI-1.a-b_c/d" } })).ok, true);
  // 121 chars (1 + 120) is the limit and passes.
  assert.equal(validateEntry(validEntry({ task: { branch: `a${"x".repeat(120)}` } })).ok, true);
});

test("validateEntry rejects a missing or empty prompt, and a foreign owner", () => {
  assert.deepEqual(validateEntry(validEntry({ promptExists: false })), { ok: false, reason: "bad-prompt" });
  assert.deepEqual(validateEntry(validEntry({ promptNonEmpty: false })), { ok: false, reason: "bad-prompt" });
  assert.deepEqual(validateEntry(validEntry({ owners: ["someone-else"] })), {
    ok: false,
    reason: "owner-not-allowed",
  });
  assert.deepEqual(validateEntry(validEntry({ owners: [] })), { ok: false, reason: "owner-not-allowed" });
});

test("parseOwners splits on commas, trims, and drops empties", () => {
  assert.deepEqual(parseOwners("a,b , ,c"), ["a", "b", "c"]);
  assert.deepEqual(parseOwners(""), []);
  assert.deepEqual(parseOwners(null), []);
});

test("splitRepo splits owner from name", () => {
  assert.deepEqual(splitRepo("o/n"), { owner: "o", name: "n" });
});

test("parseTask reports each field with a fixed reason", () => {
  assert.deepEqual(parseTask("{"), { ok: false, reason: "bad-task-json" });
  assert.equal(parseTask(JSON.stringify({ ...GOOD_TASK, issue: "nope" })).reason, "bad-issue");
  assert.equal(parseTask(JSON.stringify({ ...GOOD_TASK, repo: "o" })).reason, "bad-repo");
  assert.equal(parseTask(JSON.stringify({ ...GOOD_TASK, branch: "main" })).reason, "bad-branch");
});

// --- pure core: ordering, deliver record, result, log line ---

test("pickNext takes ascending names and only ready entries", () => {
  assert.equal(
    pickNext([
      { name: "c", ready: true },
      { name: "a", ready: false },
      { name: "b", ready: true },
    ]),
    "b",
  );
  assert.equal(pickNext([{ name: "a", ready: false }]), null);
  assert.equal(pickNext([]), null);
});

test("parseDeliverRecord keeps decision/pr/merged and fails closed", () => {
  const full = parseDeliverRecord(
    JSON.stringify({ decision: { action: "draft", reasons: [] }, pr: 7, merged: null, extra: 1 }),
  );
  assert.deepEqual(full, { decision: { action: "draft", reasons: [] }, pr: 7, merged: null });
  assert.equal(parseDeliverRecord(null), null);
  assert.equal(parseDeliverRecord("{bad"), null);
  assert.equal(parseDeliverRecord("[1]"), null);
  assert.deepEqual(parseDeliverRecord("{}"), { decision: null, pr: null, merged: null });
});

test("buildResult has the result.json shape", () => {
  assert.deepEqual(
    buildResult({
      name: "n",
      task: GOOD_TASK,
      state: "done",
      reason: "done",
      started: "s",
      ended: "e",
      pipeline: "done",
      deliver: { decision: { action: "merge" }, pr: 1, merged: null },
    }),
    {
      name: "n",
      issue: "AWAI-3588",
      repo: "testowner/testrepo",
      branch: "muse/awai-3588-x",
      state: "done",
      reason: "done",
      started: "s",
      ended: "e",
      pipeline: "done",
      deliver: { decision: { action: "merge" }, pr: 1, merged: null },
    },
  );
});

test("formatLogLine is one line of timestamp, name, state and reason", () => {
  const line = formatLogLine({ now: "2026-11-19T00:00:00Z", name: "n", state: "done", reason: "done" });
  assert.equal(line, "2026-11-19T00:00:00Z n done done");
  assert.ok(!line.includes("\n"));
});

// --- core CLI with injected fs (no processes, no real files) ---

function cliHarness(files = {}) {
  const store = new Map(Object.entries(files));
  const lines = [];
  const errors = [];
  const deps = {
    readFile: (p) => {
      if (!store.has(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return store.get(p);
    },
    fileExists: (p) => store.has(p),
    fileNonEmpty: (p) => (store.get(p) ?? "").length > 0,
    writeFile: (p, s) => store.set(p, s),
    log: (l) => lines.push(l),
    error: (l) => errors.push(l),
  };
  return { store, lines, errors, deps };
}

test("CLI validate-entry reports ok and invalid without touching the fs", () => {
  const h = cliHarness({
    "/t/task.json": JSON.stringify(GOOD_TASK),
    "/t/muse-prompt.md": "do it",
  });
  const rc = queueMain(
    ["validate-entry", "01-first", "--task", "/t/task.json", "--prompt", "/t/muse-prompt.md", "--owners", "testowner"],
    h.deps,
  );
  assert.equal(rc, 0);
  assert.deepEqual(h.lines, ["ok AWAI-3588 testowner/testrepo muse/awai-3588-x"]);

  const bad = cliHarness({
    "/t/task.json": JSON.stringify({ ...GOOD_TASK, branch: "main" }),
    "/t/muse-prompt.md": "do it",
  });
  assert.equal(
    queueMain(
      ["validate-entry", "01-first", "--task", "/t/task.json", "--prompt", "/t/muse-prompt.md", "--owners", "testowner"],
      bad.deps,
    ),
    1,
  );
  assert.deepEqual(bad.lines, ["invalid bad-branch"]);
  assert.equal(queueMain(["validate-entry"], cliHarness().deps), 2);
});

test("CLI write-result builds result.json from task, pipeline and deliver files", () => {
  const h = cliHarness({
    "/t/task.json": JSON.stringify(GOOD_TASK),
    "/p/pipeline.done": "done\n",
    "/d/deliver.json": JSON.stringify({ decision: { action: "hold" }, pr: 9, merged: null }),
  });
  const rc = queueMain(
    [
      "write-result", "--name", "01-first", "--task", "/t/task.json", "--state", "done",
      "--reason", "done", "--started", "s", "--ended", "e",
      "--pipeline", "/p/pipeline.done", "--deliver", "/d/deliver.json", "--out", "/o/result.json",
    ],
    h.deps,
  );
  assert.equal(rc, 0);
  assert.deepEqual(JSON.parse(h.store.get("/o/result.json")), {
    name: "01-first",
    issue: "AWAI-3588",
    repo: "testowner/testrepo",
    branch: "muse/awai-3588-x",
    state: "done",
    reason: "done",
    started: "s",
    ended: "e",
    pipeline: "done",
    deliver: { decision: { action: "hold" }, pr: 9, merged: null },
  });

  const missing = cliHarness({ "/t/task.json": JSON.stringify(GOOD_TASK) });
  assert.equal(
    queueMain(
      [
        "write-result", "--name", "n", "--task", "/t/task.json", "--state", "failed",
        "--reason", "no-token", "--started", "s", "--ended", "e",
        "--pipeline", "/p/missing", "--deliver", "/d/missing", "--out", "/o/result.json",
      ],
      missing.deps,
    ),
    0,
  );
  assert.deepEqual(JSON.parse(missing.store.get("/o/result.json")).deliver, null);
  assert.equal(JSON.parse(missing.store.get("/o/result.json")).pipeline, "");
});

// --- end-to-end: the real queue-runner.sh against a local bare repo ---

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")} failed: ${r.stderr}${r.stdout}`);
  return r;
}

/** Seed $tmp/up/testowner/testrepo.git with one commit; return the file:// base. */
function seedOrigin(tmp) {
  const seed = join(tmp, "seed");
  sh("git", ["init", "-q", "-b", "main", seed]);
  sh("git", ["-C", seed, "config", "user.email", "queue-test@example.com"]);
  sh("git", ["-C", seed, "config", "user.name", "queue-test"]);
  writeFileSync(join(seed, "file.txt"), "seed\n");
  sh("git", ["-C", seed, "add", "."]);
  sh("git", ["-C", seed, "commit", "-qm", "seed"]);
  const dir = join(tmp, "up", "testowner");
  mkdirSync(dir, { recursive: true });
  sh("git", ["init", "-q", "--bare", join(dir, "testrepo.git")]);
  sh("git", ["-C", seed, "push", "-q", join(dir, "testrepo.git"), "main"]);
  // A real hosting remote has its HEAD on the default branch; point it there
  // so the clone checks out a commit.
  sh("git", ["--git-dir", join(dir, "testrepo.git"), "symbolic-ref", "HEAD", "refs/heads/main"]);
  return `file://${join(tmp, "up")}/`;
}

const FAKE_RUN_TASK = `#!/usr/bin/env bash
set -u
WD=$1; PHASE=$2; EXTRA=\${3:-}
LOG="\${FAKE_LOG:?}/calls"
echo "call phase=$PHASE\${EXTRA:+ $EXTRA} gh=\${GH_TOKEN-<absent>} github=\${GITHUB_TOKEN-<absent>}" >> "$LOG"
if [ "$PHASE" = "--no-deliver" ]; then
  case "\${FAKE_MODE:-good}" in
    impl-fail) echo failed-implement > "$WD/.agent-output/pipeline.done"; exit 1;;
    spaced-done) echo "d o n e" > "$WD/.agent-output/pipeline.done"; exit 0;;
  esac
  echo done > "$WD/.agent-output/pipeline.done"
  exit 0
fi
if [ "$PHASE" = "--from" ] && [ "$EXTRA" = deliver ]; then
  case "\${FAKE_MODE:-good}" in
    deliver-fail) echo failed-deliver > "$WD/.agent-output/pipeline.done"; exit 1;;
    good-draft)
      echo done > "$WD/.agent-output/pipeline.done"
      printf '{"decision":{"action":"draft","reasons":[]},"pr":7,"merged":null}' > "$WD/.agent-output/deliver.json"
      exit 0;;
  esac
  echo done > "$WD/.agent-output/pipeline.done"
  printf '{"decision":{"action":"merge","reasons":[]},"pr":123,"merged":null}' > "$WD/.agent-output/deliver.json"
  exit 0
fi
echo "bad fake args" >&2; exit 2
`;

/** Queue dir plus a fake run-task script; returns {queue, fake, calls}. */
function makeQueue(tmp, t) {
  const queue = join(tmp, "q");
  mkdirSync(join(queue, "inbox"), { recursive: true });
  const fake = join(tmp, "fake-run-task.sh");
  writeFileSync(fake, FAKE_RUN_TASK);
  chmodSync(fake, 0o755);
  mkdirSync(join(tmp, "fakelog"), { recursive: true });
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  return { queue, fake, logDir: join(tmp, "fakelog"), calls: join(tmp, "fakelog", "calls") };
}

function writeEntry(queue, name, over = {}) {
  const d = join(queue, "inbox", name);
  mkdirSync(d, { recursive: true });
  writeFileSync(
    join(d, "task.json"),
    over.rawTask ??
      JSON.stringify({
        issue: over.issue ?? "AWAI-3588",
        repo: over.repo ?? "testowner/testrepo",
        branch: over.branch ?? `muse/awai-3588-${name}`,
      }),
  );
  writeFileSync(join(d, "muse-prompt.md"), over.prompt ?? "do the thing");
  if (over.ready !== false) writeFileSync(join(d, "ready"), "");
}

function runnerEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  env.PATH = `${dirname(process.execPath)}${delimiter}${env.PATH ?? ""}`;
  return env;
}

function runQueue(queue, env, args = ["--once"]) {
  return spawnSync("bash", [RUNNER, queue, ...args], { encoding: "utf8", env });
}

function resultOf(queue, dest, name) {
  return JSON.parse(readFileSync(join(queue, dest, name, "result.json"), "utf8"));
}

function baseEnv(tmp, ctx, extra = {}) {
  return runnerEnv({
    DEV_BOTS_ALLOWED_OWNERS: "testowner",
    DEV_BOTS_CLONE_BASE: seedOrigin(tmp),
    DEV_BOTS_RUN_TASK: ctx.fake,
    FAKE_LOG: ctx.logDir,
    ...extra,
  });
}

test("e2e: a good entry reaches done/ with the expected result.json", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-first");
  const env = baseEnv(tmp, ctx, {
    DEV_BOTS_TOKEN_CMD: `echo "$TASK_OWNER/$TASK_REPO" > "${ctx.logDir}/owner"; printf secret-token`,
  });
  const r = runQueue(ctx.queue, env);
  assert.equal(r.status, 0, r.stderr);

  const res = resultOf(ctx.queue, "done", "01-first");
  assert.equal(res.name, "01-first");
  assert.equal(res.issue, "AWAI-3588");
  assert.equal(res.repo, "testowner/testrepo");
  assert.equal(res.branch, "muse/awai-3588-01-first");
  assert.equal(res.state, "done");
  assert.equal(res.reason, "done");
  assert.equal(res.pipeline, "done");
  assert.deepEqual(res.deliver, { decision: { action: "merge", reasons: [] }, pr: 123, merged: null });
  assert.ok(res.started.length > 0 && res.ended.length > 0);

  // The fake saw no token in the first phase and the token in delivery.
  const calls = readFileSync(ctx.calls, "utf8").trim().split("\n");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /phase=--no-deliver gh=<absent> github=<absent>/);
  assert.match(calls[1], /phase=--from deliver gh=secret-token/);
  // The token command saw owner and repository name.
  assert.equal(readFileSync(join(ctx.logDir, "owner"), "utf8").trim(), "testowner/testrepo");
  // The token is nowhere on disk: not in result.json, not in the log.
  for (const p of [join(ctx.queue, "done", "01-first", "result.json"), join(ctx.queue, "runner.log")]) {
    assert.ok(!readFileSync(p, "utf8").includes("secret-token"), p);
  }
  // Branch created, inputs copied into the work dir.
  assert.equal(
    sh("git", ["-C", join(ctx.queue, "work", "01-first"), "rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim(),
    "muse/awai-3588-01-first",
  );
  assert.ok(existsSync(join(ctx.queue, "work", "01-first", ".agent-output", "task.json")));
  assert.ok(existsSync(join(ctx.queue, "work", "01-first", ".agent-output", "muse-prompt.md")));
  const log = readFileSync(join(ctx.queue, "runner.log"), "utf8");
  assert.match(log, /01-first running started/);
  assert.match(log, /01-first done done/);
});

test("e2e: entries run in ascending order and entries without ready are left alone", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "03-c");
  writeEntry(ctx.queue, "01-a");
  writeEntry(ctx.queue, "02-b", { ready: false });
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  assert.equal(resultOf(ctx.queue, "done", "01-a").state, "done");
  assert.equal(resultOf(ctx.queue, "done", "03-c").state, "done");
  assert.ok(existsSync(join(ctx.queue, "inbox", "02-b", "task.json")));
  assert.ok(!existsSync(join(ctx.queue, "done", "02-b")));
  const log = readFileSync(join(ctx.queue, "runner.log"), "utf8");
  assert.ok(log.indexOf("01-a done done") < log.indexOf("03-c done done"));
});

test("e2e: token command failure fails the entry without running delivery", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-tok");
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "exit 3" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  const res = resultOf(ctx.queue, "failed", "01-tok");
  assert.equal(res.state, "failed");
  assert.equal(res.reason, "no-token");
  assert.equal(res.deliver, null);
  const calls = readFileSync(ctx.calls, "utf8").trim().split("\n");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /phase=--no-deliver/);
});

test("e2e: an empty token fails the entry without running delivery", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-empty");
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf ''" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  assert.equal(resultOf(ctx.queue, "failed", "01-empty").reason, "no-token");
  assert.equal(readFileSync(ctx.calls, "utf8").trim().split("\n").length, 1);
});

test("e2e: implement failure fails the entry and never runs the token command", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-impl");
  const marker = join(ctx.logDir, "token-ran");
  const env = baseEnv(tmp, ctx, {
    FAKE_MODE: "impl-fail",
    DEV_BOTS_TOKEN_CMD: `touch "${marker}"; printf tok`,
  });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  const res = resultOf(ctx.queue, "failed", "01-impl");
  assert.equal(res.reason, "implement-failed");
  assert.equal(res.pipeline, "failed-implement");
  assert.ok(!existsSync(marker));
});

test("e2e: disallowed owner and bad branch fail with nothing cloned", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-owner", { repo: "evil/testrepo" });
  writeEntry(ctx.queue, "02-branch", { branch: "main" });
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  assert.equal(resultOf(ctx.queue, "failed", "01-owner").reason, "owner-not-allowed");
  assert.equal(resultOf(ctx.queue, "failed", "02-branch").reason, "bad-branch");
  assert.deepEqual(readdirSync(join(ctx.queue, "work")), []);
  assert.ok(!existsSync(ctx.calls));
});

test("e2e: a missing allowlist refuses to start with exit 2", (t) => {
  for (const owners of [undefined, ""]) {
    const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
    const ctx = makeQueue(tmp, t);
    writeEntry(ctx.queue, "01-x");
    const env = runnerEnv({
      DEV_BOTS_CLONE_BASE: seedOrigin(tmp),
      DEV_BOTS_RUN_TASK: ctx.fake,
      FAKE_LOG: ctx.logDir,
      DEV_BOTS_TOKEN_CMD: "printf tok",
    });
    if (owners === undefined) delete env.DEV_BOTS_ALLOWED_OWNERS;
    else env.DEV_BOTS_ALLOWED_OWNERS = owners;
    const r = runQueue(ctx.queue, env);
    assert.equal(r.status, 2, `owners=${owners}: ${r.stderr}`);
    assert.ok(existsSync(join(ctx.queue, "inbox", "01-x", "task.json")));
    assert.ok(!existsSync(join(ctx.queue, "running", "01-x")));
  }
});

test("e2e: an entry left in running/ fails as interrupted and is not re-run", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  const rdir = join(ctx.queue, "running", "old-entry");
  mkdirSync(rdir, { recursive: true });
  writeFileSync(join(rdir, "task.json"), JSON.stringify(GOOD_TASK));
  writeFileSync(join(rdir, "muse-prompt.md"), "do the thing");
  const wdir = join(ctx.queue, "work", "old-entry");
  mkdirSync(wdir, { recursive: true });
  writeFileSync(join(wdir, "sentinel"), "stays\n");
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  const res = resultOf(ctx.queue, "failed", "old-entry");
  assert.equal(res.reason, "interrupted");
  assert.equal(res.issue, "AWAI-3588");
  assert.equal(res.pipeline, "");
  assert.equal(res.deliver, null);
  assert.equal(readFileSync(join(wdir, "sentinel"), "utf8"), "stays\n");
  assert.ok(!existsSync(ctx.calls));
});

test("e2e: a stop file means nothing is taken", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-wait");
  writeFileSync(join(ctx.queue, "stop"), "");
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  assert.ok(existsSync(join(ctx.queue, "inbox", "01-wait", "task.json")));
  assert.ok(!existsSync(join(ctx.queue, "done", "01-wait")));
  assert.ok(!existsSync(join(ctx.queue, "failed", "01-wait")));
  assert.ok(existsSync(join(ctx.queue, "stop")));
  assert.ok(!existsSync(ctx.calls));
});

test("e2e: a second runner exits 3 while the lock is held, and takes over a stale lock", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-x");
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok" });
  const sleeper = spawn("sleep", ["120"]);
  t.after(() => {
    try {
      sleeper.kill();
    } catch {}
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  writeFileSync(join(ctx.queue, "runner.lock"), `${sleeper.pid}\n`);
  const held = runQueue(ctx.queue, env);
  assert.equal(held.status, 3);
  assert.ok(existsSync(join(ctx.queue, "inbox", "01-x", "task.json")));
  sleeper.kill();
  await new Promise((resolve) => sleeper.on("exit", resolve));
  // The dead pid is a stale lock: the new runner takes over and drains.
  writeFileSync(join(ctx.queue, "runner.lock"), `${sleeper.pid}\n`);
  assert.equal(runQueue(ctx.queue, env).status, 0);
  assert.equal(resultOf(ctx.queue, "done", "01-x").state, "done");
  assert.ok(!existsSync(join(ctx.queue, "runner.lock")));
});

test("e2e: an existing work dir is an error and is never deleted", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-clash");
  const wdir = join(ctx.queue, "work", "01-clash");
  mkdirSync(wdir, { recursive: true });
  writeFileSync(join(wdir, "sentinel"), "stays\n");
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  assert.equal(resultOf(ctx.queue, "failed", "01-clash").reason, "work-exists");
  assert.equal(readFileSync(join(wdir, "sentinel"), "utf8"), "stays\n");
  assert.ok(!existsSync(ctx.calls));
});

test("e2e: an unclonable repo fails the entry", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-gone", { repo: "testowner/nonexistent" });
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  assert.equal(resultOf(ctx.queue, "failed", "01-gone").reason, "clone-failed");
  assert.ok(!existsSync(join(ctx.queue, "work", "01-gone", ".git")));
});

test("e2e: empty clone args pass zero flags, unset args pass the default", (t) => {
  for (const [args, wantFilter] of [[undefined, true], ["", false]]) {
    const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
    const ctx = makeQueue(tmp, t);
    writeEntry(ctx.queue, "01-flags");
    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    assert.ok(realGit.length > 0);
    const bindir = join(tmp, "bin");
    mkdirSync(bindir, { recursive: true });
    const gitlog = join(tmp, "git-args.log");
    writeFileSync(
      join(bindir, "git"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${gitlog}"\nexec "${realGit}" "$@"\n`,
    );
    chmodSync(join(bindir, "git"), 0o755);
    const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok" });
    delete env.DEV_BOTS_CLONE_ARGS;
    if (args !== undefined) env.DEV_BOTS_CLONE_ARGS = args;
    env.PATH = `${bindir}${delimiter}${env.PATH}`;
    assert.equal(runQueue(ctx.queue, env).status, 0);
    assert.equal(resultOf(ctx.queue, "done", "01-flags").state, "done");
    const cloneLines = readFileSync(gitlog, "utf8").split("\n").filter((l) => l.startsWith("clone "));
    assert.equal(cloneLines.length, 1);
    assert.equal(cloneLines[0].includes("--filter=blob:none"), wantFilter, cloneLines[0]);
  }
});

test("e2e: a pipeline marker that is not exactly done fails the entry", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-spaced");
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok", FAKE_MODE: "spaced-done" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  assert.equal(resultOf(ctx.queue, "failed", "01-spaced").reason, "implement-failed");
});

test("e2e: delivery failure fails the entry", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-deliver");
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok", FAKE_MODE: "deliver-fail" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  const fail = resultOf(ctx.queue, "failed", "01-deliver");
  assert.equal(fail.reason, "deliver-failed");
  assert.equal(fail.pipeline, "failed-deliver");
  assert.equal(fail.deliver, null);
});

test("e2e: a draft delivery decision is still done and visible in deliver.decision", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "queue-test-"));
  const ctx = makeQueue(tmp, t);
  writeEntry(ctx.queue, "01-draft");
  const env = baseEnv(tmp, ctx, { DEV_BOTS_TOKEN_CMD: "printf tok", FAKE_MODE: "good-draft" });
  assert.equal(runQueue(ctx.queue, env).status, 0);
  const res = resultOf(ctx.queue, "done", "01-draft");
  assert.equal(res.state, "done");
  assert.equal(res.deliver.decision.action, "draft");
  assert.equal(res.deliver.pr, 7);
});
