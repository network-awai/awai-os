import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const externsPath = path.join(root, "externs/otehon-shell.js");

// Every property name read across the ClojureScript/JS boundary must be
// declared here, or the release (advanced) Closure pass renames it while
// string-key checks (client-runtime descriptor validation, link request
// device binding) keep the original spelling. That mismatch boots in dev
// and fails in release, so this test guards the release-only behavior.
const CONTRACT_KEYS = [
  "schema", "target", "profile", "entry", "operations",
  "adapter", "version",
  "capability", "service", "operation", "consent", "endpoint",
  "origin", "routes", "method", "path",
  "totalNodes", "totalBots", "pages", "circleCount", "counts", "radius", "x", "y",
];

function cljsProps(src) {
  const names = new Set();
  const clean = src.replace(/;[^\n]*/g, "");
  for (const m of clean.matchAll(/\.-([_$a-zA-Z][_$a-zA-Z0-9]*)/g)) names.add(m[1]);
  for (const m of clean.matchAll(/\(\.([_$a-zA-Z][_$a-zA-Z0-9]*)/g)) names.add(m[1]);
  return names;
}

function jsProps(src) {
  const names = new Set();
  for (const m of src.matchAll(/\.([_$a-zA-Z][_$\w]*)/g)) {
    if (!/^[0-9]/.test(m[1]) && m[1].length > 1) names.add(m[1]);
  }
  for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      const kv = t.match(/^([_$a-zA-Z][_$\w]*)\s*[:=]/);
      if (kv) { names.add(kv[1]); continue; }
      if (/^[_$a-zA-Z][_$\w]*$/.test(t)) names.add(t);
    }
  }
  return names;
}

async function declared() {
  const text = await readFile(externsPath, "utf8");
  return new Set([...text.matchAll(/^Object\.prototype\.([_$a-zA-Z][_$\w]*);/gm)].map((m) => m[1]));
}

test("externs cover every CLJS interop property", async () => {
  const have = await declared();
  const missing = new Set();
  const shellFiles = await readdir(path.join(root, "src/shell"));
  const sources = shellFiles.filter((f) => f.endsWith(".cljs")).map((f) => path.join(root, "src/shell", f));
  sources.push(path.join(root, "src/link/main.cljs"));
  for (const file of sources) {
    const src = await readFile(file, "utf8");
    for (const name of cljsProps(src)) {
      if (!have.has(name)) missing.add(`${path.basename(file)}: ${name}`);
    }
  }
  assert.deepEqual([...missing].sort(), [], `missing externs:\n${[...missing].sort().join("\n")}`);
});

test("externs cover every plain-JS boundary property", async () => {
  const have = await declared();
  const missing = new Set();
  const jsFiles = [
    "src/runtime.js", "src/trust.js", "src/soshiki.js", "src/media.js",
    "src/net.js", "src/display.js", "src/sound.js", "src/status.js",
    "src/soshiki-runtime.js", "src/soshiki-fleet.js", "src/fleet-projection.js", "src/fleet-circles.js", "src/bot-cycle.js", "src/fleet-organizations.js", "src/fleet-responsibilities.js", "src/ui-copy.js", "src/fleet-activity.js",
    "src/saifu-host.js", "src/voice-input.js", "src/csp.js",
    "src/identity/link.js", "src/identity/device.js", "src/identity/wallet.js",
  ];
  for (const rel of jsFiles) {
    let src;
    try {
      src = await readFile(path.join(root, rel), "utf8");
    } catch { continue; }
    for (const name of jsProps(src)) {
      if (!have.has(name)) missing.add(`${rel}: ${name}`);
    }
  }
  assert.deepEqual([...missing].sort(), [], `missing externs:\n${[...missing].sort().join("\n")}`);
});

test("externs keep the client-runtime contract keys", async () => {
  const have = await declared();
  for (const key of CONTRACT_KEYS) {
    assert.ok(have.has(key), `contract key missing: ${key}`);
  }
});
