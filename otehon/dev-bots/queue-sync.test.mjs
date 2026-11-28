import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  describeEntry,
  main,
  markScript,
  parseRemote,
  pushScript,
  sha256hex,
  shq,
  snapshotScript,
  sync,
  validateQueuePath,
} from "./queue-sync.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "queue-sync.mjs");
const TASK = { issue: "AWAI-1", repo: "testowner/testrepo", branch: "muse/awai-1-x" };
const REC = "2026-11-19T10-00-00-000Z-comment.json";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// ---- pure helpers ----

test("shq survives single quotes and shell metacharacters", () => {
  const nasty = "a'b $(touch x) `id` ;\n\"";
  const r = spawnSync("bash", ["-c", `printf %s ${shq(nasty)}`], { encoding: "utf8" });
  assert.equal(r.stdout, nasty);
});

test("validateQueuePath accepts plain absolute paths only", () => {
  assert.equal(validateQueuePath("/root/q"), true);
  for (const bad of ["q", "/root/../q", "/root/q x", "/root/q;id", "/root/$q", "", null, "/"]) {
    assert.equal(validateQueuePath(bad), false, String(bad));
  }
});

test("parseRemote needs the END marker", () => {
  assert.equal(parseRemote("RUNNER alive 12\n").complete, false);
  assert.equal(parseRemote("RUNNER alive 12\nEND\n").complete, true);
});

test("parseRemote drops names that would leave the state directory", () => {
  const p = parseRemote([
    `OUTBOX ../../etc ${REC} ${b64("{}")}`,
    `OUTBOX good ../x-comment.json ${b64("{}")}`,
    `OUTBOX good ${REC} not*base64`,
    `OUTBOX good notes.json ${b64("{}")}`,
    `RESULT done a/b ${b64("{}")}`,
    "ENTRY elsewhere good",
    `OUTBOX good ${REC} ${b64('{"k":1}')}`,
    "END",
  ].join("\n"));
  assert.equal(p.outbox.length, 1);
  assert.deepEqual(p.outbox[0], { name: "good", file: REC, text: '{"k":1}' });
  assert.equal(p.results.length, 0);
  assert.equal(p.entries.length, 0);
  assert.equal(p.malformed, 6);
});

test("describeEntry shows only known fields and no control characters", () => {
  const line = describeEntry(
    { state: "done", name: "n1" },
    JSON.stringify({ issue: "AWAI-1", reason: "done\u001b[31m", secret: "zzz", deliver: { decision: { action: "merge" }, pr: "https://x/1", merged: { commit: "abc" } } }),
  );
  assert.equal(line, "entry done n1 AWAI-1 done?[31m merge pr=https://x/1 merged");
  assert.equal(
    describeEntry({ state: "done", name: "n4" }, JSON.stringify({ issue: "AWAI-2", reason: "done", deliver: { decision: { action: "draft" }, pr: "https://x/2", merged: null } })),
    "entry done n4 AWAI-2 done draft pr=https://x/2 not-merged",
  );
  assert.equal(describeEntry({ state: "failed", name: "n2" }, "{not json"), "entry failed n2 unreadable-result");
  assert.equal(describeEntry({ state: "inbox", name: "n3" }, undefined), "entry inbox n3");
});

// ---- sync() with a fake remote ----

function fakeFs(files = {}) {
  const store = new Map(Object.entries(files));
  return {
    store,
    readFile: (p) => {
      if (!store.has(p)) throw new Error("ENOENT");
      return store.get(p);
    },
    writeFile: (p, t) => store.set(p, t),
    exists: (p) => store.has(p) || [...store.keys()].some((k) => k.startsWith(`${p}/`)),
    mkdirp: () => {},
    listDir: (d) => [...store.keys()].filter((k) => dirname(k) === d).map((k) => k.slice(d.length + 1)),
  };
}

function snapshot(lines) {
  return { status: 0, stdout: [...lines, "END", ""].join("\n") };
}

test("sync: remote failure and cut output stop before anything is posted", () => {
  for (const reply of [{ status: 1, stdout: "", stderr: "no device" }, { status: 0, stdout: `OUTBOX n ${REC} ${b64(JSON.stringify({ issue: "AWAI-1", kind: "comment", body: "x" }))}\n` }]) {
    const fs = fakeFs({ "/s/n/task.json": JSON.stringify(TASK) });
    let drained = 0;
    const r = sync({ queue: "/q", stateDir: "/s" }, { ...fs, remote: () => reply, drain: () => { drained += 1; return 0; } });
    assert.equal(r.exitCode, 1);
    assert.equal(drained, 0);
  }
});

test("sync: a record is held unless this state dir pushed the entry with that issue", () => {
  const fs = fakeFs({ "/s/mine/task.json": JSON.stringify(TASK) });
  const logs = [];
  let drained = 0;
  const r = sync({ queue: "/q", stateDir: "/s" }, {
    ...fs,
    remote: () => snapshot([
      "RUNNER alive 7",
      `OUTBOX stranger ${REC} ${b64(JSON.stringify({ issue: "AWAI-1", kind: "comment", body: "x" }))}`,
      `OUTBOX mine ${REC} ${b64(JSON.stringify({ issue: "AWAI-999", kind: "comment", body: "x" }))}`,
    ]),
    drain: () => { drained += 1; return 0; },
    log: (l) => logs.push(l),
  });
  assert.equal(r.summary.held, 2);
  assert.equal(r.summary.collected, 0);
  assert.equal(drained, 0);
  assert.equal(r.exitCode, 1);
  assert.ok(logs.includes(`held stranger ${REC} entry-not-pushed-from-here`));
  assert.ok(logs.includes(`held mine ${REC} issue-mismatch`));
  assert.equal(fs.store.has(`/s/stranger/linear-outbox/${REC}`), false);
});

