import assert from "node:assert/strict";
import { test } from "node:test";
import { openGaka, screenTool } from "../src/screen-tools.js";

test("opening Gaka uses one fixed local command and verifies the package result", async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Android" }, configurable: true });
  const calls = [];
  let result = { schema: "awai.local-app-launch.v1", packageId: "network.awai.gaka", opened: true };
  globalThis.__TAURI_INTERNALS__ = {
    invoke: async (...args) => {
      calls.push(args);
      return result;
    }
  };
  t.after(() => {
    delete globalThis.__TAURI_INTERNALS__;
    Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  });
  await openGaka();
  assert.deepEqual(calls, [["awai_screen_tools", { action: "open-gaka" }]]);
  result = { ...result, packageId: "unexpected.app" };
  await assert.rejects(openGaka(), /invalid-gaka-launch-result/);
  await assert.rejects(() => screenTool("open-gaka"), /screen-tools-unavailable/);
});
