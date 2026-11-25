import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker from "../src/worker.js";
import { INDEXES } from "../src/indexes.js";

// Transport measurements, 2026-11-24: yataverse 16 MiB PUT verified, 32 MiB
// HTTP 413, CAR import verified but file-path GET 404. A 55-byte raw block
// serves 206. GitHub raw returned 206 for a 55,456,456-byte APK. A 1.8 GB
// GitHub release asset returned 302 to the signed asset URL, then 206.
const base = "https://ota.awai.network/v1/pc/pilot/";
const device = "virtio_x86_64";
const key = `${device}/987654321`;
const index = (entry = key, method = "GET") =>
  worker.fetch(new Request(`${base}${entry}/builds.json`, { method }));

test("offers are JSON with no-store and preserve URL, size and SHA-256", async () => {
  const sha256 = "a".repeat(64);
  const url = `https://github.com/network-awai/awai-os/releases/download/pilot-1/${sha256}.zip`;
  const offer = [{ files: [{ url, size: 1800000000, sha256 }] }];
  INDEXES[key] = offer;
  try {
    const response = await index();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), offer);
  } finally {
    delete INDEXES[key];
  }
});

test("HEAD has the index headers and no body", async () => {
  const response = await index(key, "HEAD");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
});

test("explicit withdrawal returns 200 and an empty array", async () => {
  INDEXES[key] = [];
  try {
    const response = await index();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), []);
  } finally {
    delete INDEXES[key];
  }
});

test("unknown device returns 200 and an empty array", async () => {
  const response = await index("unsupported_device/987654321");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), []);
});

test("old payload routes and unrelated paths return 404", async () => {
  const sha = "a".repeat(64);
  for (const url of [`${base}blobs/${sha}.zip`, `${base}${sha}.zip`, new URL("/health", base)]) {
    const response = await worker.fetch(new Request(url, { headers: { Range: "bytes=0-99" } }));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not-found" });
  }
});

test("index rejects POST", async () => {
  const response = await index(key, "POST");
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("generated Worker index agrees with the audit JSON", async () => {
  const audit = await readFile(new URL("../indexes/indexes.json", import.meta.url), "utf8");
  assert.deepEqual(INDEXES, JSON.parse(audit));
});
