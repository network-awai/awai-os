// Built-in app registry. Installing enables a bundled component for this account;
// it does not download or execute external packages.
export const BUNDLED_APPS = Object.freeze([
  Object.freeze({ id: "tokei", title: "Tokei", description: "A local clock and date.", type: "App" }),
]);
const PREFIX = "otehon.installed-apps.v1:";
const validAccount = (account) => typeof account === "string" && account.startsWith("did:") && account.length <= 512;
const known = (id) => BUNDLED_APPS.some((app) => app.id === id);

export function installedApps(account, storage) {
  if (!validAccount(account)) return [];
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(PREFIX + account);
    if (raw === null) return ["tokei"];
    const value = JSON.parse(raw);
    return Array.isArray(value) ? [...new Set(value.filter(known))] : [];
  } catch { return []; }
}

export function setAppInstalled(account, id, install, storage) {
  if (!validAccount(account) || !known(id) || typeof install !== "boolean") return false;
  try {
    const target = storage ?? globalThis.localStorage;
    const current = installedApps(account, target);
    const next = install ? [...new Set([...current, id])] : current.filter((item) => item !== id);
    const encoded = JSON.stringify(next);
    target.setItem(PREFIX + account, encoded);
    return target.getItem(PREFIX + account) === encoded;
  } catch { return false; }
}
