// The screen lock (docs/otehon/protection-0.1.0.md). It is a browser-level lock: it stops the
// shell from rendering the apps, and nothing more. Anyone with root, or with the DevTools port,
// can read the profile or change this state.
import { RP_ID, recoverAddress } from "./link.js";
import { accountAddress } from "../trust.js";

const LOCK_KEY = "otehon.lock.v1";
const UNLOCKED_KEY = "otehon.unlocked.v1";

const randomHex = (size) =>
  Array.from(crypto.getRandomValues(new Uint8Array(size)), (byte) => byte.toString(16).padStart(2, "0")).join("");

// A message of its own, so a sign-in signature cannot be replayed as an unlock, or the reverse.
export function unlockMessage({ address, device, nonce, issuedAt }) {
  return [
    `${RP_ID} wants you to unlock this device with your Ethereum account:`,
    address,
    "",
    `Unlock Awai Otehon device: ${device}`,
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export function newLock(accountDid, device, now = Date.now()) {
  return { v: 1, accountDid, device, nonce: randomHex(12), issuedAt: new Date(now).toISOString() };
}

// Throws with a reason, or returns normally when the signature opens this lock.
export function verifyUnlock(lock, signature) {
  const address = accountAddress(lock?.accountDid);
  if (!address) throw new Error("no-wallet-account");
  const message = unlockMessage({ address, device: lock.device, nonce: lock.nonce, issuedAt: lock.issuedAt });
  if (recoverAddress(message, typeof signature === "string" ? signature.trim() : signature) !== address) {
    throw new Error("wrong-signer");
  }
}

export function loadLock(storage = localStorage) {
  try {
    const lock = JSON.parse(storage.getItem(LOCK_KEY));
    return lock && lock.v === 1 && typeof lock.accountDid === "string" ? lock : null;
  } catch {
    return null;
  }
}

export function saveLock(lock, storage = localStorage) {
  storage.setItem(LOCK_KEY, JSON.stringify(lock));
}

export function clearLock(storage = localStorage) {
  storage.removeItem(LOCK_KEY);
}

// sessionStorage survives a reload but not a new browser, so a reboot starts locked.
export function markUnlocked(storage = sessionStorage) {
  try {
    storage.setItem(UNLOCKED_KEY, "1");
  } catch {
    // Without it the next load starts locked, which is the safe side.
  }
}

export function markLocked(storage = sessionStorage) {
  try {
    storage.removeItem(UNLOCKED_KEY);
  } catch {
    // Nothing to remove.
  }
}

export function unlockedThisSession(storage = sessionStorage) {
  try {
    return storage.getItem(UNLOCKED_KEY) === "1";
  } catch {
    return false;
  }
}
