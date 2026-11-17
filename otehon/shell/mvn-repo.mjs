// Resolve a writable Maven local repository for the Clojure invocations in
// build.mjs. The Nix image build pins a read-only store path through
// MVN_REPO; Maven writes lock files next to cached artifacts, so a
// read-only repo fails at use time even though it was populated. A writable
// input is returned as-is, so local builds using ~/.m2 never copy.
import { accessSync, chmodSync, constants, cpSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeWritable(target) {
  const fix = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        chmodSync(full, 0o755);
        fix(full);
      } else {
        chmodSync(full, 0o644);
      }
    }
  };
  chmodSync(target, 0o755);
  fix(target);
}

export function resolveWritableRepo(repo) {
  try {
    accessSync(repo, constants.W_OK);
    return repo;
  } catch {
    const target = mkdtempSync(join(tmpdir(), "otehon-m2-"));
    cpSync(repo, target, { recursive: true });
    makeWritable(target);
    return target;
  }
}
