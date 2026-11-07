import assert from "node:assert/strict";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { p256Did, siweMessage } from "../src/identity/link.js";
import { clearLock, loadLock, newLock, saveLock, unlockMessage, verifyUnlock } from "../src/identity/lock.js";
import { randomWallet, signPersonal } from "./signers.js";

const NOW = Date.parse("2026-11-07T00:00:00.000Z");
const DEVICE = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));
const wallet = randomWallet();
const account = `did:pkh:eip155:1:${wallet.address}`;

const messageFor = (lock) =>
  unlockMessage({ address: wallet.address, device: lock.device, nonce: lock.nonce, issuedAt: lock.issuedAt });
const refuses = (reason, lock, signature) =>
  assert.throws(() => verifyUnlock(lock, signature), new RegExp(`^Error: ${reason}$`));

test("the account's own signature over this lock's message unlocks", () => {
  const lock = newLock(account, DEVICE, NOW);
  assert.doesNotThrow(() => verifyUnlock(lock, signPersonal(wallet, messageFor(lock))));
});

test("another key, another lock, a sign-in message and junk are refused", () => {
  const lock = newLock(account, DEVICE, NOW);
  refuses("wrong-signer", lock, signPersonal(randomWallet(), messageFor(lock)));
  // A signature for an earlier lock has another nonce.
  const earlier = newLock(account, DEVICE, NOW - 1000);
  assert.notEqual(earlier.nonce, lock.nonce);
  refuses("wrong-signer", lock, signPersonal(wallet, messageFor(earlier)));
  // A sign-in signature for the same nonce does not unlock.
  const signIn = siweMessage({
    address: wallet.address,
    chainId: 1,
    device: DEVICE,
    nonce: lock.nonce,
    issuedAt: lock.issuedAt,
    expiresAt: lock.issuedAt,
  });
  refuses("wrong-signer", lock, signPersonal(wallet, signIn));
  refuses("invalid-signature", lock, "0x1234");
  refuses("invalid-signature", lock, undefined);
});

test("a passkey account cannot unlock with a signature", () => {
  const lock = newLock(DEVICE, DEVICE, NOW);
  refuses("no-wallet-account", lock, signPersonal(wallet, messageFor(lock)));
});

test("the lock survives storage and an edited record is not a lock", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  assert.equal(loadLock(storage), null);
  const lock = newLock(account, DEVICE, NOW);
  saveLock(lock, storage);
  assert.deepEqual(loadLock(storage), lock);
  clearLock(storage);
  assert.equal(loadLock(storage), null);
});
