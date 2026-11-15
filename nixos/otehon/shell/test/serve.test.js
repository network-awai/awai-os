import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

const PORT = 8909;
const PAGE = `http://127.0.0.1:${PORT}/assets/main.js`;

async function waitUp(proc, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(PAGE);
      if (res.ok) return res;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  throw new Error("preview server did not come up");
}

test("preview server never caches bundles", async (t) => {
  const proc = spawn(process.execPath, ["serve.mjs", String(PORT)], {
    cwd: new URL("..", import.meta.url),
  });
  t.after(() => proc.kill());
  const res = await waitUp(proc);
  assert.equal(res.headers.get("cache-control"), "no-store");
  await res.arrayBuffer();
});
