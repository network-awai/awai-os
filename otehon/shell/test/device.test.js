import assert from "node:assert/strict";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { createLinkRequest, p256Did, SESSION_MS } from "../src/identity/link.js";
import { clearSession, saveSession, loadSession, sessionRetention,verifyDeviceKeyPair } from "../src/identity/device.js";
import { issueHostAccountProof, verifyHostAccountProof } from "../src/identity/host-account.js";
import { passkeyResponse, randomWallet, walletResponse } from "./signers.js";

test("restored identity requires possession of the matching non-exportable device key", async()=>{
  const generate=()=>crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const pair=await generate(),other=await generate();
  await verifyDeviceKeyPair(pair);
  await assert.rejects(verifyDeviceKeyPair({publicKey:pair.publicKey}),/device-key-unavailable/);
  await assert.rejects(verifyDeviceKeyPair({privateKey:other.privateKey,publicKey:pair.publicKey}),/device-key-mismatch/);
  const exportable=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign"]);
  await assert.rejects(verifyDeviceKeyPair(exportable),/device-key-unavailable/);
});

function storage(t, protection, transactions = {}) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousDatabase = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const data = new Map();
  const records = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: protection } });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    open: () => {
      const open = { result: {
        close() {},
        transaction(_store, _mode, options) {
          const transaction = { objectStore: () => ({
            get: key => request(key),
            put: (value, key) => request(key, value),
          }) };
          function request(key, value) {
            const request = {};
            queueMicrotask(() => {
              if (value === undefined) request.result = records.get(key);
              else {
                assert.equal(options.durability, "strict");
                if (transactions.abortWrite) { transaction.onabort(); return; }
                records.set(key, structuredClone(value));
              }
              transaction.oncomplete();
            });
            return request;
          }
          return transaction;
        },
      } };
      queueMicrotask(() => open.onsuccess());
      return open;
    },
  } });
  t.after(() => {
    for (const [key, previous] of [["localStorage", previousStorage], ["navigator", previousNavigator],
      ["indexedDB", previousDatabase]]) {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    }
  });
  return data;
}

test("saved passkey proof restores after QR expiry but refuses session expiry and tampering", async t => {
  const data = storage(t);
  const now = Date.parse("2026-11-13T06:00:00Z");
  const did = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));
  const { request } = await createLinkRequest(did, now);
  const response = passkeyResponse(p256.utils.randomSecretKey(), request, now);
  data.set("otehon.account.v1", JSON.stringify({ request, response }));
  const saved = data.get("otehon.account.v1");
  assert.equal((await loadSession(did, now + SESSION_MS - 1)).method, "passkey");
  assert.equal(await loadSession(did, now + SESSION_MS + 1), null);
  assert.equal(data.get("otehon.account.v1"), saved);
  data.set("otehon.account.v1", saved);
  const modified = JSON.parse(saved);
  modified.response.expiresAt = new Date(now + SESSION_MS * 2).toISOString();
  data.set("otehon.account.v1", JSON.stringify(modified));
  assert.equal(await loadSession(did, now), null);
});

test("storage protection is requested explicitly and never extends the stored proof", async t => {
  let calls = 0;
  const data = storage(t, { persisted: async () => false, persist: async () => { calls++; return true; } });
  data.set("otehon.account.v1", JSON.stringify({ request: {}, response: {} }));
  const before = data.get("otehon.account.v1");
  assert.deepEqual(await sessionRetention(), { saved: true, persistent: false });
  assert.equal(calls, 0);
  assert.deepEqual(await sessionRetention(true), { saved: true, persistent: true });
  assert.equal(calls, 1);
  assert.equal(data.get("otehon.account.v1"), before);
});

test("unsupported and refused storage protection stay visible", async t => {
  storage(t, { persisted: async () => false, persist: async () => false });
  assert.deepEqual(await sessionRetention(true), { saved: false, persistent: false });
  globalThis.navigator.storage = undefined;
  assert.deepEqual(await sessionRetention(true), { saved: false, persistent: null });
});

test("session storage waits for writes and sign-out supersedes stale legacy data", async t => {
  const transactions = {};
  const values = storage(t, undefined, transactions);
  const now = Date.now();
  const did = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));
  const other = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));
  const { request } = await createLinkRequest(did, now);
  const response = walletResponse(randomWallet(), request, now);
  const saved = JSON.stringify({ request, response });
  values.set("otehon.account.v1", "malformed fixture");
  assert.equal(await loadSession(did, now), null);
  assert.equal(values.get("otehon.account.v1"), "malformed fixture");

  transactions.abortWrite = true;
  await assert.rejects(saveSession(request, response), /account-session-transaction-aborted/);
  assert.equal(values.get("otehon.account.v1"), "malformed fixture");
  transactions.abortWrite = false;
  await saveSession(request, response);
  assert.equal(values.has("otehon.account.v1"), false);
  values.set("otehon.proofs.v1", '{"fixture":"retained"}');
  assert.ok((await loadSession(did, now))?.accountDid);
  assert.equal(await loadSession(other, now), null);
  assert.equal(await loadSession(did, now + SESSION_MS + 1), null);
  assert.equal(values.get("otehon.proofs.v1"), '{"fixture":"retained"}');
  assert.ok((await loadSession(did, now))?.accountDid);

  transactions.abortWrite = true;
  await assert.rejects(clearSession(), /account-session-transaction-aborted/);
  assert.ok((await loadSession(did, now))?.accountDid);
  transactions.abortWrite = false;
  await clearSession();
  assert.equal(values.has("otehon.proofs.v1"), false);
  values.set("otehon.account.v1", saved);
  assert.equal(await loadSession(did, now), null);
});


test("host account proofs are short-lived and bound to the Itonami caller and fresh nonce", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Date.now();
  const app = "network.itonami.app";
  const nonce = crypto.randomUUID();
  const uid = 10172;
  const accountDid = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));
  const expiresAt = new Date(now + 10_000).toISOString();
  const session = { accountDid, method: "passkey", expiresAt };
  const request = { app, uid, nonce };
  const proof = await issueHostAccountProof(pair, session, request, now);

  assert.deepEqual(await verifyHostAccountProof(proof, nonce, uid, now), session);
  assert.deepEqual(Object.keys(proof).sort(), ["claim", "key", "schema", "signature"]);
  await assert.rejects(verifyHostAccountProof(proof, crypto.randomUUID(), uid, now));
  await assert.rejects(verifyHostAccountProof(proof, nonce, uid + 100_000, now));
  await assert.rejects(verifyHostAccountProof(proof, nonce, uid, now + 10_000));
  await assert.rejects(verifyHostAccountProof({ ...proof, claim: { ...proof.claim, app: "other.app" } }, nonce, uid, now));
  await assert.rejects(verifyHostAccountProof({ ...proof, claim: { ...proof.claim,
    accountDid: p256Did(p256.getPublicKey(p256.utils.randomSecretKey())) } }, nonce, uid, now), /invalid-host-account-signature/);
  await assert.rejects(issueHostAccountProof(pair, session, { ...request, app: "other.app" }, now));
});
