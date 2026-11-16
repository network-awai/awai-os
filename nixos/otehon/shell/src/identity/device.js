// This device's key and its link to an account. The private key cannot be exported.
// Local state is a convenience: the link is verified again each time it is loaded.
import { compressP256, p256Did, verifyLink } from "./link.js";

const DB = "otehon-device";
const STORE = "keys";
const KEY_ID = "device";
const SESSION_KEY = "otehon.account.v1";
const PROOFS_KEY = "otehon.proofs.v1";

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run(db, mode, action) {
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deviceDid() {
  const db = await open();
  let pair = await run(db, "readonly", (store) => store.get(KEY_ID));
  if (!pair) {
    pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    await run(db, "readwrite", (store) => store.put(pair, KEY_ID));
  }
  db.close();
  return p256Did(compressP256(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))));
}

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function saveSession(request, response) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ request, response }));
}

// Retain this origin's browser storage, including the non-exportable device
// key. This never exports a credential, renews a proof, or grants operations.
// A browser may refuse eviction protection; do not report refusal as success.
export async function sessionRetention(requestPersistence = false) {
  const saved = read(SESSION_KEY);
  let persistent = null;
  try {
    const storage = globalThis.navigator?.storage;
    if (typeof storage?.persisted === "function") persistent = await storage.persisted();
    if (requestPersistence && persistent !== true && typeof storage?.persist === "function") {
      persistent = await storage.persist();
    }
  } catch { /* Browser policy or storage denial stays unknown. */ }
  return { saved: Boolean(saved?.request && saved?.response), persistent };
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(PROOFS_KEY);
}

// Returns the verified account, or null, which keeps the OS at the login screen.
export function loadSession(did, now = Date.now()) {
  const saved = read(SESSION_KEY);
  if (!saved) return null;
  try {
    return verifyLink({ request: saved.request, response: saved.response, deviceDid: did, now, atLink: false });
  } catch {
    clearSession();
    return null;
  }
}

export function loadProofs() {
  return read(PROOFS_KEY) ?? {};
}

export function saveProof(name, proof) {
  localStorage.setItem(PROOFS_KEY, JSON.stringify({ ...loadProofs(), [name]: proof }));
}
