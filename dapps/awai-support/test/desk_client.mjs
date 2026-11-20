// AWAI-3170: drive the support desk with the shell's own client module (otehon/shell/src/awai-support.js).
// The broker here is a plain fetch; on the device the shared consent broker sits in its place.
// usage: NODE_EXTRA_CA_CERTS=CA.pem node test/desk_client.mjs DESK-ORIGIN NODE-URL ORIGIN OUT.json
import { writeFileSync } from "node:fs";
import { approvalPayload, parseCard, prepareSupport, readReceipt, sendSupport, signApproval, supportOperations }
  from "../../../otehon/shell/src/awai-support.js";

const [desk, node, origin, out] = process.argv.slice(2);
const broker = { invoke: (_selector, { input, init }) => fetch(input, { ...init, headers: { ...(init.headers ?? {}), origin } }) };
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ check: name, passed: !!ok, detail: String(detail) }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : detail}`); };
const height = async () => (await (await fetch(`${node}/v1/head`)).json()).height;
const post = (path, body, o = origin) => fetch(`${desk}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: o }, body: JSON.stringify(body) });
const key = () => crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

check("three declared operations on the desk origin", supportOperations(desk).length === 3 && supportOperations("").length === 0);

const h0 = await height();
const a = await prepareSupport(broker, desk, 1);
check("the card names Awai Network LLC on devnet", a.card.recipient === "Awai Network LLC" && a.card.amount === 1, JSON.stringify(a.card));
check("preparing a card sends nothing to the node", (await height()) === h0);

let r = await post("/v1/support/funds", { "transfer-id": a.card.transferId, "card-text": a.cardText });
check("no approval: refused", r.status === 403 && (await r.json()).cause === ":approval-missing", r.status);

const device = await key();
const b = await prepareSupport(broker, desk, 1);
const forOther = await signApproval(device, b.cardText);
r = await post("/v1/support/funds", { "transfer-id": a.card.transferId, "card-text": a.cardText, approval: forOther });
check("an approval of another card: refused", r.status === 403 && (await r.json()).cause === ":approval-for-other-content", r.status);

const changed = a.cardText.replace('"amount":1', '"amount":2');
r = await post("/v1/support/funds", { "transfer-id": a.card.transferId, "card-text": changed, approval: await signApproval(device, changed) });
check("a changed card text: refused", r.status === 409 && (await r.json()).cause === ":card-changed", r.status);

const forged = await signApproval(await key(), a.cardText);
forged.spki = (await signApproval(device, a.cardText)).spki;
r = await post("/v1/support/funds", { "transfer-id": a.card.transferId, "card-text": a.cardText, approval: forged });
check("a signature by another key under this key's name: refused", r.status === 403 && (await r.json()).cause === ":approval-signature-invalid", r.status);
check("the node is unchanged after every refusal", (await height()) === h0);

const sent = await sendSupport(broker, desk, a.cardText, await signApproval(device, a.cardText));
check("the approved support finalizes", sent.finalized === true && sent.transferId === a.card.transferId, JSON.stringify(sent));
const receipt = await readReceipt(broker, desk, a.card.transferId);
check("the bot's balance and journal read back as received", receipt.received === true && receipt.amount === 1, JSON.stringify(receipt));

r = await post("/v1/support/funds", { "transfer-id": a.card.transferId, "card-text": a.cardText, approval: await signApproval(device, a.cardText) });
check("the same support cannot be sent twice", r.status === 409 && (await r.json()).cause === ":already-submitted", r.status);

const c = await prepareSupport(broker, desk, 1);
r = await post("/v1/support/funds", { "transfer-id": c.card.transferId, "card-text": c.cardText, approval: await signApproval(await key(), c.cardText) });
check("another device's approval key is not enrolled", r.status === 403 && (await r.json()).cause === ":approval-key-not-enrolled", r.status);

r = await post("/v1/support/cards", { amount: 1 }, "https://evil.example");
check("another web origin is refused", r.status === 403, r.status);
check("exactly one transfer reached the node", (await height()) === h0 + 1);
check("the payload binds the card hash", (await approvalPayload(a.cardText)).startsWith("awai.support.approval/1\ncard-sha256="));
let threw = false; try { parseCard(a.cardText.replace('":devnet"', '":live"')); } catch { threw = true; }
check("the client refuses a card that is not devnet", threw);

const passed = checks.filter((x) => x.passed).length;
writeFileSync(out, JSON.stringify({ checks, passed, total: checks.length, receipt }, null, 2));
console.log(`${passed} of ${checks.length} checks`);
process.exit(passed === checks.length ? 0 : 1);
