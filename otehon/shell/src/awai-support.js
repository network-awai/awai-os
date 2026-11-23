// Support for Awai Network as a whole (AWAI-3170): the client side of the EN devnet support desk
// in dapps/awai-support. Every request goes through the shared consent broker, one approval per
// operation. The card shown is parsed from the exact text that is approved; the approval is signed
// by a non-exportable P-256 key kept for this purpose only (not the device identity key).
//
// devnet only: nothing here is money, revenue or a donation.

const CAPABILITY = "awai-support";
const SERVICE = "awai-support-devnet-desk";
export const APPROVAL_KIND = "awai.support.approval/1";
export const RECIPIENT = "Awai Network LLC";

// AWAI-3883: finding-9 disclosure (Legal decision via Organizer, 2026-11-23, group F;
// country nullable validator 2026-11-23; merge with main AWAI-3884 2026-11-23 — main's
// US-entity disclosure is superseded by the Legal pending values below). Recipient is
// limited to the entity that operates the endpoint processing logic AND decides the
// purpose of data use (データの利用目的を決める主体); recipient is the RECIPIENT constant
// above. Country is UNCONFIRMED: no code is written (country null, countryStatus pending);
// the user-visible note carries the provisional wording and confirmCondition what would
// confirm it. Frequency is validator 'one-time' for each-operation consent (all precedents).
const SUPPORT_DISCLOSURE = {
  recipient: RECIPIENT,
  country: null, // unconfirmed: no code; see note + confirmCondition
  countryStatus: "pending",
  "special-care": false,
  frequency: "one-time",
  note: "登記国 未確認（暫定: 日本）",
  confirmCondition: "登記国の確認（法務・税務）",
};
const operation = (name, categories, route) => ({
  capability: CAPABILITY, service: SERVICE, operation: name, consent: "each-operation",
  "data-categories": categories, endpoint: { origin: null, routes: [route] },
  disclosure: { ...SUPPORT_DISCLOSURE,
    data: ["支援の金額", "宛先", "受領書"],
    purpose: "支援の準備・送信・受領確認",
    withdrawal: "送信前の取消し" },
});
const TEMPLATES = [
  operation("prepare-support", ["support-amount"], { method: "POST", path: "/v1/support/cards", "query-params": [] },
    "prepare a devnet support card", "cancel before the card is prepared"),
  operation("send-support", ["support-card", "support-approval-signature", "approval-public-key"],
    { method: "POST", path: "/v1/support/funds", "query-params": [] },
    "send the approved devnet support card", "do not approve; a sent card cannot be recalled"),
  operation("read-support-receipt", ["support-transfer-id"],
    { method: "GET", path: "/v1/support/receipts/:transfer", "query-params": [] },
    "read a devnet support receipt", "cancel the request before it is sent"),
];

const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?$/;

// The desk origin is fixed at build time (AWAI_SUPPORT_DESK_ORIGIN). No origin, no operations.
export function supportOperations(deskOrigin) {
  if (!deskOrigin) return [];
  if (!ORIGIN.test(deskOrigin)) throw new Error("invalid-support-desk-origin");
  return TEMPLATES.map((t) => ({ ...t, endpoint: { ...t.endpoint, origin: deskOrigin } }));
}

