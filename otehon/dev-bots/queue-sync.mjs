// Feed a remote queue (queue-runner.sh) and bring its Linear records home.
//
//   DEV_BOTS_REMOTE_SHELL='<command that runs the bash script on its stdin on the queue host>' \
//     node queue-sync.mjs --queue <remote-queue-dir> --state <local-dir>
//       [--owners <csv>] [--dry-run] [entry-dir ...]
//
// One run does three things, in this order:
//   1. push    each <entry-dir> (task.json + muse-prompt.md, named by its
//              directory) is validated here, then written to the remote
//              inbox/<name>/ with its "ready" marker. A name that already
//              exists anywhere in the remote queue is refused.
//   2. collect result.json files and unposted Linear outbox records are copied
//              into <local-dir>/<name>/, the records are posted with
//              drain-outbox, and posted records are renamed to *.posted on the
//              remote side as well.
//   3. report  runner state and one line per entry.
//
// The remote host is only reached through DEV_BOTS_REMOTE_SHELL (run with
// bash -c, script on stdin), so adb, ssh or a local "bash -s" all work, and
// the remote side needs only bash, coreutils and base64. Everything the
// remote prints is treated as data: names are checked before they become
// local paths, and a record is posted only for an entry this state directory
// pushed, to the issue that entry was pushed with.
//
// sync() takes every side effect as an injected dependency. Importing this
// file runs nothing.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NAME_RE, parseOwners, parseTask, validateEntry } from "./queue.mjs";
import { main as drainMain } from "./drain-outbox.mjs";

export const RECORD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}-(comment|status)\.json$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const HEX_RE = /^[0-9a-f]{64}$/;
const STATES = ["inbox", "running", "done", "failed"];
const MAX_RECORD_BYTES = 1048576;