test("sync: a record already posted locally is only marked remotely, never posted again", () => {
  const fs = fakeFs({
    "/s/mine/task.json": JSON.stringify(TASK),
    [`/s/mine/linear-outbox/${REC}.posted`]: "{}",
  });
  const scripts = [];
  let drained = 0;
  const r = sync({ queue: "/q", stateDir: "/s" }, {
    ...fs,
    remote: (script) => {
      scripts.push(script);
      if (scripts.length === 1) {
        return snapshot(["RUNNER alive 7", `OUTBOX mine ${REC} ${b64(JSON.stringify({ issue: "AWAI-1", kind: "comment", body: "x" }))}`]);
      }
      return snapshot([`MARK mine ${REC} ok`]);
    },
    drain: () => { drained += 1; return 0; },
  });
  assert.equal(drained, 0);
  assert.equal(r.summary.marked, 1);
  assert.equal(r.exitCode, 0);
  assert.match(scripts[1], /mark 'mine' '2026-11-19T10-00-00-000Z-comment\.json'/);
});

test("sync: --dry-run sends only the read-only snapshot", () => {
  const fs = fakeFs({
    "/e/n1/task.json": JSON.stringify(TASK),
    "/e/n1/muse-prompt.md": "do it",
    "/s/mine/task.json": JSON.stringify(TASK),
    [`/s/mine/linear-outbox/${REC}.posted`]: "{}",
  });
  const scripts = [];
  const logs = [];
  const r = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n1"], owners: ["testowner"], dryRun: true }, {
    ...fs,
    remote: (script) => {
      scripts.push(script);
      return snapshot(["RUNNER alive 7", `OUTBOX mine ${REC} ${b64("{}")}`]);
    },
    drain: () => 0,
    log: (l) => logs.push(l),
  });
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0], snapshotScript("/q"));
  assert.doesNotMatch(scripts[0], /mv |mkdir|> "/);
  assert.ok(logs.includes("would-push n1 AWAI-1 testowner/testrepo"));
  assert.equal(r.summary.pushed, 0);
  assert.equal(fs.store.has("/s/n1/task.json"), false);
});

test("sync: invalid, duplicate and already-pushed entries are rejected locally", () => {
  const fs = fakeFs({
    "/e/ok/task.json": JSON.stringify(TASK),
    "/e/ok/muse-prompt.md": "p",
    "/e/other/task.json": JSON.stringify({ ...TASK, repo: "stranger/repo" }),
    "/e/other/muse-prompt.md": "p",
    "/e/empty/task.json": JSON.stringify(TASK),
    "/e/empty/muse-prompt.md": "",
    "/e/old/task.json": JSON.stringify(TASK),
    "/e/old/muse-prompt.md": "p",
    "/s/old/task.json": JSON.stringify(TASK),
  });
  const logs = [];
  const scripts = [];
  const r = sync(
    { queue: "/q", stateDir: "/s", entryDirs: ["/e/ok", "/e/ok", "/e/other", "/e/empty", "/e/old", "/e/missing"], owners: ["testowner"] },
    {
      ...fs,
      remote: (script) => {
        scripts.push(script);
        return scripts.length === 1 ? snapshot(["PUSH ok ok"]) : snapshot(["RUNNER none 0"]);
      },
      drain: () => 0,
      log: (l) => logs.push(l),
    },
  );
  assert.equal(r.summary.pushed, 1);
  assert.equal(r.summary.rejected, 5);
  assert.equal(r.exitCode, 1);
  for (const want of ["rejected ok duplicate-name", "rejected other owner-not-allowed", "rejected empty bad-prompt", "rejected old already-pushed", "rejected missing bad-task-json"]) {
    assert.ok(logs.includes(want), want);
  }
  assert.equal((scripts[0].match(/^put /gm) ?? []).length, 1);
  assert.ok(logs.includes("warning: no runner is working on this queue"));
});

// ---- end to end against a real directory, with "bash -s" as the remote ----

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "queue-sync-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const q = join(root, "q");
  const state = join(root, "state");
  const bin = join(root, "bin");
  const entries = join(root, "entries");
  for (const d of [join(q, "inbox"), join(q, "done"), join(q, "work"), state, bin, entries]) mkdirSync(d, { recursive: true });
  const orcaLog = join(root, "orca.log");
  writeFileSync(join(bin, "orca"), `#!/bin/sh\necho "$@" >> ${shq(orcaLog)}\n[ -z "\${ORCA_FAIL:-}" ] || exit 1\nexit 0\n`);
  chmodSync(join(bin, "orca"), 0o755);
  const entry = (name, task = TASK) => {
    const d = join(entries, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "task.json"), JSON.stringify(task));
    writeFileSync(join(d, "muse-prompt.md"), "# prompt with 'quotes' and $(nothing)\n");
    return d;
  };
  const run = (args, env = {}) => spawnSync(process.execPath, [CLI, "--queue", q, "--state", state, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, DEV_BOTS_REMOTE_SHELL: "bash -s", DEV_BOTS_ALLOWED_OWNERS: "testowner", ...env },
  });
  const orcaCalls = () => (existsSync(orcaLog) ? readFileSync(orcaLog, "utf8").trim().split("\n").filter(Boolean) : []);
  // What the runner would do with an entry: move it to done/ and leave a record.
  const finish = (name, record = { issue: TASK.issue, kind: "comment", body: "done by the bot" }) => {
    spawnSync("mv", [join(q, "inbox", name), join(q, "done", name)]);
    writeFileSync(join(q, "done", name, "result.json"), JSON.stringify({ name, issue: TASK.issue, state: "done", reason: "done" }));
    const ob = join(q, "work", name, ".agent-output", "linear-outbox");
    mkdirSync(ob, { recursive: true });
    writeFileSync(join(ob, REC), JSON.stringify(record));
    return ob;
  };
  return { root, q, state, entry, run, orcaCalls, finish };
}

