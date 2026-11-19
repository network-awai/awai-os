// Host-environment selection for otehon/dev-bots. Pure functions (plus one small
// file write) so the Linux/macOS behaviour is unit-testable without running bots.
// Decides nothing about merge: gate.mjs owns the decision and is unchanged.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Shell used to run task test commands outside the agent sandbox.
// Default is unchanged (zsh where it exists); an explicit path always wins,
// and hosts without zsh (Debian userland) fall back to bash.
export function selectTestShell(env = process.env, fs = { existsSync }) {
  if (env.DEV_BOTS_TEST_SHELL) return env.DEV_BOTS_TEST_SHELL;
  return fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";
}

// Linear recording means. "orca" (default) posts through the macOS helper;
// "outbox" only writes JSON under .agent-output/linear-outbox. A missing or
// failing orca never changes the merge decision: deliver.mjs falls back to the
// outbox and says so in the result.
export function linearSink(env = process.env) {
  return env.DEV_BOTS_LINEAR === "outbox" ? "outbox" : "orca";
}

// Muse sandbox flags for run-task.sh phases. Default keeps the current
// behaviour (--sandbox-network enabled). MUSE_SANDBOX=off is for hosts where no
// sandbox exists (proot); the disabled mode is recorded in run*.meta and must
// be surfaced by deliver.mjs, never weakened silently.
export function sandboxArgs(env = process.env) {
  if (env.MUSE_SANDBOX === "off") return { args: ["--disable-sandbox"], mode: "disabled" };
  return { args: ["--sandbox-network", "enabled"], mode: "enabled" };
}

// One-line sandbox summary for PR bodies and Linear comments from run*.meta
// entries of the shape { run: "run1", sandbox: "enabled" | "disabled" }.
export function sandboxSummary(metas) {
  const off = (metas ?? []).filter((m) => m.sandbox !== "enabled").map((m) => m.run);
  return off.length ? `disabled (${off.join(", ")})` : "enabled";
}

// Record one Linear write (comment or status change) as JSON for later replay.
// Returns the outbox-relative path for the delivery report.
export function writeOutbox(outDir, entry) {
  const dir = join(outDir, "linear-outbox");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${entry.issue}-${entry.kind}-${stamp}.json`;
  writeFileSync(join(dir, name), JSON.stringify(entry, null, 1) + "\n");
  return join("linear-outbox", name);
}
