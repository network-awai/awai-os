import { test } from "node:test";
import assert from "node:assert/strict";
import { bridge, tailscaleAdapters, BRIDGE } from "../src/connect.js";
import { osOperations, runtimeDescriptor } from "../src/runtime.js";
import { clientRuntimeConnectSrc, clientRuntimeProblems } from "../vendor/kotoba-client-runtime.js";

function fakeFetch(calls, reply = { ok: true, value: { state: "NeedsLogin" } }) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: reply.ok, json: async () => reply.value };
  };
}

test("bridge calls carry the header and only go to loopback", async () => {
  const calls = [];
  await bridge("/status", undefined, fakeFetch(calls));
  await bridge("/kekkai/open", {}, fakeFetch(calls));
  assert.equal(BRIDGE, "http://127.0.0.1:8791");
  assert.deepEqual(calls.map((c) => [c.url, c.init.method, c.init.headers["x-otehon-connect"]]),
    [[BRIDGE + "/status", "GET", "1"], [BRIDGE + "/kekkai/open", "POST", "1"]]);
});

test("bridge errors surface instead of passing as success", async () => {
  await assert.rejects(bridge("/status", undefined, fakeFetch([], { ok: false, value: { error: "operation_failed" } })), /operation_failed/);
  await assert.rejects(bridge("/status", undefined, fakeFetch([], { ok: true, value: null })), /bridge-unavailable/);
});

test("the Tailscale sign-in is a declared browser operation outside connect-src", () => {
  const operations = osOperations("https://relay.awai.network");
  const join = operations.find((o) => o.service === "tailscale");
  assert.equal(join.consent, "each-operation");
  assert.equal(join.endpoint["browser-action"], "tailscale-up");
  const capabilities = [...new Set(operations.map((o) => o.capability))];
  assert.deepEqual(clientRuntimeProblems(runtimeDescriptor("index.html", operations), capabilities, []), []);
  assert.doesNotMatch(clientRuntimeConnectSrc(runtimeDescriptor("index.html", operations), capabilities, [], []), /tailscale/);
});

test("the adapter posts the connect action once", async () => {
  const calls = [];
  await tailscaleAdapters(fakeFetch(calls)).tailscale["join-tailnet"]();
  assert.deepEqual(calls.map((c) => c.url), [BRIDGE + "/tailscale/connect"]);
});