const selector = (name) => ({ capability: CAPABILITY, service: SERVICE, operation: name });
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Keyword values arrive as ":name" strings (the EN devnet wire form).
export function parseCard(cardText) {
  const c = JSON.parse(cardText);
  const did = (x) => typeof x === "string" && /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/.test(x);
  if (c.kind !== ":consent-card" || c.target !== "awai-support"
      || c.recipient?.["legal-name"] !== RECIPIENT || c["value-class"] !== ":devnet"
      || c.wording !== ":support" || c.route !== ":en-devnet"
      || !Number.isSafeInteger(c.amount) || c.amount <= 0 || !did(c.sponsor) || !did(c.bot)
      || typeof c["chain-id"] !== "string" || !c["chain-id"].startsWith("awai-en-devnet/")
      || !/^support-[0-9a-f]{24}$/.test(c["transfer-id"]) || !Number.isSafeInteger(c["expires-ms"])) {
    throw new Error("invalid-support-card");
  }
  return {
    recipient: RECIPIENT, bot: c.bot, sponsor: c.sponsor, amount: c.amount, chainId: c["chain-id"],
    transferId: c["transfer-id"], expiresMs: c["expires-ms"], purpose: Array.isArray(c.purpose) ? c.purpose : [],
  };
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function approvalPayload(cardText) {
  return `${APPROVAL_KIND}\ncard-sha256=${await sha256Hex(cardText)}\ndecision=approve`;
}

const b64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

// Sign only after the person approved this card on screen.
export async function signApproval(keyPair, cardText) {
  const payload = await approvalPayload(cardText);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey,
    new TextEncoder().encode(payload));
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  return { payload, sig: b64(sig), spki: b64(spki) };
}

const DB = "awai-support";
const STORE = "keys";
const KEY_ID = "approval";

function idb(action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = action(open.result.transaction(STORE, "readwrite").objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}

// The approval key: P-256, private key not extractable, kept in this app's IndexedDB.
export async function approvalKey() {
  let pair = await idb((store) => store.get(KEY_ID));
  if (pair?.privateKey?.extractable === false) return pair;
  pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  await idb((store) => store.put(pair, KEY_ID));
  return pair;
}

export async function prepareSupport(broker, deskOrigin, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("invalid-support-amount");
  const r = await broker.invoke(selector("prepare-support"),
    { input: `${deskOrigin}/v1/support/cards`, init: json({ amount }) });
  const v = await r.json();
  if (!r.ok || typeof v["card-text"] !== "string") throw new Error("support-card-unavailable");
  const card = parseCard(v["card-text"]);
  if (card.transferId !== v["transfer-id"] || card.amount !== amount) throw new Error("invalid-support-card");
  return { cardText: v["card-text"], card };
}

// Returns {finalized} or throws; a missing answer is reported as unknown and never resent.
export async function sendSupport(broker, deskOrigin, cardText, approval) {
  const card = parseCard(cardText);
  let r;
  try {
    r = await broker.invoke(selector("send-support"), {
      input: `${deskOrigin}/v1/support/funds`,
      init: json({ "transfer-id": card.transferId, "card-text": cardText, approval }),
    });
  } catch (error) {
    if (/not approved|cancelled/.test(error?.message ?? "")) throw error;
    const unknown = new Error("support-outcome-unknown"); unknown.unknown = true; throw unknown;
  }
  const v = await r.json().catch(() => ({}));
  if (r.ok && v.finalized === true && v["transfer-id"] === card.transferId) {
    return { finalized: true, height: v.height, transferId: card.transferId };
  }
  if (v.ambiguous) { const unknown = new Error("support-outcome-unknown"); unknown.unknown = true; throw unknown; }
  const refused = new Error("support-refused"); refused.cause = v.cause ?? `http-${r.status}`; throw refused;
}

export async function readReceipt(broker, deskOrigin, transferId) {
  if (!/^support-[0-9a-f]{24}$/.test(transferId)) throw new Error("invalid-support-transfer");
  const r = await broker.invoke(selector("read-support-receipt"),
    { input: `${deskOrigin}/v1/support/receipts/${transferId}`, init: { method: "GET" } });
  const v = await r.json();
  if (!r.ok) throw new Error("support-receipt-unavailable");
  if (v.received !== true) return { received: false, cause: v.cause ?? "unknown" };
  if (v["transfer-id"] !== transferId || v["value-class"] !== ":devnet"
      || v.recipient?.["legal-name"] !== RECIPIENT || !Number.isSafeInteger(v.amount)) {
    throw new Error("invalid-support-receipt");
  }
  return { received: true, transferId, height: v.height, amount: v.amount, finality: v.finality };
}
