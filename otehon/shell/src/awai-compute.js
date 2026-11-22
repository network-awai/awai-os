// Compute support for Awai Network (AWAI-3115, parent AWAI-3112): the client side of the EN devnet
// compute desk in dapps/awai-compute. Every request goes through the shared consent broker, one
// approval per operation. The offer shown is parsed from the exact text that is signed; the offer is
// signed by a non-exportable P-256 provider key kept for this purpose only (not the device identity
// key). The provider key is separate from the acceptor key held by the desk host. The en devnet
// sponsor key is untouched (not part of this flow).
//
// devnet only: nothing here is money, revenue or a donation. The work receipt never carries a
// prompt or output body. The credit unit is provisional (one Order consumes one credit) and lives
// in dapps/awai-compute/src/awai_compute/core.cljc so replacing it is one edit.

const CAPABILITY = "awai-compute";
const SERVICE = "awai-compute-devnet-desk";
export const OFFER_KIND = "awai.compute.offer/1";
export const WORK_RECEIPT_KIND = "awai.work-receipt/1";

const operation = (name, categories, route) => ({
  capability: CAPABILITY, service: SERVICE, operation: name, consent: "each-operation",
  "data-categories": categories, endpoint: { origin: null, routes: [route] },
});
const TEMPLATES = [
  operation("prepare-compute", ["compute-offer", "provider-identity"], { method: "POST", path: "/v1/compute/offers", "query-params": [] }),
  operation("run-compute", ["compute-offer", "compute-order", "compute-approval-signature", "compute-funding-signature", "offer-public-key"],
    { method: "POST", path: "/v1/compute/orders", "query-params": [] }),
  operation("read-work-receipt", ["compute-order-id"],
    { method: "GET", path: "/v1/compute/receipts/:order", "query-params": [] }),
];

const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?$/;

// The desk origin is fixed at build time (AWAI_COMPUTE_DESK_ORIGIN). No origin, no operations.
export function computeOperations(deskOrigin) {
  if (!deskOrigin) return [];
  if (!ORIGIN.test(deskOrigin)) throw new Error("invalid-compute-desk-origin");
  return TEMPLATES.map((t) => ({ ...t, endpoint: { ...t.endpoint, origin: deskOrigin } }));
}

const selector = (name) => ({ capability: CAPABILITY, service: SERVICE, operation: name });
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Keyword values arrive as ":name" strings (the EN devnet wire form).
export function parseOffer(offerText) {
  const c = JSON.parse(offerText);
  const did = (x) => typeof x === "string" && /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/.test(x);
  if (c.kind !== ":awai-compute-offer" || c.target !== "awai-compute"
      || c.wording !== ":provide" || c["value-class"] !== ":devnet" || c.route !== ":en-devnet"
      || !Number.isSafeInteger(c.amount) || c.amount <= 0
      || !did(c.provider) || !did(c.consumer)
      || typeof c["chain-id"] !== "string" || !c["chain-id"].startsWith("awai-en-devnet/")
      || !/^compute-[0-9a-f]{24}$/.test(c["order-id"]) || !Number.isSafeInteger(c["expires-ms"])) {
    throw new Error("invalid-compute-offer");
  }
  return {
    provider: c.provider, consumer: c.consumer, amount: c.amount, chainId: c["chain-id"],
    orderId: c["order-id"], expiresMs: c["expires-ms"], purpose: Array.isArray(c.purpose) ? c.purpose : [],
  };
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The provider signs this exact payload, once, for this offer text.
export async function offerPayload(offerText) {
  return `${OFFER_KIND}\noffer-sha256=${await sha256Hex(offerText)}\ndecision=offer`;
}

const b64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

// Sign only after the person approved this offer on screen.
export async function signOffer(keyPair, offerText) {
  const payload = await offerPayload(offerText);
  return signPayload(keyPair, payload);
}

// The funding transfer is signed over the exact payload bytes the desk issued
// (the EN devnet signing payload). The phone signs those bytes as-is.
export async function signFundingPayload(keyPair, payloadText) {
  return signPayload(keyPair, payloadText);
}

async function signPayload(keyPair, payload) {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey,
    new TextEncoder().encode(payload));
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  return { payload, sig: b64(sig), spki: b64(spki) };
}

