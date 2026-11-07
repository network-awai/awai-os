import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { REGISTRY_SHA256, searchRegistry } from "../src/discovery.js";

test("pinned discovery snapshot matches its recorded digest", () => {
  const bytes = readFileSync(new URL("../src/registry/itonami-index.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), REGISTRY_SHA256);
  const index = JSON.parse(bytes);
  assert.ok(searchRegistry(index, "fleet-health-auditor").some((item) => item.id === "fleet-health-auditor"));
  assert.deepEqual(searchRegistry(index, "  "), []);
  assert.ok(searchRegistry(index, "a", 100).length <= 30);
  assert.deepEqual(searchRegistry({ entries: [null, { id: 2 }, {}] }, "x"), []);
});
