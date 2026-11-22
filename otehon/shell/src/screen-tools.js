// The trusted shell passes a single action name to the native host.
const actions = new Set([
  "status", "record-start", "record-stop", "home", "recents", "settings", "accessibility-settings",
]);
const states = new Set(["idle", "starting", "recording", "saving", "saved", "failed"]);

export function screenToolsAvailable() {
  return typeof globalThis.__TAURI_INTERNALS__?.invoke === "function"
    && /Android/i.test(globalThis.navigator?.userAgent ?? "");
}

export async function screenTool(action) {
  if (!actions.has(action) || !screenToolsAvailable()) throw new Error("screen-tools-unavailable");
  const result = await globalThis.__TAURI_INTERNALS__.invoke("awai_screen_tools", { action });
  if (result?.schema !== "awai.screen-tools.result.v1" || !states.has(result.state)) {
    throw new Error("invalid-screen-tool-result");
  }
  return result;
}

export function gakaHandoffAvailable() {
  return typeof globalThis.__TAURI_INTERNALS__?.invoke === "function"
    && /Android|Macintosh/i.test(globalThis.navigator?.userAgent ?? "");
}

export async function openGaka() {
  if (!gakaHandoffAvailable()) throw new Error("gaka-unavailable");
  const result = await globalThis.__TAURI_INTERNALS__.invoke("awai_screen_tools", { action: "open-gaka" });
  if (result?.["schema"] !== "awai.local-app-launch.v1"
      || result["packageId"] !== "network.awai.gaka" || result["opened"] !== true) {
    throw new Error("invalid-gaka-launch-result");
  }
}