// The provider key: P-256, private key not extractable, kept in this app's IndexedDB.
// Separate from the acceptor key held by the desk host and from the device identity key.
export async function providerKey() {
  const DB = "awai-compute";
  const STORE = "keys";
  const KEY_ID = "provider";
  const idb = (action) => new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = action(open.result.transaction(STORE, "readwrite").objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
  let pair = await idb((store) => store.get(KEY_ID));
  if (pair?.privateKey?.extractable === false) return pair;
  pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  await idb((store) => store.put(pair, KEY_ID));
  return pair;
}

export async function prepareCompute(broker, deskOrigin, providerDid, ttlMs) {
  if (ttlMs !== undefined
      && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 86400000)) throw new Error("invalid-compute-ttl-offer-too-long");
  const body = { provider: providerDid, ...(ttlMs !== undefined ? { "ttl-ms": ttlMs } : {}) };
  const r = await broker.invoke(selector("prepare-compute"),
    { input: `${deskOrigin}/v1/compute/offers`, init: json(body) });
  const v = await r.json();
  if (!r.ok || typeof v["offer-text"] !== "string" || typeof v["funding-payload"] !== "string")
    throw new Error("compute-offer-unavailable");
  const offer = parseOffer(v["offer-text"]);
  if (offer.orderId !== v["order-id"]) throw new Error("invalid-compute-offer");
  return { offerText: v["offer-text"], offer, fundingPayload: v["funding-payload"] };
}

// Returns {finalized} or throws; a missing answer is reported as unknown and never resent.
// offerSignature and fundingSignature are both made on the provider key; the desk verifies
// each against the enrolled provider SPKI before it signs as the acceptor and submits once.
// The prompt travels to the engine through the desk and never enters the receipt.
export async function runCompute(broker, deskOrigin, offerText, offerSignature, fundingSignature, prompt) {
  const offer = parseOffer(offerText);
  if (typeof prompt !== "string" || prompt.length === 0
      || new TextEncoder().encode(prompt).length > 8192) throw new Error("invalid-compute-prompt");
  let r;
  try {
    r = await broker.invoke(selector("run-compute"), {
      input: `${deskOrigin}/v1/compute/orders`,
      init: json({ "order-id": offer.orderId, "offer-text": offerText,
                  offer: offerSignature, "funding-signature": fundingSignature, prompt }),
    });
  } catch (error) {
    if (/not approved|cancelled/.test(error?.message ?? "")) throw error;
    const unknown = new Error("compute-outcome-unknown"); unknown.unknown = true; throw unknown;
  }
  const v = await r.json().catch(() => ({}));
  if (r.ok && v.finalized === true && v["transfer-id"] === offer.orderId) {
    return { finalized: true, height: v.height, orderId: offer.orderId };
  }
  if (v.ambiguous) { const unknown = new Error("compute-outcome-unknown"); unknown.unknown = true; throw unknown; }
  const refused = new Error("compute-refused"); refused.cause = v.cause ?? `http-${r.status}`; throw refused;
}

export async function readWorkReceipt(broker, deskOrigin, orderId) {
  if (!/^compute-[0-9a-f]{24}$/.test(orderId)) throw new Error("invalid-compute-order");
  const r = await broker.invoke(selector("read-work-receipt"),
    { input: `${deskOrigin}/v1/compute/receipts/${orderId}`, init: { method: "GET" } });
  const v = await r.json();
  if (!r.ok) throw new Error("compute-receipt-unavailable");
  if (v.received !== true) return { received: false, cause: v.cause ?? "unknown" };
  if (v["order-id"] !== orderId || v["value-class"] !== ":devnet"
      || !Number.isSafeInteger(v.amount)) {
    throw new Error("invalid-work-receipt");
  }
  const wr = v["work-receipt"];
  if (!wr || wr.kind !== ":work-receipt"
      || typeof wr.input !== "string" || !/^sha256:[0-9a-f]{64}$/.test(wr.input)
      || typeof wr.output !== "string" || !/^b[a-z2-7]{50,80}$/.test(wr.output)
      || !wr.measured || !Number.isSafeInteger(wr.measured["prompt-tokens"])
      || !Number.isSafeInteger(wr.measured["completion-tokens"])
      || "prompt" in wr || "output-text" in wr) {
    throw new Error("invalid-work-receipt");
  }
  return { received: true, orderId, height: v.height, amount: v.amount, finality: v.finality,
           input: wr.input, output: wr.output, measured: wr.measured, engineCalls: v["engine-calls"] };
}
