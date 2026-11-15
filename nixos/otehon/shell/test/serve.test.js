import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";

test("preview server never caches bundles", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "otehon-preview-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "dist", "assets"), { recursive: true });
  await copyFile(new URL("../serve.mjs", import.meta.url), path.join(dir, "serve.mjs"));
  await writeFile(path.join(dir, "dist", "assets", "main.js"), "fixture");
  const proc = spawn(process.execPath, [path.join(dir, "serve.mjs"), "0"]);
  t.after(async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = once(proc, "exit");
      proc.kill();
      await exited;
    }
  });
  const [chunk] = await Promise.race([
    once(proc.stdout, "data"),
    once(proc, "exit").then(([code]) => { throw new Error(`preview server exited: ${code}`); }),
  ]);
  const url = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
  assert.ok(url, `missing server address: ${chunk}`);
  const res = await fetch(new URL("assets/main.js", url));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(await res.text(), "fixture");
});
