// Drain a Linear outbox written by runner-env.mjs recordLinearEntry().
//
// Hosts without orca (DEV_BOTS_LINEAR=outbox) only write one JSON file per
// Linear entry under <task>/.agent-output/linear-outbox/. This command posts
// those files from a host that has orca, exactly once: a successfully posted
// record is renamed to <name>.posted in the same directory and never posted
// again.
//
// Usage: node drain-outbox.mjs <outbox-dir> [--dry-run]
//
// The core drainOutbox() takes every side effect as an injected dependency so
// tests never spawn orca or touch a real outbox. Importing this file runs
// nothing; only running it as a CLI wires the real fs and spawnSync("orca").
import { readdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_RE = /^[A-Z][A-Z0-9]*-[0-9]+$/;

/**
 * Validate one parsed outbox record before any transport call.
 * @returns {{ok: boolean, reason?: string}} reason never contains the body.
 */
export function validateRecord(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, reason: "record must be a JSON object" };
  }
  if (typeof record.issue !== "string" || !ISSUE_RE.test(record.issue)) {
    return { ok: false, reason: "issue must match ^[A-Z][A-Z0-9]*-[0-9]+$" };
  }
  if (record.kind !== "comment" && record.kind !== "status") {
    return { ok: false, reason: 'kind must be "comment" or "status"' };
  }
  if (record.kind === "comment") {
    if (typeof record.body !== "string" || record.body.length === 0) {
      return { ok: false, reason: "comment needs a non-empty string body" };
    }
  } else if (typeof record.to !== "string" || record.to.length === 0 || record.to.startsWith("-")) {
    return { ok: false, reason: 'status needs a non-empty string "to" without a leading "-"' };
  }
  return { ok: true };
}

function errorText(value) {
  return String(value?.message ?? value).slice(0, 200);
}

/**
 * Post every *-comment.json / *-status.json record in dir, oldest first.
 *
 * @param {{dir: string, dryRun?: boolean}} opts
 * @param deps every side effect, all injected:
 *   listDir(dir) -> string[], readFile(path) -> string,
 *   writeFile(path, text), removeFile(path), tempFile() -> path,
 *   rename(oldPath, newPath), runOrca(args[]) -> {status, stderr?},
 *   log(line). Lines and the final summary go through log (stdout on the CLI).
 * @returns {{summary: {posted, failed, invalid, skipped, dryRun}, exitCode: number}}
 */
