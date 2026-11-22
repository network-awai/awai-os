// AWAI-3115: drive the compute desk with the shell's own client module
// (otehon/shell/src/awai-compute.js). The broker here is a plain fetch; on the
// device the shared consent broker sits in its place. Keys are ephemeral
// in-memory P-256 pairs; nothing private is written anywhere.
// usage: NODE_EXTRA_CA_CERTS=CA.pem node test/desk_client.mjs STACK.json OUT.json
import { readFileSync, writeFileSync } from "node:fs";
import { parseOffer, prepareCompute, readWorkReceipt, runCompute, signFundingPayload, signOffer,
  computeOperations } from "../../../otehon/shell/src/awai-compute.js";

const stack = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = process.argv[3];
const { desk, desk2, node, provider } = stack;
const origin = "https://tauri.localhost";
const broker = { invoke: async (_selector, { input, init }) => {
  const r = await fetch(input, { ...init, headers: { ...(init.headers ?? {}), origin } });
  return { ok: r.ok, status: r.status, json: async () => JSON.parse(await r.text().catch(() => "")) };
} };
// prepareCompute posts {provider}; the fetch broker above adds the origin header.
const brokerP = { invoke: async (sel, req) => {
  if (sel.operation === "prepare-compute") {
    req = { ...req, init: { ...req.init, body: JSON.stringify({ provider }) } };
  }
  return broker.invoke(sel, req);
} };
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ check: name, passed: !!ok, detail: String(detail) }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : detail}`); };
const height = async () => (await (await fetch(`${node}/v1/head`)).json()).height;
const post = (path, body, o = origin, d = desk) => fetch(`${d}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: o }, body: JSON.stringify(body) });
const key = () => crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
const publicSpki = async (pair) => {
  const b = await crypto.subtle.exportKey("spki", pair.publicKey);
  return Buffer.from(b).toString("base64");
};
const PROMPT = "Write one short sentence saying hello.";
let engineCalls = 0;

check("three declared operations on the desk origin", computeOperations(desk).length === 3 && computeOperations("").length === 0);
check("invalid origin throws", (() => { try { computeOperations("http://localhost:1"); return false; } catch { return true; } })());

const h0 = await height();
const a = await prepareCompute(brokerP, desk);
check("offer names the provider on devnet", a.offer.provider === provider && a.offer.amount === 1, JSON.stringify(a.offer));
check("preparing an offer sends nothing to the node", (await height()) === h0);

const device = await key();
const offerSig = await signOffer(device, a.offerText);
const fundSig = await signFundingPayload(device, a.fundingPayload);

// -- negative controls -------------------------------------------------------
let r = await post("/v1/compute/orders", { "order-id": a.offer.orderId, "offer-text": a.offerText, prompt: PROMPT });
check("no signatures: refused, nothing sent", r.status === 403 && (await r.json()).cause === ":offer-missing" && (await height()) === h0, r.status);

r = await post("/v1/compute/orders", { "order-id": a.offer.orderId, "offer-text": a.offerText, offer: offerSig, "funding-signature": fundSig });
check("no prompt: refused, nothing sent", r.status === 400 && (await r.json()).cause === ":bad-prompt" && (await height()) === h0, r.status);

const b = await prepareCompute(brokerP, desk);
const forOther = await signOffer(device, b.offerText);
r = await post("/v1/compute/orders", { "order-id": a.offer.orderId, "offer-text": a.offerText, offer: forOther, "funding-signature": fundSig, prompt: PROMPT });
check("an offer signature of another offer text: refused", r.status === 403 && (await r.json()).cause === ":offer-for-other-content" && (await height()) === h0, r.status);

const changed = a.offerText.replace('"amount":1', '"amount":2');
r = await post("/v1/compute/orders", { "order-id": a.offer.orderId, "offer-text": changed, offer: await signOffer(device, changed), "funding-signature": fundSig, prompt: PROMPT });
check("a tampered offer text: refused", r.status === 409 && (await r.json()).cause === ":offer-changed" && (await height()) === h0, r.status);

const forged = await signOffer(await key(), a.offerText);
forged.spki = offerSig.spki;
r = await post("/v1/compute/orders", { "order-id": a.offer.orderId, "offer-text": a.offerText, offer: forged, "funding-signature": fundSig, prompt: PROMPT });
check("a signature by another key under this key's name: refused", r.status === 403 && (await r.json()).cause === ":offer-signature-invalid" && (await height()) === h0, r.status);