test("e2e: push writes a complete entry with its ready marker and refuses a second one", (t) => {
  const s = sandbox(t);
  const dir = s.entry("10-a");
  const r1 = s.run([dir]);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.match(r1.stdout, /^pushed 10-a AWAI-1 testowner\/testrepo$/m);
  assert.deepEqual(readdirSync(join(s.q, "inbox", "10-a")).sort(), ["muse-prompt.md", "ready", "task.json"]);
  assert.equal(readFileSync(join(s.q, "inbox", "10-a", "muse-prompt.md"), "utf8"), "# prompt with 'quotes' and $(nothing)\n");
  assert.deepEqual(readdirSync(join(s.q, "stage")), []);
  // same name again: refused locally
  const r2 = s.run([dir]);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /^rejected 10-a already-pushed$/m);
  // same name from a fresh state dir: refused by the remote side
  rmSync(join(s.state, "10-a"), { recursive: true });
  const r3 = s.run([dir]);
  assert.equal(r3.status, 1);
  assert.match(r3.stdout, /^rejected 10-a exists-inbox$/m);
});

test("e2e: a finished entry's record is posted once and marked on both sides", (t) => {
  const s = sandbox(t);
  assert.equal(s.run([s.entry("10-a")]).status, 0);
  const ob = s.finish("10-a");
  const r1 = s.run([]);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.match(r1.stdout, /^posted AWAI-1 comment /m);
  assert.match(r1.stdout, /^entry done 10-a AWAI-1 done$/m);
  assert.deepEqual(readdirSync(ob), [`${REC}.posted`]);
  assert.deepEqual(readdirSync(join(s.state, "10-a", "linear-outbox")), [`${REC}.posted`]);
  assert.ok(existsSync(join(s.state, "10-a", "result.json")));
  assert.equal(s.orcaCalls().length, 1);
  const r2 = s.run([]);
  assert.equal(r2.status, 0);
  assert.equal(s.orcaCalls().length, 1);
});

test("e2e: when the remote mark is lost, the next run repeats the mark and does not post again", (t) => {
  const s = sandbox(t);
  assert.equal(s.run([s.entry("10-a")]).status, 0);
  const ob = s.finish("10-a");
  assert.equal(s.run([]).status, 0);
  // Undo the remote mark only, as if the connection dropped after posting.
  spawnSync("mv", [join(ob, `${REC}.posted`), join(ob, REC)]);
  const r = s.run([]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(ob), [`${REC}.posted`]);
  assert.equal(s.orcaCalls().length, 1);
});

