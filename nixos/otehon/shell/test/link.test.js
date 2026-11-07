import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  LINK_ORIGIN,
  SESSION_MS,
  confirmationCode,
  createLinkRequest,
  linkUrl,
  openResponse,
  p256Did,
  parseLinkFragment,
  sealResponse,
  verifyLink,
} from "../src/identity/link.js";
import { signWithProvider } from "../src/identity/wallet.js";
import { passkeyResponse, randomWallet, signPersonal, walletResponse } from "./signers.js";

const NOW = Date.parse("2026-11-07T00:00:00.000Z");
const DEVICE = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));
const OTHER_DEVICE = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));

const rejects = (reason, input) =>
  assert.throws(() => verifyLink({ deviceDid: DEVICE, now: NOW, ...input }), new RegExp(`^Error: ${reason}$`));

test("the runtime is the pinned copy of the shared broker", () => {
  const pins = JSON.parse(readFileSync(new URL("../vendor/PINS.json", import.meta.url)));
  for (const [file, digest] of Object.entries(pins.files)) {
    const bytes = readFileSync(new URL(`../vendor/${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), digest);
  }
});

test("a request survives the QR link and both screens get the same code", async () => {
  const { request } = await createLinkRequest(DEVICE, NOW);
  const url = linkUrl(request);
  assert.ok(url.startsWith(`${LINK_ORIGIN}/link/#`));
  const parsed = parseLinkFragment(url.split("#")[1], NOW);
  assert.deepEqual(parsed, request);
  assert.equal(confirmationCode(parsed), confirmationCode(request));
});

test("an expired or malformed request is refused", async () => {
  const { request } = await createLinkRequest(DEVICE, NOW);
  const fragment = linkUrl(request).split("#")[1];
  assert.throws(() => parseLinkFragment(fragment, NOW + SESSION_MS), /request-expired/);
  assert.throws(() => parseLinkFragment("not-json", NOW), /invalid-request/);
});

test("only the requesting device can open the sealed answer", async () => {
  const { request, privateKey } = await createLinkRequest(DEVICE, NOW);
  const other = await createLinkRequest(DEVICE, NOW);
  const sealed = await sealResponse(request, { method: "wallet" });
  assert.deepEqual(await openResponse(request, privateKey, sealed), { method: "wallet" });
  await assert.rejects(openResponse(request, other.privateKey, sealed), /cannot-decrypt/);
  assert.ok(!Buffer.from(sealed, "base64url").toString().includes("wallet"));
});

test("a wallet signature links the device to did:pkh", async () => {
  const wallet = randomWallet();
  const { request } = await createLinkRequest(DEVICE, NOW);
  const result = verifyLink({ request, response: walletResponse(wallet, request, NOW), deviceDid: DEVICE, now: NOW });
  assert.equal(result.accountDid, `did:pkh:eip155:1:${wallet.address}`);
});

test("a wallet signature with v 27 or 28 is accepted", async () => {
  const wallet = randomWallet();
  const { request } = await createLinkRequest(DEVICE, NOW);
  const response = walletResponse(wallet, request, NOW, { legacyV: true });
  assert.ok(verifyLink({ request, response, deviceDid: DEVICE, now: NOW }).accountDid);
});

test("two devices link to the same account", async () => {
  const wallet = randomWallet();
  const first = await createLinkRequest(DEVICE, NOW);
  const second = await createLinkRequest(OTHER_DEVICE, NOW);
  const a = verifyLink({ request: first.request, response: walletResponse(wallet, first.request, NOW), deviceDid: DEVICE, now: NOW });
  const b = verifyLink({ request: second.request, response: walletResponse(wallet, second.request, NOW), deviceDid: OTHER_DEVICE, now: NOW });
  assert.equal(a.accountDid, b.accountDid);
});

test("wallet refusals", async () => {
  const wallet = randomWallet();
  const { request } = await createLinkRequest(DEVICE, NOW);
  const good = walletResponse(wallet, request, NOW);
  const other = await createLinkRequest(DEVICE, NOW);

  rejects("wrong-signer", { request, response: { ...good, address: randomWallet().address } });
  rejects("wrong-signer", { request: other.request, response: good });
  rejects("wrong-device", { request, response: good, deviceDid: OTHER_DEVICE });
  rejects("invalid-address", { request, response: { ...good, address: good.address.toLowerCase().replace("0x", "0X") } });
  rejects("invalid-signature", { request, response: { ...good, signature: "0x00" } });
  rejects("session-expired", { request, response: good, now: NOW + SESSION_MS + 1 });
  rejects("request-expired", { request, response: good, now: NOW + 11 * 60 * 1000 });
  rejects("session-too-long", { request, response: walletResponse(wallet, request, NOW, { lifetime: SESSION_MS * 2 }) });
  rejects("unknown-method", { request, response: { ...good, method: "password" } });
});

test("a stored link stays valid after the request window and until its expiry", async () => {
  const wallet = randomWallet();
  const { request } = await createLinkRequest(DEVICE, NOW);
  const response = walletResponse(wallet, request, NOW);
  const later = NOW + 24 * 60 * 60 * 1000;
  assert.ok(verifyLink({ request, response, deviceDid: DEVICE, now: later, atLink: false }).accountDid);
});

test("a passkey assertion links the device to did:key", async () => {
  const secret = p256.utils.randomSecretKey();
  const { request } = await createLinkRequest(DEVICE, NOW);
  const result = verifyLink({ request, response: passkeyResponse(secret, request, NOW), deviceDid: DEVICE, now: NOW });
  assert.equal(result.accountDid, p256Did(p256.getPublicKey(secret)));
});

test("passkey refusals", async () => {
  const secret = p256.utils.randomSecretKey();
  const { request } = await createLinkRequest(DEVICE, NOW);
  const other = await createLinkRequest(DEVICE, NOW);
  const sign = (options) => passkeyResponse(secret, request, NOW, options);

  rejects("wrong-origin", { request, response: sign({ origin: "https://evil.example" }) });
  rejects("wrong-ceremony", { request, response: sign({ type: "webauthn.create" }) });
  rejects("wrong-rp", { request, response: sign({ rpId: "evil.example" }) });
  rejects("no-user-verification", { request, response: sign({ flags: 0x01 }) });
  rejects("wrong-challenge", { request: other.request, response: sign() });
  rejects("invalid-signature", {
    request,
    response: { ...sign(), publicKey: Buffer.from(p256.getPublicKey(p256.utils.randomSecretKey())).toString("base64url") },
  });
});

test("an EIP-1193 wallet on this device signs a verifiable link", async () => {
  const wallet = randomWallet();
  const { request } = await createLinkRequest(DEVICE);
  const provider = {
    async request({ method, params }) {
      if (method === "eth_requestAccounts") return [wallet.address.toLowerCase()];
      if (method === "eth_chainId") return "0x1";
      assert.equal(method, "personal_sign");
      return signPersonal(wallet, Buffer.from(params[0].slice(2), "hex").toString());
    },
  };
  const response = await signWithProvider(provider, request);
  const result = verifyLink({ request, response, deviceDid: DEVICE });
  assert.equal(result.accountDid, `did:pkh:eip155:1:${wallet.address}`);
});
