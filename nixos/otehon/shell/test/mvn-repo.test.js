import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveWritableRepo } from "../mvn-repo.mjs";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "m2-fixture-"));
  mkdirSync(path.join(root, "org"));
  writeFileSync(path.join(root, "org", "artifact.pom"), "<project/>");
  return root;
}

function readOnly(root) {
  chmodSync(path.join(root, "org", "artifact.pom"), 0o444);
  chmodSync(path.join(root, "org"), 0o555);
  chmodSync(root, 0o555);
}

test("a writable repository is returned as-is", () => {
  const root = fixture();
  try {
    assert.equal(resolveWritableRepo(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a read-only repository is copied to a writable identical tree", () => {
  const root = fixture();
  readOnly(root);
  const copy = resolveWritableRepo(root);
  try {
    assert.notEqual(copy, root);
    assert.equal(readFileSync(path.join(copy, "org", "artifact.pom"), "utf8"), "<project/>");
    writeFileSync(path.join(copy, "org", "probe.txt"), "writable");
  } finally {
    rmSync(copy, { recursive: true, force: true });
    chmodSync(path.join(root, "org", "artifact.pom"), 0o644);
    chmodSync(path.join(root, "org"), 0o755);
    chmodSync(root, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});
