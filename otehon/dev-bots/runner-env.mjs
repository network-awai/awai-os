// Environment-driven configuration for the otehon/dev-bots runner.
// Pure helpers (no process or filesystem access except through injected
// arguments) so the Linux fallbacks are unit-testable. deliver.mjs wires
// these to the real environment; run-task.sh documents the same variables.
//
//   DEV_BOTS_TEST_SHELL  shell used to run task.tests (default: /bin/zsh
//                        when it exists, otherwise /bin/bash).
//   DEV_BOTS_LINEAR      Linear record sink: "orca" (default) or "outbox".
//                        "outbox" writes comment/status JSON files under
//                        .agent-output/linear-outbox/ instead of calling orca.
//   MUSE_SANDBOX_ARGS    sandbox flags run-task.sh passes to `muse exec`
//                        (default: "--sandbox-network enabled"). A value
//                        containing --disable-sandbox is reported as disabled.
export const DEFAULT_TEST_SHELL = "/bin/zsh";
export const FALLBACK_TEST_SHELL = "/bin/bash";
export const DEFAULT_SANDBOX_ARGS = "--sandbox-network enabled";
export const OUTBOX_DIR_NAME = "linear-outbox";

/** Shell used to run task test commands. Default is unchanged (/bin/zsh); bash when zsh is absent. */
export function resolveTestShell({ env = process.env, exists = () => true } = {}) {
  const override = String(env.DEV_BOTS_TEST_SHELL ?? "").trim();
  if (override) return override;
  try {
    if (exists(DEFAULT_TEST_SHELL)) return DEFAULT_TEST_SHELL;
  } catch {
    // An exists() that throws is treated as "zsh not found".
  }
  return FALLBACK_TEST_SHELL;
}

/** Linear record sink: "orca" (default) or "outbox". Unknown values stay on the default. */
export function resolveLinearSink({ env = process.env } = {}) {
  return String(env.DEV_BOTS_LINEAR ?? "orca").trim().toLowerCase() === "outbox" ? "outbox" : "orca";
}

/** True when the muse sandbox flags run without a sandbox. */
export function isSandboxDisabled(sandboxArgs) {
  return String(sandboxArgs ?? "").split(/\s+/).includes("--disable-sandbox");
}

/**
 * Summarise the run<N>.meta records for PR-body and deliver.json display.
 * @param metas entries of {run, meta|null} where meta is the parsed run meta or null when absent.
 */
export function sandboxReport(metas) {
  const runs = metas.map(({ run, meta }) => ({
    run,
    sandbox_args: meta?.sandbox_args ?? null,
    sandbox_disabled: meta?.sandbox_disabled === true,
    recorded: meta != null,
  }));
  const disabled = runs.filter((r) => r.sandbox_disabled).map((r) => r.run);
  const unrecorded = runs.filter((r) => !r.recorded).map((r) => r.run);
  let note;
  if (!runs.length) note = "Muse sandbox: no runs recorded.";
  else if (disabled.length) note = `Muse sandbox: DISABLED for ${disabled.join(", ")} (${runs.find((r) => r.sandbox_disabled)?.sandbox_args ?? ""}). Runs without the sandbox are weaker: treat implementer "no push, no Linear write" claims as unverified there.`;
  else if (unrecorded.length) note = `Muse sandbox: enabled (${DEFAULT_SANDBOX_ARGS}) for recorded runs; not recorded for ${unrecorded.join(", ")}.`;
  else note = `Muse sandbox: enabled for ${runs.map((r) => r.run).join(", ")}.`;
  return { runs, disabled, unrecorded, note };
}

/**
 * Record one Linear entry without affecting the merge decision.
 * orca mode delegates to runOrca (spawn of the orca CLI); outbox mode writes
 * a JSON file and never touches the network. Never throws for a missing
 * transport: the caller reports the returned status, and the gate decision
 * (computed before this runs) is left unchanged either way.
 *
 * @returns {{posted: string, file?: string, error?: string}}
 */
export function recordLinearEntry(
  { sink, outDir, issue, kind, payload },
  { runOrca = () => ({ status: 1, stderr: "no orca runner" }), writeFile = null, mkdir = null, readFile = null, at = null } = {},
) {
  if (sink !== "outbox") {
    const args =
      kind === "status"
        ? ["linear", "status", "set", issue, "--to", payload.to]
        : ["linear", "comment", "add", issue, "--body-file", payload.bodyFile];
    let r;
    try {
      r = runOrca(args);
    } catch (e) {
      return { posted: "failed", error: String(e?.message ?? e).slice(0, 200) };
    }
    if (r.status === 0) return { posted: "posted" };
    return { posted: "failed", error: String(r.stderr ?? `exit ${r.status}`).slice(0, 200) };
  }
  const stamp = (at ?? new Date().toISOString()).replace(/[:.]/g, "-");
  const file = `${OUTBOX_DIR_NAME}/${stamp}-${kind}.json`;
  if (mkdir) mkdir(`${outDir}/${OUTBOX_DIR_NAME}`);
  // A comment payload carries only a local bodyFile path; embed the text so
  // the outbox record is self-contained on hosts without orca. A missing or
  // unreadable file leaves the record as-is instead of failing the delivery.
  let body;
  if (kind === "comment" && payload?.bodyFile && typeof readFile === "function") {
    try {
      body = readFile(payload.bodyFile);
    } catch {
      body = undefined;
    }
  }
  const record = { issue, kind, ...payload };
  if (typeof body === "string") record.body = body;
  writeFile(`${outDir}/${file}`, `${JSON.stringify(record, null, 1)}\n`);
  return { posted: `outbox:${file}`, file };
}

// When the task started (run-task.sh writes run1.start), carried in the pull
// request body so the DORA lead time can be measured from any host (AWAI-3708).
// deliver.mjs always writes exactly one such line, with a time or `unknown`.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
export const isUtcTime = (t) => typeof t === "string" && ISO_UTC.test(t) && Number.isFinite(Date.parse(t));

/** Text of run1.start -> the body line. Anything that is not a UTC time becomes `unknown`. */
export function taskStartLine(text) {
  const t = String(text ?? "").trim();
  return `- Task started: ${isUtcTime(t) ? t : "unknown"}`;
}

/**
 * Pull request body -> the start time, or null. The body also carries text a
 * bot wrote (the review summary), so a body with more than one such line is
 * not trusted: it yields null, never the first or the last.
 */
export function taskStartFromBody(body) {
  const lines = String(body ?? "").split("\n").map((l) => l.trim()).filter((l) => /^-\s*Task started:/i.test(l));
  if (lines.length !== 1) return null;
  const m = /^- Task started: (\S+)$/.exec(lines[0]);
  return m && isUtcTime(m[1]) ? m[1] : null;
}
