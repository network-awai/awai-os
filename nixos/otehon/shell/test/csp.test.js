import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scriptSrc, styleSrc } from "../src/csp.js";

test("the file kiosk keeps the exact script/style sources", () => {
  assert.equal(scriptSrc("file"), "script-src file:");
  assert.equal(styleSrc("file"), "style-src file:");
  assert.equal(scriptSrc(undefined), "script-src file:");
  assert.equal(styleSrc("anything-else"), "style-src file:");
});

test("the http preview allows its own origin like the link page", () => {
  assert.equal(scriptSrc("http"), "script-src 'self'");
  assert.equal(styleSrc("http"), "style-src 'self'");
});

test("the shell template carries the script/style placeholders", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const template = await readFile(path.join(root, "index.html"), "utf8");
  assert.ok(template.includes("__SCRIPT_SRC__"));
  assert.ok(template.includes("__STYLE_SRC__"));
  // What build.mjs writes by default must equal the pre-change template.
  const built = template
    .replace("__CONNECT_SRC__", "connect-src https://example.invalid")
    .replace("__SCRIPT_SRC__", scriptSrc("file"))
    .replace("__STYLE_SRC__", styleSrc("file"));
  assert.ok(!built.includes("__"));
  assert.ok(built.includes("script-src file:; style-src file:;"));
  const http = template.replace("__SCRIPT_SRC__", scriptSrc("http")).replace("__STYLE_SRC__", styleSrc("http"));
  assert.ok(http.includes("script-src 'self'; style-src 'self';"));
});
