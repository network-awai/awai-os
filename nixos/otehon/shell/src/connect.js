// Calls to the Tsunagu bridge (connect.nix), which listens on loopback only.
// The header makes every call a CORS request the bridge can check.
export const BRIDGE = "http://127.0.0.1:8791";

export async function bridge(path, body, fetchImpl = globalThis.fetch) {
  const init = body === undefined
    ? { method: "GET", headers: { "x-otehon-connect": "1" } }
    : { method: "POST", headers: { "x-otehon-connect": "1", "content-type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetchImpl(BRIDGE + path, init);
  const value = await response.json().catch(() => null);
  if (!response.ok || value === null) throw new Error(value?.error ?? "bridge-unavailable");
  return value;
}

// The browser-operation adapter for "tailscale/join-tailnet". The broker runs it
// only after the person approves the operation in the consent dialog.
export const tailscaleAdapters = (fetchImpl) => ({
  tailscale: { "join-tailnet": () => bridge("/tailscale/connect", {}, fetchImpl) },
});
