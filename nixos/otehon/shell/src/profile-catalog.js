// Local browser file access only. The picker grants read access; no network,
// shell command, app-origin handler or profile-store write is involved.
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DB = "otehon-profile-directory";
const KEY = "itonami-profiles";

async function remembered(mode, handle) {
  if (!globalThis.indexedDB) return undefined;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("handles", mode);
      const request = mode === "readonly" ? tx.objectStore("handles").get(KEY) : tx.objectStore("handles").put(handle, KEY);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function readProfileManifests({ picker = globalThis.showDirectoryPicker, remember = remembered, chooseNew = false } = {}) {
  // startIn reopens the last chosen directory without bypassing the picker.
  const previous = await remember("readonly").catch(() => undefined);
  let selected;
  if (previous && !chooseNew) {
    const mode = { mode: "read" };
    const permission = await previous.queryPermission(mode);
    if (permission === "granted" || await previous.requestPermission(mode) === "granted") selected = previous;
    else throw new Error("directory-permission-denied");
  }
  if (!selected) {
    if (typeof picker !== "function") throw new Error("directory-picker-unavailable");
    selected = await picker.call(globalThis, { id: "itonami-profiles", mode: "read", ...(previous ? { startIn: previous } : {}) });
  }
  let root = selected;
  if (selected.name !== "profiles") {
    // Accept either the profiles directory itself or its .itonami parent.
    root = await selected.getDirectoryHandle("profiles");
  }
  const results = [];
  let count = 0;
  for await (const dir of root.values()) {
    if (dir.kind !== "directory" || !NAME.test(dir.name)) continue;
    if (++count > 10000) throw new Error("too-many-profiles");
    try {
      const file = await (await dir.getFileHandle("itonami.edn")).getFile();
      if (file.size > 262144) continue;
      results.push({ directory: dir.name, text: await file.text() });
    } catch (error) {
      if (error?.name !== "NotFoundError") throw error;
    }
  }
  await remember("readwrite", selected).catch(() => undefined);
  return results;
}
