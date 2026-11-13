import assert from "node:assert/strict";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { createLinkRequest, p256Did, SESSION_MS } from "../src/identity/link.js";
import { saveSession, loadSession, sessionRetention } from "../src/identity/device.js";
import { passkeyResponse } from "./signers.js";

function storage(t, protection) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const data = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: protection } });
  t.after(() => {
    for (const [key, previous] of [["localStorage", previousStorage], ["navigator", previousNavigator]]) {
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
  saveSession(request, response);
  const saved = data.get("otehon.account.v1");
  assert.equal(loadSession(did, now + SESSION_MS - 1).method, "passkey");
  assert.equal(loadSession(did, now + SESSION_MS + 1), null);
  assert.equal(data.has("otehon.account.v1"), false);
  data.set("otehon.account.v1", saved);
  const modified = JSON.parse(saved);
  modified.response.expiresAt = new Date(now + SESSION_MS * 2).toISOString();
  data.set("otehon.account.v1", JSON.stringify(modified));
  assert.equal(loadSession(did, now), null);
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
