import { issueHostAccountProof } from "./host-account.js";
// This device's key and its link to an account. The private key cannot be exported.
// Local state is a convenience: the link is verified again each time it is loaded.
import { compressP256, p256Did, verifyLink } from "./link.js";
import { issueWnfsAccountProof } from "./wnfs-account.js";

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

function readDeviceKey(db, candidate) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, candidate ? "readwrite" : "readonly");
    const store = transaction.objectStore(STORE);
    const request = store.get(KEY_ID);
    let pair;
    request.onsuccess = () => {
      pair = request.result;
      if (pair === undefined && candidate) {
        // The lookup and insert share a transaction across WebViews or tabs.
        store.add(candidate, KEY_ID);
        pair = candidate;
      }
    };
    transaction.oncomplete = () => resolve(pair);
    transaction.onabort = () => reject(transaction.error ?? new Error("device-key-transaction-aborted"));
  });
}

export async function verifyDeviceKeyPair(pair) {
  const key=pair?.privateKey,publicKey=pair?.publicKey;
  if(key?.type!=="private"||key.extractable!==false||key.algorithm?.name!=="ECDSA"
      ||key.algorithm.namedCurve!=="P-256"||!key.usages.includes("sign")||publicKey?.type!=="public")
    throw new Error("device-key-unavailable");
  const challenge=crypto.getRandomValues(new Uint8Array(32));
  const signature=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,challenge);
  const verifier=await crypto.subtle.importKey("raw",await crypto.subtle.exportKey("raw",publicKey),{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
  if(!await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},verifier,signature,challenge))
    throw new Error("device-key-mismatch");
}

export async function deviceDid() {
  const db = await open();
  try {
    let pair = await readDeviceKey(db);
    if (pair === undefined) {
      const candidate = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      pair = await readDeviceKey(db, candidate);
    }
    // A copied public link proof is not evidence that this device holds its key.
    await verifyDeviceKeyPair(pair);
    return p256Did(compressP256(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))));
  } finally {
    db.close();
  }
}

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function sessionRecord(db, replacement) {
  return new Promise((resolve, reject) => {
    const writing = replacement !== undefined;
    const transaction = writing ? db.transaction(STORE, "readwrite", { durability: "strict" })
      : db.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const request = writing ? store.put(replacement, SESSION_KEY) : store.get(SESSION_KEY);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? new Error("account-session-transaction-aborted"));
  });
}

async function readSavedSession(db) {
  const saved = await sessionRecord(db);
  // A committed null is an explicit sign-out. It supersedes legacy storage.
  return saved === undefined ? read(SESSION_KEY) : saved;
}

async function withSessionDatabase(operation) {
  const db = await open();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

async function replaceSession(replacement) {
  await withSessionDatabase(db => sessionRecord(db, replacement));
  try { localStorage.removeItem(SESSION_KEY); } catch { /* The committed record takes precedence. */ }
}

export function saveSession(request, response) {
  return replaceSession({ request, response });
}

// Retain this origin's browser storage, including the non-exportable device
// key. This never exports a credential, renews a proof, or grants operations.
// A browser may refuse eviction protection; do not report refusal as success.
export async function sessionRetention(requestPersistence = false) {
  const saved = await withSessionDatabase(readSavedSession).catch(() => null);
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

export async function signWnfsAccountAction(app, action) {
  const db = await open();
  try {
    // A broker request cannot create a key or repair a missing link.
    const pair = await readDeviceKey(db);
    await verifyDeviceKeyPair(pair);
    const saved = await readSavedSession(db);
    const proof = await issueWnfsAccountProof(pair, saved, app, action);
    if (JSON.stringify(await readSavedSession(db)) !== JSON.stringify(saved)) throw Error("account-link-changed");
    return proof;
  } finally {
    db.close();
  }
}

export async function signHostAccount(request) {
  const db = await open();
  try {
    const pair = await readDeviceKey(db);
    await verifyDeviceKeyPair(pair);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const did = p256Did(compressP256(raw));
    const saved = await readSavedSession(db);
    const session = verifyLink({ ...saved, deviceDid: did, atLink: false });
    const proof = await issueHostAccountProof(pair, session, request);
    if (JSON.stringify(await readSavedSession(db)) !== JSON.stringify(saved)) throw Error("account-link-changed");
    return proof;
  } finally {
    db.close();
  }
}

export async function clearSession() {
  await replaceSession(null);
  try { localStorage.removeItem(PROOFS_KEY); } catch { /* Storage may be unavailable. */ }
}

// Returns the verified account, or null, which keeps the OS at the login screen.
export async function loadSession(did, now = Date.now()) {
  const saved = await withSessionDatabase(readSavedSession);
  if (!saved) return null;
  try {
    return verifyLink({ request: saved.request, response: saved.response, deviceDid: did, now, atLink: false });
  } catch {
    // Fail closed without destroying the saved linkage or other proofs. A
    // candidate/runtime mismatch or an expired session is not an owner logout.
    // Only explicit sign-out or a newly completed link replaces this state.
    return null;
  }
}

export function loadProofs() {
  return read(PROOFS_KEY) ?? {};
}

export function saveProof(name, proof) {
  localStorage.setItem(PROOFS_KEY, JSON.stringify({ ...loadProofs(), [name]: proof }));
}