r = await post("/v1/compute/offers", { provider }, "https://evil.example");
check("a reply from another web origin: refused, no send", r.status === 403 && (await height()) === h0, r.status);

// expired offer: short-TTL desk, wait past the TTL.
const e = await prepareCompute(brokerP, desk2);
await new Promise((res) => setTimeout(res, 300));
r = await post("/v1/compute/orders", { "order-id": e.offer.orderId, "offer-text": e.offerText,
  offer: await signOffer(device, e.offerText),
  "funding-signature": await signFundingPayload(device, e.fundingPayload), prompt: PROMPT }, origin, desk2);
check("an expired offer: refused, nothing sent", r.status === 409 && (await r.json()).cause === ":expired" && (await height()) === h0, r.status);

// ADR 0051 D5 boundary: exactly 24h is accepted; 24h + 1ms is refused.
const DAY = 86400000;
r = await post("/v1/compute/offers", { provider, "ttl-ms": DAY });
const dayOk = r.status === 200 && (await r.json())["offer-text"];
check("an offer of exactly 24h: accepted", !!dayOk, r.status);
r = await post("/v1/compute/offers", { provider, "ttl-ms": DAY + 1 });
check("an offer 1ms over 24h: refused, nothing sent", r.status === 400 && (await r.json()).cause === ":offer-too-long" && (await height()) === h0, r.status);
let ttlThrew = false; try { await prepareCompute(broker, desk, provider, DAY + 1); } catch { ttlThrew = true; }
check("the client itself refuses a lifetime over 24h", ttlThrew);

// -- happy path --------------------------------------------------------------
const sent = await runCompute(brokerP, desk, a.offerText, offerSig, fundSig, PROMPT);
check("the approved order finalizes", sent.finalized === true && sent.orderId === a.offer.orderId, JSON.stringify(sent));
check("exactly one transfer reached the node", (await height()) === h0 + 1, await height());
const receipt = await readWorkReceipt(brokerP, desk, a.offer.orderId);
check("the work receipt reads back with hashes and counters", receipt.received === true && /^sha256:[0-9a-f]{64}$/.test(receipt.input) && typeof receipt.output === "string" && receipt.measured["completion-tokens"] > 0, JSON.stringify(receipt));
engineCalls = receipt.engineCalls;
check("the receipt carries no prompt or output text", !JSON.stringify(receipt).includes(PROMPT));

// duplicate order CID: the engine must not run again.
r = await post("/v1/compute/orders", { "order-id": a.offer.orderId, "offer-text": a.offerText, offer: offerSig, "funding-signature": fundSig, prompt: PROMPT });
check("the same order cannot be run twice", r.status === 409 && (await r.json()).cause === ":already-submitted" && (await height()) === h0 + 1, r.status);
const receipt2 = await readWorkReceipt(brokerP, desk, a.offer.orderId);
check("the engine ran at most once for this order", receipt2.engineCalls === 1 && receipt2.output === receipt.output, `engineCalls=${receipt2.engineCalls}`);

// wrong provider key pair: a fresh key after enrollment is refused.
const c = await prepareCompute(brokerP, desk);
const stranger = await key();
r = await post("/v1/compute/orders", { "order-id": c.offer.orderId, "offer-text": c.offerText,
  offer: await signOffer(stranger, c.offerText),
  "funding-signature": await signFundingPayload(stranger, c.fundingPayload), prompt: PROMPT });
check("another provider key pair after enrollment: refused", r.status === 403 && (await r.json()).cause === ":offer-key-not-enrolled" && (await height()) === h0 + 1, r.status);

let threw = false; try { parseOffer(a.offerText.replace('":devnet"', '":live"')); } catch { threw = true; }
check("the client refuses an offer that is not devnet", threw);

const passed = checks.filter((x) => x.passed).length;
writeFileSync(out, JSON.stringify({ checks, passed, total: checks.length, receipt, provider, providerSpki: await publicSpki(device), strangerSpki: await publicSpki(stranger) }, null, 2));
console.log(`${passed} of ${checks.length} checks`);
process.exit(passed === checks.length ? 0 : 1);