test("e2e: a failed post leaves the record unmarked on both sides and exits 1", (t) => {
  const s = sandbox(t);
  assert.equal(s.run([s.entry("10-a")]).status, 0);
  const ob = s.finish("10-a");
  const r = s.run([], { ORCA_FAIL: "1" });
  assert.equal(r.status, 1);
  assert.deepEqual(readdirSync(ob), [REC]);
  assert.deepEqual(readdirSync(join(s.state, "10-a", "linear-outbox")), [REC]);
  const again = s.run([]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.deepEqual(readdirSync(ob), [`${REC}.posted`]);
});

test("e2e: --dry-run changes nothing on the remote side and posts nothing", (t) => {
  const s = sandbox(t);
  assert.equal(s.run([s.entry("10-a")]).status, 0);
  const ob = s.finish("10-a");
  const r = s.run(["--dry-run", s.entry("20-b")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^would-push 20-b /m);
  assert.match(r.stdout, /^would-post AWAI-1 comment /m);
  assert.deepEqual(readdirSync(join(s.q, "inbox")), []);
  assert.deepEqual(readdirSync(ob), [REC]);
  assert.equal(s.orcaCalls().length, 0);
});

test("e2e: a record for another issue is held and never posted", (t) => {
  const s = sandbox(t);
  assert.equal(s.run([s.entry("10-a")]).status, 0);
  const ob = s.finish("10-a", { issue: "AWAI-777", kind: "comment", body: "not mine" });
  const r = s.run([]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^held 10-a .* issue-mismatch$/m);
  assert.deepEqual(readdirSync(ob), [REC]);
  assert.equal(s.orcaCalls().length, 0);
});

test("e2e: usage errors exit 2 and reach no host", (t) => {
  const s = sandbox(t);
  assert.equal(s.run([], { DEV_BOTS_REMOTE_SHELL: "" }).status, 2);
  assert.equal(s.run([s.entry("10-a")], { DEV_BOTS_ALLOWED_OWNERS: "" }).status, 2);
  assert.equal(main(["--queue", "relative", "--state", s.state], { DEV_BOTS_REMOTE_SHELL: "false" }), 2);
  assert.equal(main(["--queue", "/q", "--state", join(s.root, "nope")], { DEV_BOTS_REMOTE_SHELL: "false" }), 2);
  assert.equal(main(["--queue", "/q"], { DEV_BOTS_REMOTE_SHELL: "false" }), 2);
});

test("e2e: a queue directory that does not exist is reported, not created", (t) => {
  const s = sandbox(t);
  const r = spawnSync(process.execPath, [CLI, "--queue", join(s.root, "absent"), "--state", s.state], {
    encoding: "utf8",
    env: { ...process.env, DEV_BOTS_REMOTE_SHELL: "bash -s" },
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^error remote: no-queue$/m);
  assert.equal(existsSync(join(s.root, "absent")), false);
});

test("scripts: push, snapshot and mark are plain bash that parses", () => {
  for (const script of [pushScript("/q", [{ name: "n", taskText: "{}", promptText: "p" }]), snapshotScript("/q"), markScript("/q", [{ name: "n", file: REC }])]) {
    const r = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
});

// ---- lost acknowledgement (AWAI-3596) ----

function fakeFsPending(files = {}) {
  const store = new Map(Object.entries(files));
  const children = (d) => {
    const prefix = d.endsWith("/") ? d : `${d}/`;
    const out = new Set();
    for (const k of store.keys()) {
      if (!k.startsWith(prefix)) continue;
      const seg = k.slice(prefix.length).split("/")[0];
      if (seg) out.add(seg);
    }
    return [...out];
  };
  return {
    store,
    readFile: (p) => {
      if (!store.has(p)) throw new Error("ENOENT");
      return store.get(p);
    },
    writeFile: (p, t) => store.set(p, t),
    exists: (p) => store.has(p) || [...store.keys()].some((k) => k.startsWith(`${p}/`)),
    mkdirp: () => {},
    listDir: (d) => children(d),
    remove: (p) => {
      store.delete(p);
      for (const k of [...store.keys()]) {
        if (k.startsWith(`${p}/`)) store.delete(k);
      }
    },
  };
}

test("parseRemote validates digest lines and never matches malformed digests", () => {
  const good = "a".repeat(64);
  const p = parseRemote([
    "RUNNER none 0",
    `ENTRY inbox n`,
    `DIGEST inbox n ${good} ${good}`,
    `DIGEST inbox bad-name! ${good} ${good}`,
    `DIGEST elsewhere n ${good} ${good}`,
    `DIGEST inbox n ${good}`,
    `DIGEST inbox n nothex nothex`,
    "END",
  ].join("\n"));
  assert.equal(p.digests.length, 2);
  assert.deepEqual(p.digests[0], { state: "inbox", name: "n", taskSha256: good, promptSha256: good });
  assert.deepEqual(p.digests[1], { state: "inbox", name: "n", taskSha256: null, promptSha256: null });
  assert.ok(p.malformed >= 3);
});

test("sync: the push intent is persisted before the push and cleared on ok or refusal", () => {
  const taskText = JSON.stringify(TASK);
  const prompt = "do it";
  for (const pushLine of ["PUSH n ok", "PUSH n exists-inbox"]) {
    const fs = fakeFsPending({ "/e/n/task.json": taskText, "/e/n/muse-prompt.md": prompt });
    const logs = [];
    let seenPending = null;
    const r = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"] }, {
      ...fs,
      remote: (script) => {
        if (script.includes("\nput ")) {
          seenPending = fs.store.get("/s/n/pending.json") ?? null;
          return snapshot([pushLine]);
        }
        return snapshot(["RUNNER none 0"]);
      },
      drain: () => 0,
      log: (l) => logs.push(l),
    });
    const pend = JSON.parse(seenPending);
    assert.equal(pend.taskText, taskText);
    assert.equal(pend.taskSha256, sha256hex(taskText));
    assert.equal(pend.promptSha256, sha256hex(prompt));
    assert.equal(fs.store.has("/s/n/pending.json"), false);
    if (pushLine === "PUSH n ok") {
      assert.equal(r.summary.pushed, 1);
      assert.equal(fs.store.get("/s/n/task.json"), taskText);
      assert.ok(logs.some((l) => l.startsWith("pushed n ")));
    } else {
      assert.equal(r.summary.rejected, 1);
      assert.equal(fs.store.has("/s/n/task.json"), false);
      assert.ok(logs.includes("rejected n exists-inbox"));
    }
  }
});

test("sync: a failed or cut push keeps pending.json and exits 1", () => {
  const taskText = JSON.stringify(TASK);
  const replies = [
    { status: 1, stdout: "", stderr: "boom" },
    { status: 0, stdout: "PUSH n ok\n" },
  ];
  for (const reply of replies) {
    const fs = fakeFsPending({ "/e/n/task.json": taskText, "/e/n/muse-prompt.md": "p" });
    const logs = [];
    const r = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"] }, {
      ...fs,
      remote: () => reply,
      drain: () => 0,
      log: (l) => logs.push(l),
    });
    assert.equal(r.exitCode, 1);
    assert.ok(fs.store.has("/s/n/pending.json"), "lost ack must keep the intent");
    assert.equal(fs.store.has("/s/n/task.json"), false);
    assert.ok(logs.some((l) => l.startsWith("pending n ")));
  }
});

test("sync: a lost acknowledgement is recovered and its record posts exactly once", () => {
  const taskText = JSON.stringify(TASK);
  const prompt = "do it";
  const th = sha256hex(taskText);
  const ph = sha256hex(prompt);
  const fs = fakeFsPending({ "/s/n/pending.json": JSON.stringify({ name: "n", taskText, taskSha256: th, promptSha256: ph }) });
  const logs = [];
  let drained = 0;
  const recText = JSON.stringify({ issue: "AWAI-1", kind: "comment", body: "x" });
  const scripts = [];
  const r = sync({ queue: "/q", stateDir: "/s" }, {
    ...fs,
    remote: (script) => {
      scripts.push(script);
      if (script.includes("\nmark ")) return snapshot([`MARK n ${REC} ok`]);
      return snapshot(["RUNNER alive 7", "ENTRY inbox n", `DIGEST inbox n ${th} ${ph}`, `OUTBOX n ${REC} ${b64(recText)}`]);
    },
    drain: (dir) => {
      drained += 1;
      fs.writeFile(join(dir, `${REC}.posted`), "{}");
      return 0;
    },
    log: (l) => logs.push(l),
  });
  assert.ok(logs.includes("recovered n"));
  assert.equal(fs.store.get("/s/n/task.json"), taskText);
  assert.equal(fs.store.has("/s/n/pending.json"), false);
  assert.equal(drained, 1);
  assert.equal(r.summary.recovered, 1);
  assert.equal(r.summary.marked, 1);
  assert.equal(r.exitCode, 0);
  // Next run sees the posted marker only and does not post again.
  const logs2 = [];
  const r2 = sync({ queue: "/q", stateDir: "/s" }, {
    ...fs,
    remote: () => snapshot(["RUNNER alive 7", "ENTRY done n", `DIGEST done n ${th} ${ph}`]),
    drain: () => { drained += 1; return 0; },
    log: (l) => logs2.push(l),
  });
  assert.equal(r2.exitCode, 0);
  assert.equal(drained, 1);
});

