// External operations of the OS shell and the phone page, through the shared
// kotoba.app.client-runtime.v1 broker. Each one asks the person first.
import { createClientConsentHost, createClientOperationBroker } from "../vendor/kotoba-client-runtime.js";

const PASSPORT_ORIGIN = "https://mainnet.optimism.io";

export function osOperations(relayOrigin) {
  return [
    {
      capability: "awai-link",
      service: "awai-relay",
      operation: "await-phone-approval",
      consent: "each-operation",
      "data-categories": ["link-topic"],
      endpoint: {
        origin: relayOrigin,
        routes: [{ method: "GET", path: "/:topic/json", "query-params": [] }],
      },
    },
    {
      capability: "awai-trust",
      service: "human-passport-onchain",
      operation: "read-score",
      consent: "each-operation",
      "data-categories": ["wallet-address"],
      endpoint: { origin: PASSPORT_ORIGIN, method: "POST", path: "/" },
    },
  ];
}

export function phoneOperations(relayOrigin) {
  return [
    {
      capability: "awai-link",
      service: "awai-relay",
      operation: "deliver-approval",
      consent: "each-operation",
      "data-categories": ["encrypted-link-approval"],
      endpoint: {
        origin: relayOrigin,
        routes: [{ method: "POST", path: "/:topic", "query-params": [] }],
      },
    },
  ];
}

export function runtimeDescriptor(entry, operations) {
  return {
    schema: "kotoba.app.client-runtime.v1",
    target: "browser",
    profile: "trusted-page-v1",
    entry,
    "local-state": { adapter: "localstorage", schema: "awai.account", version: 1 },
    operations,
  };
}

export function createBroker(entry, operations) {
  const selector = (operation) => [operation.capability, operation.service, operation.operation];
  return createClientOperationBroker({
    runtime: runtimeDescriptor(entry, operations),
    requestedCapabilities: [...new Set(operations.map((operation) => operation.capability))],
    approvedOperations: operations,
    hostSupportedOperations: operations.map(selector),
    consentHost: createClientConsentHost(),
  });
}

// Waits on one stream, so one approval covers the whole wait.
export async function awaitPhoneApproval(broker, relayOrigin, topic, signal) {
  const response = await broker.invoke(
    { capability: "awai-link", service: "awai-relay", operation: "await-phone-approval" },
    { input: `${relayOrigin}/${topic}/json`, init: { method: "GET" } },
    { signal },
  );
  if (!response.ok || !response.body) throw new Error("relay-unavailable");
  return {
    async *messages() {
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.event === "message" && typeof event.message === "string") yield event.message;
        }
      }
    },
  };
}

export async function deliverApproval(broker, relayOrigin, topic, sealed) {
  const response = await broker.invoke(
    { capability: "awai-link", service: "awai-relay", operation: "deliver-approval" },
    {
      input: `${relayOrigin}/${topic}`,
      init: { method: "POST", headers: { "content-type": "text/plain" }, body: sealed },
    },
  );
  if (!response.ok) throw new Error("relay-unavailable");
}

export async function readPassport(broker, call) {
  const response = await broker.invoke(
    { capability: "awai-trust", service: "human-passport-onchain", operation: "read-score" },
    {
      input: `${PASSPORT_ORIGIN}/`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(call),
      },
    },
  );
  if (!response.ok) throw new Error("chain-read-failed");
  return response.json();
}
