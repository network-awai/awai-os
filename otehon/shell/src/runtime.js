import {chatOperation,chatHistoryOperation,chatSessionsOperation,chatCreateOperation,chatBotsOperation,chatMediaOperation} from './bot-chat-contract.js';
import {aliasOperations,identityOperations} from './mail-alias-contract.js';
import {supportOperations} from './awai-support.js';
import {computeOperations} from './awai-compute.js';
import {voiceOperation} from './voice-channel-contract.js';
import {egovOperation} from './egov-host.js';
// External operations of the OS shell and the phone page, through the shared
// kotoba.app.client-runtime.v1 broker. Each one asks the person first.
import { createClientConsentHost, createClientOperationBroker } from "./vendor-runtime.gen.js";

const PASSPORT_ORIGIN = "https://mainnet.optimism.io";

// AWAI-3884: finding-9 disclosures, in the download-contract shape (AWAI-3842).
// Per the owner decision (2026-11-23) our own relay is declared on the US entity
// side, and the Optimism public RPC as OP Labs PBC (US).
const RELAY_DISCLOSURE = { recipient: "Awai Network LLC", country: "US", "country-name": "United States",
  "foreign-info-url": "https://awai.network/", "special-care": false, frequency: "one-time" };
const OPTIMISM_DISCLOSURE = { recipient: "OP Labs PBC", country: "US", "country-name": "United States",
  "foreign-info-url": "https://www.optimism.io/", data: ["wallet address"], "special-care": false,
  frequency: "one-time", withdrawal: "cancel the request before it is sent" };

export function osOperations(relayOrigin, supportDeskOrigin, computeDeskOrigin) {
  return [
    ...supportOperations(supportDeskOrigin),
    ...computeOperations(computeDeskOrigin),
    chatOperation,chatHistoryOperation,chatSessionsOperation,chatCreateOperation,chatBotsOperation,chatMediaOperation,voiceOperation,...aliasOperations,...identityOperations,
    egovOperation,
    {
      capability: "awai-link",
      service: "awai-relay",
      operation: "await-phone-approval",
      consent: "each-operation",
      "data-categories": ["link-topic"],
      disclosure: { ...RELAY_DISCLOSURE, data: ["link topic"],
        purpose: "wait for a phone approval on the link topic", withdrawal: "cancel the wait at any time" },
      endpoint: {
        origin: relayOrigin,
        routes: [{ method: "GET", path: "/v1/:topic/json", "query-params": [] }],
      },
    },
    {
      capability: "awai-trust",
      service: "human-passport-onchain",
      operation: "read-score",
      consent: "each-operation",
      "data-categories": ["wallet-address"],
      disclosure: { ...OPTIMISM_DISCLOSURE, purpose: "read a Human Passport score from the chain" },
      endpoint: { origin: PASSPORT_ORIGIN, method: "POST", path: "/" },
    },
    {
      capability: "awai-wallet",
      service: "optimism-public-rpc",
      operation: "read-eth-balance",
      consent: "each-operation",
      "data-categories": ["wallet-address"],
      disclosure: { ...OPTIMISM_DISCLOSURE, purpose: "read an ETH balance from the chain" },
      endpoint: { origin: PASSPORT_ORIGIN, method: "POST", path: "/" },
    },
  ];
}

// Fixed RPC method and endpoint; neither is supplied by a Dapp or a Bot.
export async function requestWalletBalance(broker, address, options) {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("invalid-wallet-address");
  }
  return broker.invoke(
    { capability: "awai-wallet", service: "optimism-public-rpc", operation: "read-eth-balance" },
    {
      input: `${PASSPORT_ORIGIN}/`,
      init: {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
      },
    }, options,
  );
}

export async function readWalletBalance(broker, address) {
  const response = await requestWalletBalance(broker, address);
  if (!response.ok) throw new Error("balance-read-failed");
  const data = await response.json();
  if (!data || data.jsonrpc !== "2.0" || data.id !== 1 || typeof data.result !== "string"
      || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(data.result)) {
    throw new Error("invalid-balance-response");
  }
  const wei = BigInt(data.result);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function phoneOperations(relayOrigin) {
  return [
    {
      capability: "awai-link",
      service: "awai-relay",
      operation: "deliver-approval",
      consent: "each-operation",
      "data-categories": ["encrypted-link-approval"],
      disclosure: { ...RELAY_DISCLOSURE, data: ["encrypted link approval"],
        purpose: "deliver an encrypted approval to the waiting device", withdrawal: "do not approve; a delivered approval cannot be recalled" },
      endpoint: {
        origin: relayOrigin,
        routes: [{ method: "POST", path: "/v1/:topic", "query-params": [] }],
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

// Bounded diagnostic codes only: no topic, payload, URL or exception text.
export function relayFailureCode(error) {
  if (typeof error?.code === "string" && /^relay-http-[1-5][0-9]{2}$/.test(error.code)) return error.code;
  const message = typeof error?.message === "string" ? error.message : "";
  if (message.includes("not approved")) return "operation-denied";
  if (message.includes("cancelled")) return "operation-cancelled";
  if (error?.name === "TypeError") return "browser-network-error";
  if (message === "relay-unavailable") return "relay-protocol-error";
  return "client-error";
}

// Waits on one stream, so one approval covers the whole wait.
export async function awaitPhoneApproval(broker, relayOrigin, topic, signal) {
  const response = await broker.invoke(
    { capability: "awai-link", service: "awai-relay", operation: "await-phone-approval" },
    { input: `${relayOrigin}/v1/${topic}/json`, init: { method: "GET" } },
    { signal },
  );
  if (!response.ok) {
    const error = new Error("relay-http-error");
    error.code = `relay-http-${response.status}`;
    throw error;
  }
  if (!response.body) throw new Error("relay-unavailable");
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
      input: `${relayOrigin}/v1/${topic}`,
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