test("sync: a same-name entry with different content stays held and nothing is posted", () => {
  const localTask = JSON.stringify(TASK);
  const localPrompt = "local prompt";
  const remoteTask = JSON.stringify({ ...TASK, issue: "AWAI-2" });
  const remotePrompt = "remote prompt";
  const fs = fakeFsPending({
    "/s/n/pending.json": JSON.stringify({ name: "n", taskText: localTask, taskSha256: sha256hex(localTask), promptSha256: sha256hex(localPrompt) }),
    "/e/n/task.json": localTask,
    "/e/n/muse-prompt.md": localPrompt,
  });
  const logs = [];
  const scripts = [];
  let drained = 0;
  const recText = JSON.stringify({ issue: "AWAI-1", kind: "comment", body: "x" });
  const r = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"] }, {
    ...fs,
    remote: (script) => {
      scripts.push(script);
      return snapshot(["RUNNER alive 7", "ENTRY inbox n", `DIGEST inbox n ${sha256hex(remoteTask)} ${sha256hex(remotePrompt)}`, `OUTBOX n ${REC} ${b64(recText)}`]);
    },
    drain: () => { drained += 1; return 0; },
    log: (l) => logs.push(l),
  });
  assert.equal(r.exitCode, 1);
  assert.ok(logs.includes("held n pending-mismatch"));
  assert.ok(logs.some((l) => l === `held n ${REC} pending-mismatch`));
  assert.equal(drained, 0);
  assert.equal(fs.store.has("/s/n/task.json"), false);
  assert.ok(fs.store.has("/s/n/pending.json"));
  assert.ok(!scripts.some((s) => s.includes("\nput ")), "a held entry must not be pushed");
});

test("sync: a malformed remote digest is never treated as a match", () => {
  const taskText = JSON.stringify(TASK);
  const fs = fakeFsPending({
    "/s/n/pending.json": JSON.stringify({ name: "n", taskText, taskSha256: sha256hex(taskText), promptSha256: sha256hex("p") }),
  });
  const logs = [];
  const r = sync({ queue: "/q", stateDir: "/s" }, {
    ...fs,
    remote: () => snapshot(["RUNNER none 0", "ENTRY inbox n", "DIGEST inbox n missing missing"]),
    drain: () => 0,
    log: (l) => logs.push(l),
  });
  assert.equal(r.exitCode, 1);
  assert.ok(logs.includes("held n pending-mismatch"));
  assert.equal(fs.store.has("/s/n/task.json"), false);
  assert.ok(fs.store.has("/s/n/pending.json"));
});

test("sync: a push that never arrived is pushed by the next run", () => {
  const taskText = JSON.stringify(TASK);
  const prompt = "do it";
  const th = sha256hex(taskText);
  const ph = sha256hex(prompt);
  const fs = fakeFsPending({
    "/s/n/pending.json": JSON.stringify({ name: "n", taskText, taskSha256: th, promptSha256: ph }),
    "/e/n/task.json": taskText,
    "/e/n/muse-prompt.md": prompt,
  });
  const logs = [];
  const scripts = [];
  let snapshots = 0;
  const r = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"] }, {
    ...fs,
    remote: (script) => {
      scripts.push(script);
      if (script.includes("\nput ")) return snapshot(["PUSH n ok"]);
      snapshots += 1;
      if (snapshots === 1) return snapshot(["RUNNER none 0"]);
      return snapshot(["RUNNER none 0", "ENTRY inbox n", `DIGEST inbox n ${th} ${ph}`]);
    },
    drain: () => 0,
    log: (l) => logs.push(l),
  });
  assert.ok(logs.includes("not-submitted n"));
  assert.ok(logs.some((l) => l.startsWith("pushed n ")));
  assert.equal(fs.store.get("/s/n/task.json"), taskText);
  assert.equal(fs.store.has("/s/n/pending.json"), false);
  assert.equal(r.summary.pushed, 1);
  assert.equal(r.exitCode, 0);
});

test("sync: dry-run reports reconciliation without changing pending or task", () => {
  const taskText = JSON.stringify(TASK);
  const prompt = "do it";
  const before = JSON.stringify({ name: "n", taskText, taskSha256: sha256hex(taskText), promptSha256: sha256hex(prompt) });
  const fs = fakeFsPending({
    "/s/n/pending.json": before,
    "/e/n/task.json": taskText,
    "/e/n/muse-prompt.md": prompt,
  });
  const logs = [];
  const scripts = [];
  const r = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"], dryRun: true }, {
    ...fs,
    remote: (script) => {
      scripts.push(script);
      return snapshot(["RUNNER none 0", "ENTRY inbox n", `DIGEST inbox n ${sha256hex(taskText)} ${sha256hex(prompt)}`]);
    },
    drain: () => 0,
    log: (l) => logs.push(l),
  });
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0], snapshotScript("/q"));
  assert.ok(logs.includes("would-recover n"));
  assert.equal(fs.store.get("/s/n/pending.json"), before);
  assert.equal(fs.store.has("/s/n/task.json"), false);
  assert.equal(r.exitCode, 0);
});

test("e2e: a lost acknowledgement is recovered and its record posts exactly once", (t) => {
  const s = sandbox(t);
  const dir = s.entry("10-a");
  assert.equal(s.run([dir]).status, 0);
  const taskText = readFileSync(join(s.state, "10-a", "task.json"), "utf8");
  const promptText = readFileSync(join(dir, "muse-prompt.md"), "utf8");
  writeFileSync(join(s.state, "10-a", "pending.json"), JSON.stringify({
    name: "10-a", taskText, taskSha256: sha256hex(taskText), promptSha256: sha256hex(promptText),
  }));
  rmSync(join(s.state, "10-a", "task.json"));
  const r2 = s.run([dir]);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /^recovered 10-a$/m);
  assert.ok(existsSync(join(s.state, "10-a", "task.json")));
  assert.ok(!existsSync(join(s.state, "10-a", "pending.json")));
  s.finish("10-a");
  const r3 = s.run([]);
  assert.equal(r3.status, 0, r3.stdout + r3.stderr);
  assert.match(r3.stdout, /^posted AWAI-1 comment /m);
  assert.equal(s.orcaCalls().length, 1);
  const r4 = s.run([]);
  assert.equal(r4.status, 0, r4.stdout + r4.stderr);
  assert.equal(s.orcaCalls().length, 1);
});