/** SHA-256 hex of UTF-8 text, matching `sha256sum` of the file bytes. */
export function sha256hex(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

/** Single-quote a value for a POSIX shell. */
export function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function b64(text) {
  return Buffer.from(String(text), "utf8").toString("base64");
}

function unb64(text) {
  return Buffer.from(text, "base64").toString("utf8");
}

/** Remote paths are absolute and free of characters that need more than quoting. */
export function validateQueuePath(path) {
  return typeof path === "string" && /^\/[A-Za-z0-9._/-]{1,200}$/.test(path) && !path.includes("..");
}

const HEADER = (queue) => `set -u\nQ=${shq(queue)}\nif [ ! -d "$Q/inbox" ]; then echo "ERR no-queue"; echo END; exit 0; fi\n`;

/** Script that writes entries into the remote inbox. */
export function pushScript(queue, entries) {
  const lines = [
    HEADER(queue),
    "put() {",
    "  n=$1",
    "  for d in stage inbox running done failed work; do",
    '    if [ -e "$Q/$d/$n" ]; then echo "PUSH $n exists-$d"; return; fi',
    "  done",
    '  s="$Q/stage/$n"',
    '  if ! mkdir -p "$Q/stage" || ! mkdir "$s"; then echo "PUSH $n write-failed"; return; fi',
    '  if printf %s "$2" | base64 -d > "$s/task.json" && printf %s "$3" | base64 -d > "$s/muse-prompt.md" \\',
    '     && : > "$s/ready" && mv "$s" "$Q/inbox/$n"; then',
    '    echo "PUSH $n ok"',
    "  else",
    '    rm -f "$s/task.json" "$s/muse-prompt.md" "$s/ready"; rmdir "$s" 2>/dev/null',
    '    echo "PUSH $n write-failed"',
    "  fi",
    "}",
  ];
  for (const e of entries) {
    lines.push(`put ${shq(e.name)} ${shq(b64(e.taskText))} ${shq(b64(e.promptText))}`);
  }
  lines.push("echo END", "");
  return lines.join("\n");
}

/** Read-only script that prints runner state, entries, results and unposted records. */
export function snapshotScript(queue) {
  return [
    HEADER(queue),
    "hash_file() {",
    '  f="$1"',
    '  if [ ! -f "$f" ]; then echo missing; return; fi',
    "  if command -v sha256sum >/dev/null 2>&1; then",
    '    sha256sum "$f" | cut -d \' \' -f 1',
    "  else",
    '    shasum -a 256 "$f" | cut -d \' \' -f 1',
    "  fi",
    "}",
    'pid=$(cat "$Q/runner.lock" 2>/dev/null || true)',
    "case $pid in",
    "  ''|*[!0-9]*) echo \"RUNNER none 0\";;",
    '  *) if kill -0 "$pid" 2>/dev/null; then echo "RUNNER alive $pid"; else echo "RUNNER dead $pid"; fi;;',
    "esac",
    'if [ -e "$Q/stop" ]; then echo "STOP"; fi',
    `for d in ${STATES.join(" ")}; do`,
    '  for e in "$Q/$d"/*/; do',
    '    [ -d "$e" ] || continue',
    '    n=$(basename "$e")',
    '    echo "ENTRY $d $n"',
    '    th=$(hash_file "$e/task.json")',
    '    ph=$(hash_file "$e/muse-prompt.md")',
    '    echo "DIGEST $d $n $th $ph"',
    '    if [ -f "$e/result.json" ] && [ "$(wc -c < "$e/result.json")" -le 65536 ]; then',
    '      echo "RESULT $d $n $(base64 < "$e/result.json" | tr -d \'\\n\')"',
    "    fi",
    "  done",
    "done",
    'for f in "$Q"/work/*/.agent-output/linear-outbox/*.json; do',
    '  [ -f "$f" ] || continue',
    '  n=$(basename "$(dirname "$(dirname "$(dirname "$f")")")")',
    `  if [ "$(wc -c < "$f")" -gt ${MAX_RECORD_BYTES} ]; then echo "TOOBIG $n $(basename "$f")"; continue; fi`,
    '  echo "OUTBOX $n $(basename "$f") $(base64 < "$f" | tr -d \'\\n\')"',
    "done",
    "echo END",
    "",
  ].join("\n");
}

/** Script that renames posted records to *.posted on the remote side. */
export function markScript(queue, marks) {
  const lines = [
    HEADER(queue),
    "mark() {",
    '  p="$Q/work/$1/.agent-output/linear-outbox/$2"',
    '  if [ -f "$p" ]; then',
    '    if mv "$p" "$p.posted"; then echo "MARK $1 $2 ok"; else echo "MARK $1 $2 failed"; fi',
    '  elif [ -f "$p.posted" ]; then echo "MARK $1 $2 ok"',
    '  else echo "MARK $1 $2 missing"; fi',
    "}",
  ];
  for (const m of marks) lines.push(`mark ${shq(m.name)} ${shq(m.file)}`);
  lines.push("echo END", "");
  return lines.join("\n");
}

/**
 * Parse what a remote script printed. Unknown or malformed lines are counted,
 * never trusted. `complete` is false when the END marker is missing (a cut
 * connection), in which case the caller must not act on the content.
 */
export function parseRemote(stdout) {
  const out = {
    complete: false,
    error: null,
    runner: { state: "unknown", pid: 0 },
    stop: false,
    entries: [],
    digests: [],
    results: [],
    outbox: [],
    tooBig: [],
    pushes: [],
    marks: [],
    malformed: 0,
  };
  for (const raw of String(stdout ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === "") continue;
    if (line === "END") {
      out.complete = true;
      continue;
    }
    const f = line.split(" ");
    const okName = (n) => typeof n === "string" && NAME_RE.test(n);
    if (f[0] === "ERR" && f.length === 2 && /^[a-z-]{1,40}$/.test(f[1])) out.error = f[1];
    else if (f[0] === "RUNNER" && f.length === 3 && /^(alive|dead|none)$/.test(f[1]) && /^[0-9]{1,10}$/.test(f[2])) {
      out.runner = { state: f[1], pid: Number(f[2]) };
    } else if (line === "STOP") out.stop = true;
    else if (f[0] === "ENTRY" && f.length === 3 && STATES.includes(f[1]) && okName(f[2])) {
      out.entries.push({ state: f[1], name: f[2] });
    } else if (f[0] === "DIGEST" && f.length === 5 && STATES.includes(f[1]) && okName(f[2])) {
      const taskHex = HEX_RE.test(f[3]) ? f[3] : null;
      const promptHex = HEX_RE.test(f[4]) ? f[4] : null;
      out.digests.push({ state: f[1], name: f[2], taskSha256: taskHex, promptSha256: promptHex });
    } else if (f[0] === "RESULT" && f.length === 4 && STATES.includes(f[1]) && okName(f[2]) && B64_RE.test(f[3])) {
      out.results.push({ state: f[1], name: f[2], text: unb64(f[3]) });
    } else if (f[0] === "OUTBOX" && f.length === 4 && okName(f[1]) && RECORD_RE.test(f[2]) && B64_RE.test(f[3])) {
      out.outbox.push({ name: f[1], file: f[2], text: unb64(f[3]) });
    } else if (f[0] === "TOOBIG" && f.length === 3 && okName(f[1]) && RECORD_RE.test(f[2])) {
      out.tooBig.push({ name: f[1], file: f[2] });
    } else if (f[0] === "PUSH" && f.length === 3 && okName(f[1]) && /^[a-z-]{1,40}$/.test(f[2])) {
      out.pushes.push({ name: f[1], result: f[2] });
    } else if (f[0] === "MARK" && f.length === 4 && okName(f[1]) && RECORD_RE.test(f[2]) && /^(ok|failed|missing)$/.test(f[3])) {
      out.marks.push({ name: f[1], file: f[2], result: f[3] });
    } else out.malformed += 1;
  }
  return out;
}

/** Text safe for one log line: no control characters, bounded length. */
function clean(value, max = 120) {
  return String(value ?? "").replace(/[^\x20-\x7e]/g, "?").slice(0, max);
}

/** One status line for an entry; result.json is remote data, so only known fields are shown. */
export function describeEntry(entry, resultText) {
  let detail = "";
  if (typeof resultText === "string") {
    try {
      const r = JSON.parse(resultText);
      const parts = [];
      if (typeof r?.issue === "string") parts.push(clean(r.issue, 30));
      if (typeof r?.reason === "string") parts.push(clean(r.reason, 60));
      const d = r?.deliver;
      if (d && typeof d === "object") {
        if (typeof d.decision?.action === "string") parts.push(clean(d.decision.action, 30));
        if (typeof d.pr === "string") parts.push(`pr=${clean(d.pr, 100)}`);
        parts.push(d.merged && typeof d.merged === "object" ? "merged" : "not-merged");
      }
      detail = parts.join(" ");
    } catch {
      detail = "unreadable-result";
    }
  }
  return `entry ${entry.state} ${entry.name}${detail ? ` ${detail}` : ""}`;
}

/**
 * @param {{queue: string, stateDir: string, entryDirs?: string[], owners?: string[], dryRun?: boolean}} opts
 * @param deps remote(script) -> {status, stdout, stderr?}; readFile(path) -> string;
 *   writeFile(path, text); exists(path) -> boolean; mkdirp(path); listDir(path) -> string[];
 *   drain(dir, dryRun) -> exit code; log(line).
 * @returns {{summary: object, exitCode: number}}
 */
export function sync({ queue, stateDir, entryDirs = [], owners = [], dryRun = false } = {}, deps = {}) {
  const need = (name) => () => { throw new Error(`queue-sync: no ${name}`); };
  const {
    remote = need("remote"),
    readFile = need("readFile"),
    writeFile = need("writeFile"),
    exists = need("exists"),
    mkdirp = need("mkdirp"),
    listDir = need("listDir"),
    drain = need("drain"),
    log = () => {},
    remove = () => {},
  } = deps;
  const summary = {
    pushed: 0, rejected: 0, collected: 0, held: 0, drainFailed: 0, marked: 0, markFailed: 0,
    recovered: 0, pending: 0,
    runner: "unknown", dryRun,
  };
  const finish = (fatal) => {
    if (fatal) log(`error ${fatal}`);
    log(JSON.stringify(summary));
    const bad = fatal || summary.rejected || summary.held || summary.pending || summary.drainFailed || summary.markFailed;
    return { summary, exitCode: bad ? 1 : 0 };
  };
  const call = (script) => {
    let r;
    try {
      r = remote(script);
    } catch (e) {
      return { fatal: `remote failed: ${clean(e?.message ?? e)}` };
    }
    if (!r || r.status !== 0) return { fatal: `remote failed: exit ${clean(r?.status)} ${clean(r?.stderr)}`.trim() };
    const parsed = parseRemote(r.stdout);
    if (!parsed.complete) return { fatal: "remote output was cut short" };
    if (parsed.error) return { fatal: `remote: ${parsed.error}` };
    return { parsed };
  };
  const pendingPath = (name) => join(stateDir, name, "pending.json");
  const taskPath = (name) => join(stateDir, name, "task.json");
  const safeRemove = (p) => { try { remove(p); } catch { /* keep pending on remove failure */ } };
  const writePending = (e) => {
    mkdirp(join(stateDir, e.name));
    writeFile(pendingPath(e.name), JSON.stringify({
      name: e.name, taskText: e.taskText,
      taskSha256: sha256hex(e.taskText), promptSha256: sha256hex(e.promptText),
    }));
  };
  const getLocalPendings = () => {
    let names = [];
    try { names = listDir(stateDir); } catch { names = []; }
    const out = [];
    for (const n of names) {
      if (typeof n !== "string" || !NAME_RE.test(n)) continue;
      let hasPending = false;
      try { hasPending = exists(pendingPath(n)); } catch { hasPending = false; }
      if (!hasPending) continue;
      let hasTask = false;
      try { hasTask = exists(taskPath(n)); } catch { hasTask = false; }
      if (hasTask) continue; // already pushed: task.json governs, not the pending file
      let parsed = null;
      let malformed = false;
      try { parsed = JSON.parse(readFile(pendingPath(n))); } catch { parsed = null; }
      if (!parsed || typeof parsed.taskText !== "string" || !HEX_RE.test(parsed.taskSha256 ?? "") || !HEX_RE.test(parsed.promptSha256 ?? "")) {
        malformed = true;
      }
      out.push({ name: n, pending: parsed, malformed });
    }
    return out;
  };
  // Reconcile local pending.json files against one snapshot. When mutate is
  // false nothing under pending.json/task.json changes; held entries are still
  // reported (keeping them held needs no write). Returns recovered/blocked names.
  const reconcile = (parsed, { mutate }) => {
    const entryNames = new Set(parsed.entries.map((e) => e.name));
    const byName = new Map();
    for (const d of parsed.digests ?? []) {
      if (!byName.has(d.name)) byName.set(d.name, []);
      byName.get(d.name).push(d);
    }
    const recovered = new Set();
    const blocked = new Set();
    for (const { name, pending, malformed } of localPendings) {
      if (malformed) {
        summary.held += 1;
        log(`held ${name} bad-pending`);
        blocked.add(name);
        continue;
      }
      if (!entryNames.has(name)) {
        if (mutate) {
          safeRemove(pendingPath(name));
          log(`not-submitted ${name}`);
        } else {
          log(`would-submit ${name} not-submitted`);
        }
        continue;
      }
      const list = byName.get(name) ?? [];
      const match = list.some((d) => d.taskSha256 !== null && d.promptSha256 !== null
        && d.taskSha256 === pending.taskSha256 && d.promptSha256 === pending.promptSha256);
      if (match) {
        if (mutate) {
          mkdirp(join(stateDir, name));
          writeFile(taskPath(name), pending.taskText);
          safeRemove(pendingPath(name));
          summary.recovered += 1;
          log(`recovered ${name}`);
        } else {
          log(`would-recover ${name}`);
        }
        recovered.add(name);
      } else {
        summary.held += 1;
        log(`held ${name} pending-mismatch`);
        blocked.add(name);
      }
    }
    return { recovered, blocked };
  };
  const validateAll = () => {
    const valid = [];
    const seen = new Set();
    for (const dir of entryDirs) {
      const name = basename(resolve(dir));
      let taskText = null;
      let promptText = null;
      try { taskText = readFile(join(dir, "task.json")); } catch { taskText = null; }
      try { promptText = readFile(join(dir, "muse-prompt.md")); } catch { promptText = null; }
      let v = validateEntry({
        name, taskText, promptExists: promptText !== null, promptNonEmpty: Boolean(promptText && promptText.length > 0), owners,
      });
      if (v.ok && seen.has(name)) v = { ok: false, reason: "duplicate-name" };
      // A pending-only entry is not already-pushed: it goes through
      // reconciliation. An entry with task.json still is.
      if (v.ok && exists(taskPath(name))) v = { ok: false, reason: "already-pushed" };
      if (!v.ok) {
        summary.rejected += 1;
        log(`rejected ${clean(name)} ${v.reason}`);
        continue;
      }
      seen.add(name);
      valid.push({ name, taskText, promptText, task: v.task });
    }
    return valid;
  };
  const handlePushResults = (valid, parsed) => {
    const byName = new Map(parsed.pushes.map((p) => [p.name, p.result]));
    for (const e of valid) {
      const result = byName.get(e.name) ?? "no-answer";
      if (result === "ok") {
        // The local task.json is what later ties this entry's records to its issue.
        mkdirp(join(stateDir, e.name));
        writeFile(taskPath(e.name), e.taskText);
        safeRemove(pendingPath(e.name));
        summary.pushed += 1;
        log(`pushed ${e.name} ${e.task.issue} ${e.task.repo}`);
      } else if (result.startsWith("exists-") || result === "write-failed") {
        safeRemove(pendingPath(e.name));
        summary.rejected += 1;
        log(`rejected ${e.name} ${result}`);
      } else {
        summary.pending += 1;
        log(`pending ${e.name} ${result}`);
      }
    }
  };
  const doCollect = (s, blocked) => {
    summary.runner = s.runner.state;
    const marks = [];
    const drainDirs = new Map(); // local outbox dir -> [{name, file}] seen pending on the remote
    for (const t of s.tooBig) {
      summary.held += 1;
      log(`held ${t.name} ${t.file} too-big`);
    }
    for (const rec of s.outbox) {
      if (blocked.has(rec.name)) {
        summary.held += 1;
        log(`held ${rec.name} ${rec.file} pending-mismatch`);
        continue;
      }
      const dir = join(stateDir, rec.name, "linear-outbox");
      if (exists(join(dir, `${rec.file}.posted`))) {
        marks.push({ name: rec.name, file: rec.file }); // posted earlier; only the remote mark is missing
        continue;
      }
      let pushedIssue = null;
      try {
        const p = parseTask(readFile(taskPath(rec.name)));
        if (p.ok) pushedIssue = p.task.issue;
      } catch {
        pushedIssue = null;
      }
      let recordIssue = null;
      try { recordIssue = JSON.parse(rec.text)?.issue ?? null; } catch { recordIssue = null; }
      if (pushedIssue === null || recordIssue !== pushedIssue) {
        summary.held += 1;
        log(`held ${rec.name} ${rec.file} ${pushedIssue === null ? "entry-not-pushed-from-here" : "issue-mismatch"}`);
        continue;
      }
      mkdirp(dir);
      writeFile(join(dir, rec.file), rec.text);
      summary.collected += 1;
      if (!drainDirs.has(dir)) drainDirs.set(dir, []);
      drainDirs.get(dir).push({ name: rec.name, file: rec.file });
    }
    for (const r of s.results) {
      if (!exists(join(stateDir, r.name))) continue; // only for entries pushed from here
      writeFile(join(stateDir, r.name, "result.json"), r.text);
    }
    for (const [dir, records] of drainDirs) {
      let code;
      try { code = drain(dir, dryRun); } catch { code = 1; }
      if (code !== 0) summary.drainFailed += 1;
      let names = [];
      try { names = listDir(dir); } catch { names = []; }
      for (const rec of records) {
        if (names.includes(`${rec.file}.posted`)) marks.push(rec);
      }
    }
    return marks;
  };
  const doMark = (marks) => {
    if (marks.length === 0 || dryRun) return null;
    const r = call(markScript(queue, marks));
    if (r.fatal) {
      summary.markFailed += marks.length;
      return `${r.fatal} (records are posted; the next run only repeats the remote mark)`;
    }
    const byKey = new Map(r.parsed.marks.map((m) => [`${m.name}/${m.file}`, m.result]));
    for (const m of marks) {
      const result = byKey.get(`${m.name}/${m.file}`) ?? "no-answer";
      if (result === "ok") summary.marked += 1;
      else {
        summary.markFailed += 1;
        log(`mark-failed ${m.name} ${m.file} ${result}`);
      }
    }
    return null;
  };
  const doReport = (s) => {
    log(`runner ${s.runner.state}${s.runner.state === "alive" ? ` pid=${s.runner.pid}` : ""}${s.stop ? " stop-requested" : ""}`);
    if (s.runner.state !== "alive") log("warning: no runner is working on this queue");
    const resultOf = new Map(s.results.map((r) => [`${r.state}/${r.name}`, r.text]));
    for (const e of s.entries) log(describeEntry(e, resultOf.get(`${e.state}/${e.name}`)));
    if (s.malformed > 0) log(`warning: ${s.malformed} remote line(s) ignored`);
  };

  const localPendings = getLocalPendings();
  const validAll = validateAll();

  if (dryRun) {
    const snap = call(snapshotScript(queue));
    if (snap.fatal) return finish(snap.fatal);
    const { recovered, blocked } = reconcile(snap.parsed, { mutate: false });
    const toPush = validAll.filter((e) => !blocked.has(e.name) && !recovered.has(e.name));
    for (const e of toPush) log(`would-push ${e.name} ${e.task.issue} ${e.task.repo}`);
    const marks = doCollect(snap.parsed, blocked);
    void marks;
    doReport(snap.parsed);
    return finish(null);
  }

  if (localPendings.length === 0) {
    // 1. push (persist the intent first so a lost acknowledgement can be recovered)
    if (validAll.length > 0) {
      for (const e of validAll) writePending(e);
      const r = call(pushScript(queue, validAll));
      if (r.fatal) {
        for (const e of validAll) {
          summary.pending += 1;
          log(`pending ${e.name} unconfirmed`);
        }
        return finish(r.fatal);
      }
      handlePushResults(validAll, r.parsed);
    }
    // 2. collect
    const snap = call(snapshotScript(queue));
    if (snap.fatal) return finish(snap.fatal);
    const marks = doCollect(snap.parsed, new Set());
    const markFatal = doMark(marks);
    if (markFatal) return finish(markFatal);
    // 3. report
    doReport(snap.parsed);
    return finish(null);
  }

  // Later run with outstanding intents: reconcile before pushing.
  const snap1 = call(snapshotScript(queue));
  if (snap1.fatal) return finish(snap1.fatal);
  const { recovered, blocked } = reconcile(snap1.parsed, { mutate: true });
  const toPush = validAll.filter((e) => !blocked.has(e.name) && !recovered.has(e.name));
  for (const e of toPush) writePending(e);
  if (toPush.length > 0) {
    const r = call(pushScript(queue, toPush));
    if (r.fatal) {
      for (const e of toPush) {
        summary.pending += 1;
        log(`pending ${e.name} unconfirmed`);
      }
      return finish(r.fatal);
    }
    handlePushResults(toPush, r.parsed);
  }
  // 2. collect (fresh snapshot when the push changed the remote)
  let s = snap1.parsed;
  if (toPush.length > 0) {
    const snap2 = call(snapshotScript(queue));
    if (snap2.fatal) return finish(snap2.fatal);
    s = snap2.parsed;
  }
  const marks = doCollect(s, blocked);
  const markFatal = doMark(marks);
  if (markFatal) return finish(markFatal);
  // 3. report
  doReport(s);
  return finish(null);
}

function usage() {
  return [
    "usage: DEV_BOTS_REMOTE_SHELL=<command> node queue-sync.mjs --queue <remote-queue-dir> --state <local-dir>",
    "         [--owners <csv>] [--dry-run] [entry-dir ...]",
  ].join("\n");
}

export function main(argv, env = process.env) {
  const opt = { queue: null, stateDir: null, owners: env.DEV_BOTS_ALLOWED_OWNERS ?? "", dryRun: false, entryDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--queue") opt.queue = argv[++i] ?? null;
    else if (a === "--state") opt.stateDir = argv[++i] ?? null;
    else if (a === "--owners") opt.owners = argv[++i] ?? "";
    else if (a === "--dry-run") opt.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(usage());
      return 0;
    } else if (a.startsWith("-")) {
      console.error(usage());
      return 2;
    } else opt.entryDirs.push(a);
  }
  const shell = env.DEV_BOTS_REMOTE_SHELL ?? "";
  const owners = parseOwners(opt.owners);
  if (opt.queue === null || opt.stateDir === null) {
    console.error(usage());
    return 2;
  }
  if (!validateQueuePath(opt.queue)) {
    console.error("queue-sync: --queue must be an absolute path of letters, digits, . _ - and /");
    return 2;
  }
  if (shell.trim() === "") {
    console.error("queue-sync: DEV_BOTS_REMOTE_SHELL is empty or unset; refusing to guess a host");
    return 2;
  }
  if (opt.entryDirs.length > 0 && owners.length === 0) {
    console.error("queue-sync: entries need --owners or DEV_BOTS_ALLOWED_OWNERS (no default allowlist)");
    return 2;
  }
  let isDir = false;
  try { isDir = statSync(opt.stateDir).isDirectory(); } catch { isDir = false; }
  if (!isDir) {
    console.error(`queue-sync: --state is not a directory: ${opt.stateDir}`);
    return 2;
  }
  const { exitCode } = sync(
    { queue: opt.queue, stateDir: opt.stateDir, entryDirs: opt.entryDirs, owners, dryRun: opt.dryRun },
    {
      remote: (script) => spawnSync("bash", ["-c", shell], {
        input: script, encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024,
      }),
      readFile: (p) => readFileSync(p, "utf8"),
      writeFile: (p, text) => writeFileSync(p, text),
      exists: (p) => existsSync(p),
      mkdirp: (p) => mkdirSync(p, { recursive: true }),
      listDir: (p) => readdirSync(p),
      remove: (p) => rmSync(p, { force: true }),
      drain: (dir, dryRun) => drainMain(dryRun ? [dir, "--dry-run"] : [dir]),
      log: (line) => console.log(line),
    },
  );
  return exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`queue-sync: ${clean(e?.message ?? e, 200)}`);
    process.exitCode = 1;
  }
}
