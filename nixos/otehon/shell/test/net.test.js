import { osOperations, runtimeDescriptor } from "../src/runtime.js";
import { clientRuntimeConnectSrc } from "../vendor/kotoba-client-runtime.js";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { macError, nameError, pskError, ssidError } from "../src/net.js";

test("network names accept real SSIDs and refuse control bytes", () => {
  assert.equal(ssidError("home-wifi"), null);
  assert.equal(ssidError("自宅のWi-Fi"), null);
  assert.equal(ssidError(""), "bad-ssid");
  assert.equal(ssidError("x".repeat(33)), "bad-ssid");
  assert.equal(ssidError("a\nb"), "bad-ssid");
  assert.equal(ssidError(7), "bad-ssid");
});

test("keys accept open networks, passphrases and 64 hex digits", () => {
  assert.equal(pskError(""), null);
  assert.equal(pskError(null), null);
  assert.equal(pskError("correct horse"), null);
  assert.equal(pskError("0".repeat(64)), null);
  assert.equal(pskError("short"), "bad-psk");
  assert.equal(pskError("z".repeat(64)), "bad-psk");
  assert.equal(pskError(7), "bad-psk");
});

test("the shell CSP allowlists every loopback service the UI fetches", async () => {
  // A fetch the CSP does not allow fails as TypeError before any packet
  // leaves the browser, so the service journal stays clean (AWAI-168).
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const html = await readFile(path.join(root, "index.html"), "utf8");
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  // build.mjs replaces the placeholder with the derived connect-src.
  const ops = osOperations("https://example.invalid");
  const derived = clientRuntimeConnectSrc(runtimeDescriptor("index.html", ops), [...new Set(ops.map(op => op.capability))], [], []);
  const built = csp.replace("__CONNECT_SRC__", derived);
  const connect = built
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src "));
  assert.ok(connect, "connect-src is present");
  const allowed = new Set(connect.split(/\s+/).slice(1));
  async function sources(dir) {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...(await sources(full)));
      else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.endsWith(".test.js")) {
        found.push(full);
      }
    }
    return found;
  }
  const origins = new Set();
  for (const file of await sources(path.join(root, "src"))) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/((?:https?|ws):\/\/127\.0\.0\.1:[0-9]+)/g)) {
      origins.add(match[1]);
    }
  }
  assert.ok(origins.size > 0, "the UI references loopback services");
  for (const origin of origins) {
    assert.ok(allowed.has(origin), `${origin} is missing from connect-src`);
  }
});

test("device addresses and saved names are strict", () => {
  assert.equal(macError("AA:BB:CC:DD:EE:FF"), null);
  assert.equal(macError("aa:bb:cc:dd:ee:ff"), null);
  assert.equal(macError("AA:BB:CC:DD:EE"), "bad-mac");
  assert.equal(macError("AA-BB-CC-DD-EE-FF"), "bad-mac");
  assert.equal(nameError("home-wifi"), null);
  assert.equal(nameError(""), "bad-name");
  assert.equal(nameError("a\nb"), "bad-name");
});