test("e2e: a same-name entry with different content stays held and nothing is posted", (t) => {
  const s = sandbox(t);
  const dir = s.entry("10-a");
  assert.equal(s.run([dir]).status, 0);
  const otherTask = JSON.stringify({ ...TASK, issue: "AWAI-2" });
  const otherPrompt = "different prompt";
  writeFileSync(join(dir, "task.json"), otherTask);
  writeFileSync(join(dir, "muse-prompt.md"), otherPrompt);
  writeFileSync(join(s.state, "10-a", "pending.json"), JSON.stringify({
    name: "10-a", taskText: otherTask, taskSha256: sha256hex(otherTask), promptSha256: sha256hex(otherPrompt),
  }));
  rmSync(join(s.state, "10-a", "task.json"));
  const ob = s.finish("10-a");
  const r = s.run([dir]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^held 10-a pending-mismatch$/m);
  assert.ok(!existsSync(join(s.state, "10-a", "task.json")));
  assert.deepEqual(readdirSync(ob), [REC]);
  assert.equal(s.orcaCalls().length, 0);
});

test("e2e: a push that never arrived is pushed by the next run", (t) => {
  const s = sandbox(t);
  const dir = s.entry("20-b");
  const taskText = readFileSync(join(dir, "task.json"), "utf8");
  const promptText = readFileSync(join(dir, "muse-prompt.md"), "utf8");
  mkdirSync(join(s.state, "20-b"), { recursive: true });
  writeFileSync(join(s.state, "20-b", "pending.json"), JSON.stringify({
    name: "20-b", taskText, taskSha256: sha256hex(taskText), promptSha256: sha256hex(promptText),
  }));
  const r = s.run([dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^not-submitted 20-b$/m);
  assert.match(r.stdout, /^pushed 20-b /m);
  assert.ok(existsSync(join(s.state, "20-b", "task.json")));
  assert.ok(!existsSync(join(s.state, "20-b", "pending.json")));
  assert.deepEqual(readdirSync(join(s.q, "inbox", "20-b")).sort(), ["muse-prompt.md", "ready", "task.json"]);
});

test("e2e: dry-run reports recovery without changing pending or task", (t) => {
  const s = sandbox(t);
  const dir = s.entry("10-a");
  assert.equal(s.run([dir]).status, 0);
  const taskText = readFileSync(join(s.state, "10-a", "task.json"), "utf8");
  const promptText = readFileSync(join(dir, "muse-prompt.md"), "utf8");
  const before = JSON.stringify({
    name: "10-a", taskText, taskSha256: sha256hex(taskText), promptSha256: sha256hex(promptText),
  });
  writeFileSync(join(s.state, "10-a", "pending.json"), before);
  rmSync(join(s.state, "10-a", "task.json"));
  const r = s.run(["--dry-run", dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /would-recover 10-a/m);
  assert.equal(readFileSync(join(s.state, "10-a", "pending.json"), "utf8"), before);
  assert.ok(!existsSync(join(s.state, "10-a", "task.json")));
});

// ---- review additions (AWAI-3596): cases the first test set let through ----

test("sync: an entry whose task matches but whose prompt differs is held, not recovered", () => {
  const taskText = JSON.stringify(TASK);
  const th = sha256hex(taskText);
  const ph = sha256hex("local prompt");
  const fs = fakeFsPending({ "/s/n/pending.json": JSON.stringify({ name: "n", taskText, taskSha256: th, promptSha256: ph }) });
  const logs = [];
  let drained = 0;
  const recText = JSON.stringify({ issue: TASK.issue, kind: "comment", body: "x" });
  const r = sync({ queue: "/q", stateDir: "/s" }, {
    ...fs,
    remote: () => snapshot([
      "RUNNER alive 7", "ENTRY done n", `DIGEST done n ${th} ${sha256hex("another prompt")}`,
      `OUTBOX n ${REC} ${b64(recText)}`,
    ]),
    drain: () => { drained += 1; return 0; },
    log: (l) => logs.push(l),
  });
  assert.ok(logs.includes("held n pending-mismatch"));
  assert.equal(logs.includes("recovered n"), false);
  assert.equal(fs.store.has("/s/n/task.json"), false);
  assert.ok(fs.store.has("/s/n/pending.json"));
  assert.equal(drained, 0);
  assert.equal(r.summary.recovered, 0);
  assert.equal(r.exitCode, 1);
});

test("sync: a complete answer without this entry's PUSH line keeps the intent and exits 1", () => {
  const taskText = JSON.stringify(TASK);
  const prompt = "do it";
  const fs = fakeFsPending({ "/e/n/task.json": taskText, "/e/n/muse-prompt.md": prompt });
  const logs = [];
  const r = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"] }, {
    ...fs,
    // Both answers end with END; the push answer simply has no line for "n".
    remote: () => snapshot(["RUNNER none 0"]),
    drain: () => 0,
    log: (l) => logs.push(l),
  });
  assert.ok(logs.includes("pending n no-answer"));
  assert.equal(r.summary.pending, 1);
  assert.equal(r.summary.pushed, 0);
  assert.equal(r.summary.rejected, 0);
  assert.ok(fs.store.has("/s/n/pending.json"), "an unanswered push must keep the intent");
  assert.equal(fs.store.has("/s/n/task.json"), false);
  assert.equal(r.exitCode, 1, "nothing else is wrong in this run: the pending entry alone must fail it");
  // The entry did arrive: the next run recovers it instead of pushing again.
  const scripts = [];
  const logs2 = [];
  const r2 = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"] }, {
    ...fs,
    remote: (script) => {
      scripts.push(script);
      return snapshot(["RUNNER alive 7", "ENTRY inbox n", `DIGEST inbox n ${sha256hex(taskText)} ${sha256hex(prompt)}`]);
    },
    drain: () => 0,
    log: (l) => logs2.push(l),
  });
  assert.ok(logs2.includes("recovered n"));
  assert.equal(scripts.some((s) => s.includes("\nput ")), false, "a recovered entry is not pushed again");
  assert.equal(fs.store.get("/s/n/task.json"), taskText);
  assert.equal(r2.exitCode, 0);
});

