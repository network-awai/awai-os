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

// AWAI-3883: finding-9 disclosures (Legal decision via Organizer, 2026-11-23; recipient
// definition and country handling corrected 2026-11-23; country nullable validator
// 2026-11-23; merge with main AWAI-3884 2026-11-23 — main's US-entity disclosures are
// superseded by the Legal pending values below). Recipient is limited to the entity that
// operates the endpoint processing logic AND decides the purpose of data use
// (データの利用目的を決める主体); hosting/line/CDN = processor, not recipient. Cloudflare
// runs the relay Worker, so the relay recipient is Awai Network LLC (operator), not
// Cloudflare, Inc. Country is UNCONFIRMED: the consent dialog reads the machine country
// field for display, so no code is written — country is null with countryStatus "pending",
// the user-visible `note` carries the provisional wording, and `confirmCondition` says
// what would confirm it. Frequency is validator 'one-time' for each-operation consent
// (all precedents). Relay routes follow main's /v1/ protocol.
const RELAY_DISCLOSURE = {
  recipient: "Awai Network LLC",
  country: null, // unconfirmed: no code; see note + confirmCondition
  countryStatus: "pending",
  data: ["承認要求の内容", "端末記録"],
  "special-care": false,
  purpose: "端末承認の受け渡し",
  frequency: "one-time",
  withdrawal: "relay 側で要求を破棄／端末で拒否",
  note: "登記国 未確認（暫定: 日本）",
  confirmCondition: "登記国の確認（法務・税務）",
};
// Group D: operator and country are UNCONFIRMED (expert review pending). Legal: OP Labs
// develops/maintains core tech; Terms are provided by the Foundation; OP Mainnet
// ownership/control is denied — the mainnet.optimism.io operator cannot be officially
// identified. Recipient is written exactly as Legal directed; no country code is guessed
// (US/Cayman are listed only as candidates in the note, as Legal allows).
const OPTIMISM_DISCLOSURE = {
  recipient: "未確定（OP Labs PBC または Optimism Foundation）",
  country: null, // unconfirmed: no code; see note + confirmCondition
  countryStatus: "pending",
  data: ["読み取るアドレス", "スコア"],
  "special-care": false,
  purpose: "残高とスコアの読み取り",
  frequency: "one-time",
  withdrawal: "読み取りを止める (no local residue)",
  note: "operator 未確定（OP Labs PBC または Optimism Foundation）; country 未確定（US または Cayman）; origin: https://mainnet.optimism.io",
  confirmCondition: "OP Labs PBC / Optimism Foundation への確認",
};

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
      endpoint: {
        origin: relayOrigin,
        routes: [{ method: "GET", path: "/v1/:topic/json", "query-params": [] }],
      },
      disclosure: { ...RELAY_DISCLOSURE },
    },
    {
      capability: "awai-trust",
      service: "human-passport-onchain",
      operation: "read-score",
      consent: "each-operation",
      "data-categories": ["wallet-address"],
      endpoint: { origin: PASSPORT_ORIGIN, method: "POST", path: "/" },
      disclosure: { ...OPTIMISM_DISCLOSURE },
    },
    {
      capability: "awai-wallet",
      service: "optimism-public-rpc",
      operation: "read-eth-balance",
      consent: "each-operation",
      "data-categories": ["wallet-address"],
      endpoint: { origin: PASSPORT_ORIGIN, method: "POST", path: "/" },
      disclosure: { ...OPTIMISM_DISCLOSURE },
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
      endpoint: {
        origin: relayOrigin,
        routes: [{ method: "POST", path: "/v1/:topic", "query-params": [] }],
      },
      // AWAI-3883 phone measurement (2026-11-23): deliver-approval hits the EXTERNAL relay
      // origin (the default relay host, deploy/awai-link Worker), not localhost /
      // tauri:// / appassets — so it stays an external operation with a pending country
      // (operator Awai Network LLC, registration unconfirmed), and the origin is named in
      // the user-visible note.
      disclosure: { ...RELAY_DISCLOSURE, note: `origin: ${relayOrigin}; 登記国 未確認（暫定: 日本）` },
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
  // AWAI-3883 phone decision (2026-11-23): the relay accepts only a 32-hex topic
  // (/v1/<32hex>); the client matches the relay contract and never widens it. A topic
  // that is not already 32 lowercase hex fails before anything is sent — valid topics
  // come from createLinkRequest (randomHex(16)) and are validated on parse.
  if (typeof topic !== "string" || !/^[0-9a-f]{32}$/.test(topic)) {
    throw new Error("invalid-link-topic");
  }
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
