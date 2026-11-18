import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { guestPreamble, restrictedGuestHashes } from "../scripts/guest-csp.mjs";

const runtimeSource = await readFile(new URL("../vendor/kotoba-client-runtime.js", import.meta.url), "utf8");
const guestHtml = await readFile(new URL("../vendor/egov/gyosei.html", import.meta.url), "utf8");
const h = (t) => `'sha256-${createHash("sha256").update(t, "utf8").digest("base64")}'`;

test("the shell allows exactly the pinned guest's inline script and style plus the runtime preamble", () => {
  const { script, style } = restrictedGuestHashes({ guestHtml, runtimeSource });
  const inline = guestHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  const css = guestHtml.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.deepEqual(script, [h(guestPreamble(runtimeSource)), h(inline)]);
  assert.deepEqual(style, [h(css)]);
  assert.ok(!script.includes("'unsafe-inline'") && !style.includes("'unsafe-inline'"));
});

test("a changed guest gets a different hash, so its old allowance does not cover it", () => {
  const before = restrictedGuestHashes({ guestHtml, runtimeSource }).script[1];
  const after = restrictedGuestHashes({ guestHtml: guestHtml.replace("<script>", "<script>/*x*/"), runtimeSource }).script[1];
  assert.notEqual(before, after);
});

test("a guest with external resources, inline handlers or extra scripts is refused", () => {
  for (const bad of [
    guestHtml + '<script src="https://example.com/x.js"></script>',
    guestHtml + "<script>1</script>",
    guestHtml + '<link rel="stylesheet" href="x.css">',
    guestHtml + '<img src="data:," onerror="alert(1)">',
  ]) assert.throws(() => restrictedGuestHashes({ guestHtml: bad, runtimeSource }));
  assert.throws(() => restrictedGuestHashes({ guestHtml, runtimeSource: "no preamble" }));
});