// ---- stale stage takeover (AWAI-3615) ----

test("parseRemote accepts stage entries and digests, never stage results", () => {
  const good = "b".repeat(64);
  const p = parseRemote([
    "RUNNER none 0",
    "ENTRY stage n",
    `DIGEST stage n ${good} ${good}`,
    `RESULT stage n ${b64("{}")}`,
    "END",
  ].join("\n"));
  assert.deepEqual(p.entries, [{ state: "stage", name: "n" }]);
  assert.deepEqual(p.digests, [{ state: "stage", name: "n", taskSha256: good, promptSha256: good }]);
  assert.equal(p.results.length, 0);
  assert.equal(p.malformed, 1);
});

test("sync: a stale stage with this state's own bytes is taken over by the next push", () => {
  const taskText = JSON.stringify(TASK);
  const prompt = "do it";
  const th = sha256hex(taskText);
  const ph = sha256hex(prompt);
  const fs = fakeFsPending({
    "/s/n/pending.json": JSON.stringify({ name: "n", taskText, taskSha256: th, promptSha256: ph }),
    "/e/n/task.json": taskText,
    "/e/n/muse-prompt.md": prompt,
  });
  const logs = [];
  const kinds = [];
  const r = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"] }, {
    ...fs,
    remote: (script) => {
      kinds.push(script.includes("\nput ") ? "push" : "snap");
      if (script.includes("\nput ")) return snapshot(["PUSH n ok"]);
      return snapshot(["RUNNER none 0", "ENTRY stage n", `DIGEST stage n ${th} ${ph}`]);
    },
    drain: () => 0,
    log: (l) => logs.push(l),
  });
  assert.ok(logs.includes("takeover-stage n"));
  assert.equal(r.summary.pushed, 1);
  assert.equal(r.summary.recovered, 0);
  assert.equal(fs.store.get("/s/n/task.json"), taskText);
  assert.equal(fs.store.has("/s/n/pending.json"), false);
  assert.equal(r.exitCode, 0);
});

test("sync: a stage with other bytes stays untouched and is held", () => {
  const taskText = JSON.stringify(TASK);
  const fs = fakeFsPending({
    "/s/n/pending.json": JSON.stringify({
      name: "n", taskText,
      taskSha256: sha256hex(taskText), promptSha256: sha256hex("mine"),
    }),
  });
  const logs = [];
  let pushes = 0;
  const r = sync({ queue: "/q", stateDir: "/s", owners: ["testowner"] }, {
    ...fs,
    remote: (script) => {
      if (script.includes("\nput ")) pushes += 1;
      return snapshot(["RUNNER none 0", "ENTRY stage n", `DIGEST stage n ${sha256hex(taskText)} ${sha256hex("theirs")}`]);
    },
    drain: () => 0,
    log: (l) => logs.push(l),
  });
  assert.ok(logs.includes("held n pending-mismatch"));
  assert.equal(pushes, 0);
  assert.ok(fs.store.has("/s/n/pending.json"));
  assert.equal(r.exitCode, 1);
});

test("sync: a stage with no local pending is refused and stays untouched", () => {
  const taskText = JSON.stringify(TASK);
  const fs = fakeFsPending({ "/e/n/task.json": taskText, "/e/n/muse-prompt.md": "do it" });
  const logs = [];
  const r = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"] }, {
    ...fs,
    remote: () => snapshot(["RUNNER none 0", "ENTRY stage n", `DIGEST stage n ${sha256hex(taskText)} ${sha256hex("theirs")}`]),
    drain: () => 0,
    log: (l) => logs.push(l),
  });
  // No pending.json here, so nothing is held for n; the remote refuses the name.
  const r2 = sync({ queue: "/q", stateDir: "/s", entryDirs: ["/e/n"], owners: ["testowner"] }, {
    ...fs,
    remote: (script) => (script.includes("\nput ") ? snapshot(["PUSH n exists-stage"]) : snapshot(["RUNNER none 0"])),
    drain: () => 0,
    log: (l) => logs.push(l),
  });
  assert.equal(r2.summary.rejected, 1);
  assert.ok(logs.some((l) => l === "rejected n exists-stage"));
  assert.equal(r2.exitCode, 1);
});

