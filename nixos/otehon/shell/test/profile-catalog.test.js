import { test } from "node:test";
import assert from "node:assert/strict";
import { readExistingProfiles } from "../src/profile-catalog.js";
import { osOperations } from "../src/runtime.js";
import { catalogHandler } from "../../profiles/bridge.mjs";

const row = { id: "notes", description: "記録する", skills: ["notes"] };
const body = profiles => ({ schema: "awai.itonami.profile-catalog.v1", profiles });

test("profile catalog uses only the fixed declared TLS GET through its broker", async () => {
  const calls = [];
  const broker = { invoke: async (...args) => { calls.push(args); return { ok: true, json: async () => body([{ ...row, secret: "discard" }]) }; } };
  assert.deepEqual(await readExistingProfiles(broker), [row]);
  assert.equal(calls[0][1].input, "https://127.0.0.1:8777/v1/itonami/profiles");
  assert.deepEqual(calls[0][1].init, { method: "GET" });
  assert.deepEqual(calls[0][2], {});
  const declaration = osOperations("https://example.invalid").find(op => op.capability === "awai-profile-catalog");
  assert.equal(declaration.consent, "each-operation");
  assert.deepEqual(declaration.endpoint.routes, [{ method: "GET", path: "/v1/itonami/profiles", "query-params": [] }]);
});

test("denial and malformed/duplicate metadata never yield a catalog", async () => {
  await assert.rejects(readExistingProfiles({ invoke: async () => { throw Error("denied"); } }), /denied/);
  for (const profiles of [[row, row], [{ ...row, id: "../escape" }], [{ ...row, skills: [1] }]]) {
    await assert.rejects(readExistingProfiles({ invoke: async () => ({ ok: true, json: async () => body(profiles) }) }), /invalid-profile-catalog/);
  }
});

test("platform bridge rejects unknown origins, methods, paths and queries before reading", async () => {
  let reads = 0;
  const handler = catalogHandler(async () => { reads++; return JSON.stringify(body([row])); });
  for (const [origin, method, url, expected] of [
    ["https://evil.invalid", "GET", "/v1/itonami/profiles", 403],
    ["null", "POST", "/v1/itonami/profiles", 404],
    ["null", "GET", "/v1/itonami/profiles?path=secret", 404],
    ["null", "GET", "/private", 404],
  ]) {
    const response = { writeHead(status) { assert.equal(status, expected); }, end() {} };
    await handler({ headers: { origin }, method, url }, response);
  }
  assert.equal(reads, 0);
  let result;
  await handler({ headers: { origin: "null" }, method: "GET", url: "/v1/itonami/profiles" },
    { writeHead(status, headers) { assert.equal(status, 200); assert.equal(headers["cache-control"], "no-store"); }, end(text) { result = JSON.parse(text); } });
  assert.equal(reads, 1);
  assert.deepEqual(result, body([row]));
});
