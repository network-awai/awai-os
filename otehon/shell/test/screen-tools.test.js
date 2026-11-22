import assert from "node:assert/strict";
import { test } from "node:test";
import { openGaka, screenTool, screenToolsAvailable } from "../src/screen-tools.js";

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
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }, configurable: true,
  });
  await openGaka();
  assert.deepEqual(calls[1], ["awai_screen_tools", { action: "open-gaka" }]);
  assert.equal(screenToolsAvailable(), false);
  result = { ...result, packageId: "unexpected.app" };
  await assert.rejects(openGaka(), /invalid-gaka-launch-result/);
  await assert.rejects(() => screenTool("open-gaka"), /screen-tools-unavailable/);
  delete globalThis.__TAURI_INTERNALS__;
  await assert.rejects(openGaka(), /gaka-unavailable/);
});