test("scripts: push replaces a matching stale stage and refuses a foreign one", () => {
  for (const sh of ["/bin/bash", "/opt/homebrew/bin/bash"].filter((p) => existsSync(p))) {
    const root = mkdtempSync(join(tmpdir(), "stage-takeover-"));
    try {
      const q = join(root, "q");
      mkdirSync(join(q, "inbox"), { recursive: true });
      const taskText = '{"issue":"AWAI-1"}';
      const promptText = "do it";
      // foreign stage: must stay byte-identical
      mkdirSync(join(q, "stage", "foreign"), { recursive: true });
      writeFileSync(join(q, "stage", "foreign", "task.json"), "theirs");
      writeFileSync(join(q, "stage", "foreign", "muse-prompt.md"), "theirs");
      const script = pushScript(q, [{ name: "mine", taskText, promptText }, { name: "foreign", taskText: "theirs", promptText: "theirs-x" }]);
      const r = spawnSync(sh, ["-s"], { input: script, encoding: "utf8" });
      assert.equal(r.status, 0, `${sh}: ${r.stderr}`);
      assert.match(r.stdout, /^PUSH mine ok$/m, sh);
      assert.match(r.stdout, /^PUSH foreign exists-stage$/m, sh);
      assert.deepEqual(readdirSync(join(q, "inbox", "mine")).sort(), ["muse-prompt.md", "ready", "task.json"]);
      assert.equal(readFileSync(join(q, "stage", "foreign", "task.json"), "utf8"), "theirs");
      assert.equal(readFileSync(join(q, "stage", "foreign", "muse-prompt.md"), "utf8"), "theirs");
      // matching stale stage: replaced in place, entry reaches the inbox
      mkdirSync(join(q, "stage", "mine2"), { recursive: true });
      writeFileSync(join(q, "stage", "mine2", "task.json"), taskText);
      writeFileSync(join(q, "stage", "mine2", "muse-prompt.md"), promptText);
      const script2 = pushScript(q, [{ name: "mine2", taskText, promptText }]);
      const r2 = spawnSync(sh, ["-s"], { input: script2, encoding: "utf8" });
      assert.equal(r2.status, 0, `${sh}: ${r2.stderr}`);
      assert.match(r2.stdout, /^PUSH mine2 ok$/m, sh);
      assert.deepEqual(readdirSync(join(q, "inbox", "mine2")).sort(), ["muse-prompt.md", "ready", "task.json"]);
      assert.equal(existsSync(join(q, "stage", "mine2")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("scripts: push, snapshot and mark are plain bash that parses under bash 3.2 and 5", () => {
  const shells = ["/bin/bash", "/opt/homebrew/bin/bash"].filter((p) => existsSync(p));
  assert.ok(shells.length > 0, "no bash found");
  for (const sh of shells) {
    for (const script of [pushScript("/q", [{ name: "n", taskText: "{}", promptText: "p" }]), snapshotScript("/q"), markScript("/q", [{ name: "n", file: REC }])]) {
      const r = spawnSync(sh, ["-n"], { input: script, encoding: "utf8" });
      assert.equal(r.status, 0, `${sh}: ${r.stderr}`);
    }
  }
});

for (const sh of ["/bin/bash", "/opt/homebrew/bin/bash"].filter((p) => existsSync(p))) {
  test(`e2e (${sh}): a stale stage with this state's own bytes is replaced and reaches the inbox`, (t) => {
    const s = sandbox(t);
    const dir = s.entry("30-c");
    const taskText = readFileSync(join(dir, "task.json"), "utf8");
    const promptText = readFileSync(join(dir, "muse-prompt.md"), "utf8");
    mkdirSync(join(s.state, "30-c"), { recursive: true });
    writeFileSync(join(s.state, "30-c", "pending.json"), JSON.stringify({
      name: "30-c", taskText,
      taskSha256: sha256hex(taskText), promptSha256: sha256hex(promptText),
    }));
    mkdirSync(join(s.q, "stage", "30-c"), { recursive: true });
    writeFileSync(join(s.q, "stage", "30-c", "task.json"), taskText);
    writeFileSync(join(s.q, "stage", "30-c", "muse-prompt.md"), promptText);
    const r = s.run([dir], { DEV_BOTS_REMOTE_SHELL: `${sh} -s` });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^takeover-stage 30-c$/m);
    assert.match(r.stdout, /^pushed 30-c /m);
    assert.deepEqual(readdirSync(join(s.q, "inbox", "30-c")).sort(), ["muse-prompt.md", "ready", "task.json"]);
    assert.equal(existsSync(join(s.q, "stage", "30-c")), false);
    assert.equal(existsSync(join(s.state, "30-c", "pending.json")), false);
  });

  test(`e2e (${sh}): a stage with other bytes stays untouched and the run is held`, (t) => {
    const s = sandbox(t);
    const dir = s.entry("30-c");
    const taskText = readFileSync(join(dir, "task.json"), "utf8");
    mkdirSync(join(s.state, "30-c"), { recursive: true });
    writeFileSync(join(s.state, "30-c", "pending.json"), JSON.stringify({
      name: "30-c", taskText,
      taskSha256: sha256hex(taskText), promptSha256: sha256hex("# prompt with 'quotes' and $(nothing)\n"),
    }));
    mkdirSync(join(s.q, "stage", "30-c"), { recursive: true });
    writeFileSync(join(s.q, "stage", "30-c", "task.json"), taskText);
    writeFileSync(join(s.q, "stage", "30-c", "muse-prompt.md"), "someone else");
    const before = readdirSync(join(s.q, "stage", "30-c")).sort();
    const r = s.run([], { DEV_BOTS_REMOTE_SHELL: `${sh} -s` });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^held 30-c pending-mismatch$/m);
    assert.deepEqual(readdirSync(join(s.q, "stage", "30-c")).sort(), before);
    assert.equal(readFileSync(join(s.q, "stage", "30-c", "muse-prompt.md"), "utf8"), "someone else");
    assert.ok(existsSync(join(s.state, "30-c", "pending.json")));
  });

  test(`e2e (${sh}): a stage with no local pending is refused and stays untouched`, (t) => {
    const s = sandbox(t);
    const dir = s.entry("30-c");
    mkdirSync(join(s.q, "stage", "30-c"), { recursive: true });
    writeFileSync(join(s.q, "stage", "30-c", "task.json"), "stale");
    const r = s.run([dir], { DEV_BOTS_REMOTE_SHELL: `${sh} -s` });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^rejected 30-c exists-stage$/m);
    assert.equal(readFileSync(join(s.q, "stage", "30-c", "task.json"), "utf8"), "stale");
    assert.equal(existsSync(join(s.q, "inbox", "30-c")), false);
  });
}
