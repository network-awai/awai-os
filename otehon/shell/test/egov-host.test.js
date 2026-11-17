import assert from "node:assert/strict";
import { test } from "node:test";
import { createEgovHostBroker, egovOperation, statuteRequest } from "../src/egov-host.js";
import { clientRuntimeProblems, clientEndpointAllowsRequest } from "../vendor/kotoba-client-runtime.js";
import { osOperations, runtimeDescriptor } from "../src/runtime.js";

const selector = { capability: "awai-egov", service: "e-gov-law-api", operation: "read-statute" };
const payload = { lawId: "342AC0000000081", article: "MainProvision-Article_22" };

test("the guest's one read becomes a host-built e-Gov GET through the shared broker", async () => {
  const calls = [];
  const response = { ok: true };
  const host = createEgovHostBroker({ invoke: async (...args) => { calls.push(args); return response; } });
  const signal = new AbortController().signal;
  assert.equal(await host.invoke(selector, payload, { signal }), response);
  assert.deepEqual(calls[0][0], selector);
  assert.equal(calls[0][1].input, "https://laws.e-gov.go.jp/api/2/law_data/342AC0000000081?law_full_text_format=json&elm=MainProvision-Article_22");
  assert.deepEqual(calls[0][1].init, { method: "GET" });
  assert.equal(calls[0][2].signal, signal);
});

test("the guest cannot choose another selector, law, article form, endpoint or extra field", async () => {
  let calls = 0;
  const host = createEgovHostBroker({ invoke() { calls++; } });
  for (const [s, p] of [
    [{ ...selector, operation: "write-statute" }, payload],
    [{ ...selector, service: "other" }, payload],
    [{ ...selector, extra: true }, payload],
    [selector, { ...payload, lawId: "999AC0000000001" }],
    [selector, { ...payload, article: "MainProvision-Article_22&x=1" }],
    [selector, { ...payload, article: "../../x" }],
    [selector, { ...payload, input: "https://example.com/" }],
    [selector, null],
  ]) await assert.rejects(host.invoke(s, p), /egov-operation-not-supported/);
  assert.equal(calls, 0, "nothing reaches the broker");
});

test("a denied operation is reported as denied and fabricates no data", async () => {
  const host = createEgovHostBroker({ invoke: async () => { throw Error("client operation was not approved"); } });
  await assert.rejects(host.invoke(selector, payload), /not approved/);
});

test("the declared operation is valid, asks each time and admits only the host-built request", () => {
  assert.equal(egovOperation.consent, "each-operation");
  const ops = osOperations("https://relay.awai.network");
  assert.ok(ops.includes(egovOperation));
  const runtime = runtimeDescriptor("index.html", ops);
  assert.deepEqual(clientRuntimeProblems(runtime, [...new Set(ops.map((o) => o.capability))], []), []);
  const { input } = statuteRequest(payload);
  assert.ok(clientEndpointAllowsRequest(egovOperation.endpoint, input, "GET"));
  assert.ok(!clientEndpointAllowsRequest(egovOperation.endpoint, input, "POST"));
  assert.ok(!clientEndpointAllowsRequest(egovOperation.endpoint, "https://laws.e-gov.go.jp/api/2/law_data/342AC0000000081?law_full_text_format=xml&elm=MainProvision-Article_22", "GET"));
  assert.ok(!clientEndpointAllowsRequest(egovOperation.endpoint, "https://laws.e-gov.go.jp/api/2/laws?law_title=x", "GET"));
});