export function drainOutbox({ dir, dryRun = false } = {}, deps = {}) {
  const {
    listDir = () => { throw new Error("drainOutbox: no listDir"); },
    readFile = () => { throw new Error("drainOutbox: no readFile"); },
    writeFile = () => { throw new Error("drainOutbox: no writeFile"); },
    removeFile = () => {},
    tempFile = () => { throw new Error("drainOutbox: no tempFile"); },
    rename = () => { throw new Error("drainOutbox: no rename"); },
    runOrca = () => { throw new Error("drainOutbox: no runOrca"); },
    log = () => {},
  } = deps;
  const dry = dryRun === true;
  const summary = { posted: 0, failed: 0, invalid: 0, skipped: 0, dryRun: dry };

  let names;
  try {
    names = listDir(dir);
  } catch (e) {
    if (e?.code === "ENOENT") {
      // A missing outbox directory is a clean no-op, not an error.
      log(JSON.stringify(summary));
      return { summary, exitCode: 0 };
    }
    throw e;
  }
  // Ascending file-name order is time order (recordLinearEntry stamps names).
  // .posted markers never match these suffixes, so they are never re-posted.
  const files = names
    .filter((n) => n.endsWith("-comment.json") || n.endsWith("-status.json"))
    .sort();
  const blocked = new Set();

  const fail = (issue, kind, name, detail) => {
    summary.failed += 1;
    blocked.add(issue);
    log(`failed ${issue} ${kind} ${name}: ${detail}`);
  };

  for (const name of files) {
    const path = `${dir}/${name}`;
    let text;
    try {
      text = readFile(path);
    } catch (e) {
      summary.invalid += 1;
      log(`invalid ${name}: cannot read file: ${errorText(e)}`);
      continue;
    }
    let record;
    try {
      record = JSON.parse(text);
    } catch (e) {
      summary.invalid += 1;
      log(`invalid ${name}: unparseable JSON: ${errorText(e)}`);
      continue;
    }
    const valid = validateRecord(record);
    if (!valid.ok) {
      summary.invalid += 1;
      log(`invalid ${name}: ${valid.reason}`);
      if (record !== null && typeof record === "object" && typeof record.issue === "string" && record.issue.length > 0) {
        blocked.add(record.issue);
      }
      continue;
    }
    const { issue, kind } = record;
    if (blocked.has(issue)) {
      summary.skipped += 1;
      log(`skipped ${issue} ${kind} ${name}: earlier record for this issue failed`);
      continue;
    }
    if (dry) {
      summary.posted += 1;
      log(`would-post ${issue} ${kind} ${name}`);
      continue;
    }
    // Same orca arguments as recordLinearEntry. A comment is posted from its
    // embedded body staged to a temporary file; record.bodyFile is a path on
    // another machine and is never trusted. Issue and state travel as
    // separate argv entries (no shell).
    let args;
    let tmp = null;
    if (kind === "comment") {
      try {
        tmp = tempFile();
        writeFile(tmp, record.body);
      } catch (e) {
        fail(issue, kind, name, `cannot stage body file: ${errorText(e)}`);
        continue;
      }
      args = ["linear", "comment", "add", issue, "--body-file", tmp];
    } else {
      args = ["linear", "status", "set", issue, "--to", record.to];
    }
    let result;
    try {
      result = runOrca(args);
    } catch (e) {
      result = { status: 1, stderr: errorText(e) };
    } finally {
      if (tmp !== null) {
        try {
          removeFile(tmp);
        } catch {
          // Best-effort temp cleanup; the post result decides the outcome.
        }
      }
    }
    if (!result || result.status !== 0) {
      const detail = String(result?.stderr ?? result?.error?.message ?? `exit ${result?.status}`).slice(0, 200);
      fail(issue, kind, name, detail);
      continue;
    }
    try {
      rename(path, `${path}.posted`);
    } catch (e) {
      fail(issue, kind, name, `posted but rename to ${name}.posted failed: ${errorText(e)}; it may be posted twice on the next run`);
      continue;
    }
    summary.posted += 1;
    log(`posted ${issue} ${kind} ${name}`);
  }
  log(JSON.stringify(summary));
  return { summary, exitCode: summary.failed > 0 || summary.invalid > 0 ? 1 : 0 };
}

function usage() {
  return "usage: node drain-outbox.mjs <outbox-dir> [--dry-run]";
}

export function main(argv) {
  let dir = null;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return 0;
    } else if (arg.startsWith("-") || dir !== null) {
      console.error(usage());
      return 2;
    } else {
      dir = arg;
    }
  }
  if (dir === null) {
    console.error(usage());
    return 2;
  }
  let counter = 0;
  const { exitCode } = drainOutbox(
    { dir, dryRun },
    {
      listDir: (d) => readdirSync(d),
      readFile: (p) => readFileSync(p, "utf8"),
      writeFile: (p, s) => writeFileSync(p, s),
      removeFile: (p) => rmSync(p, { force: true }),
      tempFile: () => join(tmpdir(), `linear-outbox-body-${process.pid}-${counter++}.md`),
      rename: (from, to) => renameSync(from, to),
      runOrca: (args) => spawnSync("orca", args, { encoding: "utf8" }),
      log: (line) => console.log(line),
    },
  );
  return exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`drain-outbox: ${errorText(e)}`);
    process.exitCode = 1;
  }
}
