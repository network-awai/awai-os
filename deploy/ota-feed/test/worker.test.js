// Tests run without network and without wrangler. The worker has no
// upstream fetch: all behavior is local. Run with `node --test`
// (see package.json).
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import worker, { INDEXES } from "../src/worker.js";

const ORIGIN = "https://ota.awai.network";
const INDEX = `${ORIGIN}/v1/pc/pilot/virtio_x86_64/123/builds.json`;

describe("feed index", () => {
  it("serves a published index as application/json with no-store", async () => {
    INDEXES["virtio_x86_64/123"] = [{
      type: "RELEASE", version: "24.0",
      files: [{
        filename: "update.zip",
        sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        url: "https://raw.githubusercontent.com/network-awai/awai-os/0000000000000000000000000000000000000000/store/fixture/update.zip",
      }],
    }];
    const res = await worker.fetch(new Request(INDEX));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body[0].files[0].sha256, INDEXES["virtio_x86_64/123"][0].files[0].sha256);
    assert.match(body[0].files[0].url, /^https:\/\/raw\.githubusercontent\.com\//);
  });

  it("serves a withdrawal as an empty array []", async () => {
    INDEXES["virtio_x86_64/124"] = [];
    const res = await worker.fetch(new Request(`${ORIGIN}/v1/pc/pilot/virtio_x86_64/124/builds.json`));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "[]");
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("answers [] for a well-formed but unpublished device/incr", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/v1/pc/pilot/unknown_device/999/builds.json`));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "[]");
  });

  it("HEAD returns index headers with no body", async () => {
    INDEXES["virtio_x86_64/123"] = [{ type: "RELEASE" }];
    const res = await worker.fetch(new Request(INDEX, { method: "HEAD" }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(await res.text(), "");
  });

  it("serves no payload bytes: blob-shaped paths are refused", async () => {
    const fake = { called: false };
    const res = await worker.fetch(new Request(
      `${ORIGIN}/v1/pc/pilot/blobs/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.zip`,
    ));
    fake.called = res.status;
    assert.equal(fake.called, 400);
    assert.deepEqual(await res.json(), { error: "not-found" });
  });
});

describe("path guard", () => {
  it("refuses off-prefix paths with 400", async () => {
    for (const u of ["/health", "/v1/other/builds.json", "/manifest.json", "/latest"]) {
      const res = await worker.fetch(new Request(`${ORIGIN}${u}`));
      assert.equal(res.status, 400, u);
      assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8", u);
      assert.deepEqual(await res.json(), { error: "not-found" });
    }
  });

  it("refuses malformed in-prefix paths with 400", async () => {
    for (const u of [
      "/v1/pc/pilot",
      "/v1/pc/pilot/",
      "/v1/pc/pilot/../builds.json",
      "/v1/pc/pilot/virtio_x86_64/123/other.json",
      "/v1/pc/pilot/blobs/not-hex.zip",
      "/v1/pc/pilot/VIRTIO/123/builds.json",
    ]) {
      const res = await worker.fetch(new Request(`${ORIGIN}${u}`));
      assert.equal(res.status, 400, u);
    }
  });

  it("refuses non-GET/HEAD methods with 405", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await worker.fetch(new Request(INDEX, { method }));
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("allow"), "GET, HEAD");
    }
  });
});

describe("deploy config", () => {
  it("has no object-store binding of any kind (grep-equivalent)", () => {
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    for (const forbidden of ["r2_buckets", "r2", "kv_namespaces", "d1_databases"]) {
      assert.equal(config.includes(forbidden), false, forbidden);
    }
  });

  it("routes the ota.awai.network custom domain", () => {
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    assert.match(config, /"ota\.awai\.network"/);
  });
});
