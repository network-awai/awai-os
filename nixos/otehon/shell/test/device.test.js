import assert from "node:assert/strict";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { clearSession, loadSession, saveSession } from "../src/identity/device.js";
import { createLinkRequest, p256Did, SESSION_MS } from "../src/identity/link.js";
import { randomWallet, walletResponse } from "./signers.js";

test("loading a link never destroys account state; only explicit logout clears it", async () => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  try {
    const now = Date.now();
    const did = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));
    const other = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));
    const { request } = await createLinkRequest(did, now);
    const response = walletResponse(randomWallet(), request, now);
    saveSession(request, response);
    const saved = values.get("otehon.account.v1");
    values.set("otehon.proofs.v1", '{"fixture":"retained"}');

    assert.ok(loadSession(did, now)?.accountDid);
    assert.equal(loadSession(other, now), null);
    assert.equal(values.get("otehon.account.v1"), saved);
    assert.equal(values.get("otehon.proofs.v1"), '{"fixture":"retained"}');
    assert.ok(loadSession(did, now)?.accountDid);
    assert.equal(loadSession(did, now + SESSION_MS + 1), null);
    assert.equal(values.get("otehon.account.v1"), saved);

    values.set("otehon.account.v1", "malformed fixture");
    assert.equal(loadSession(did, now), null);
    assert.equal(values.get("otehon.account.v1"), "malformed fixture");
    clearSession();
    assert.equal(values.has("otehon.account.v1"), false);
    assert.equal(values.has("otehon.proofs.v1"), false);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
