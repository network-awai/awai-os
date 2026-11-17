import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildDougaka } from "../dougaka-bundle.mjs";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("vendored dougaka bundle matches its provenance digests", async () => {
  const vendor = path.join(root, "vendor-dougaka");
  const provenance = await readFile(path.join(vendor, "PROVENANCE.edn"), "utf8");
  assert.match(provenance, /source-rev "c29b87e/);
  const sums = await readFile(path.join(vendor, "SHA256SUMS"), "utf8");
  for (const line of sums.trim().split("\n")) {
    const [expected, ...rest] = line.trim().split(/\s+/);
    const name = rest.join(" ").replace(/^\.\//, "");
    const actual = sha256(await readFile(path.join(vendor, name)));
    assert.equal(actual, expected, name);
  }
});

test("dougaka page is re-laid for file:// with no network fetch", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "dougaka-dist-"));
  const { inlined } = await buildDougaka({ vendorDir: path.join(root, "vendor-dougaka"), outDir });
  assert.equal(inlined.length, 6);
  const html = await readFile(path.join(outDir, "index.html"), "utf8");
  assert.ok(!html.includes('application/x-scittle" src='), "no remote scittle sources remain");
  assert.ok(html.includes('<script defer src="./assets/dougaka-host.js">'), "bundled host deferred like the original module");
  assert.ok(!html.includes('type="module"'), "no ES module entry remains");
  assert.ok(html.includes("script-src 'self' file:"), "file: script sources");
  assert.ok(html.includes("connect-src https://generation.murakumo.cloud;"), "connect-src unchanged");
  assert.ok(html.includes("unsafe-eval"), "scittle eval still allowed");
  const host = await readFile(path.join(outDir, "assets", "dougaka-host.js"), "utf8");
  assert.ok(host.length > 10000, "bundled host is substantial");
  assert.ok(host.includes("dougaka-studio"), "host mounts the Studio root");
});

test("vendored studio host boot gate passes (no CSP mismatch throw)", async () => {
  // Mirrors the boot assertion at the top of vendor-dougaka/studio-host.js:
  // the host throws 'Dougaka CSP does not match declared services' when the
  // vendored runtime derives anything but `connect-src ${generationOrigin}`.
  // A stale kotoba-client-runtime.js without the browser-action skip broke
  // this (JUN-1180 V2: studio tabs stayed 0, fallback text only).
  const vendor = path.join(root, "vendor-dougaka");
  const runtime = await import(path.join(vendor, "kotoba-client-runtime.js"));
  const contract = await import(path.join(vendor, "studio-contract.js"));
  assert.deepEqual(
    runtime.clientRuntimeProblems(contract.runtimeDescriptor, contract.requestedCapabilities),
    [],
  );
  assert.equal(
    runtime.clientRuntimeConnectSrc(contract.runtimeDescriptor, contract.requestedCapabilities),
    `connect-src ${contract.generationOrigin}`,
  );
});

test("shell sidebar links to the dougaka page", async () => {
  const main = await readFile(path.join(root, "src", "shell", "main.cljs"), "utf8");
  assert.ok(main.includes('{:href "./dougaka/index.html"}'), "launcher anchor present");
});
