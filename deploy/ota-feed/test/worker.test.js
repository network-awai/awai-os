// Tests run without network and without wrangler: stub globalThis.fetch
// for payload bytes. Run with `node --test` (see package.json).
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import worker, { INDEXES, cidFromSha256 } from "../src/worker.js";

const ORIGIN = "https://ota.awai.network";
const INDEX = `${ORIGIN}/v1/pc/pilot/virtio_x86_64/123/builds.json`;

// sha256("abc") = ba78..., sha256("") = e3b0...
const ABC_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const ABC_CID = "afkreif2pall7dybz7vecqka3zo24irdwabwdi4wc55jznaq75q7eaavvu";
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EMPTY_CID = "afkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

function withUpstream(handler) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

describe("CID derivation", () => {
  it("derives CIDv1(raw, sha2-256) for known digests", () => {
    assert.equal(cidFromSha256(ABC_SHA), ABC_CID);
    assert.equal(cidFromSha256(EMPTY_SHA), EMPTY_CID);
  });
});

describe("feed index", () => {
  it("serves a published index as application/json with no-store", async () => {
    INDEXES["virtio_x86_64/123"] = [{ type: "RELEASE", version: "24.0" }];
    const res = await worker.fetch(new Request(INDEX));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), [{ type: "RELEASE", version: "24.0" }]);
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
});

describe("payload blobs", () => {
  it("streams 200 bytes with immutable cache and digest etag", async () => {
    const fake = withUpstream(() => new Response("zip-bytes", { headers: { "content-type": "application/zip" } }));
    try {
      const res = await worker.fetch(new Request(`${ORIGIN}/v1/pc/pilot/blobs/${ABC_SHA}.zip`));
      assert.equal(fake.calls[0].url, `https://yataverse.com/ipfs/${ABC_CID}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/zip");
      assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(res.headers.get("accept-ranges"), "bytes");
      assert.equal(res.headers.get("etag"), `"${ABC_SHA}"`);
      assert.equal(await res.text(), "zip-bytes");
    } finally {
      fake.restore();
    }
  });

  it("forwards Range and passes 206/Content-Range through", async () => {
    const fake = withUpstream(() => new Response("12", {
      status: 206,
      headers: { "content-range": "bytes 10-12/100", "content-length": "3" },
    }));
    try {
      const res = await worker.fetch(new Request(`${ORIGIN}/v1/pc/pilot/${ABC_SHA}.zip`, {
        headers: { range: "bytes=10-12" },
      }));
      assert.equal(fake.calls[0].init.headers.range, "bytes=10-12");
      assert.equal(res.status, 206);
      assert.equal(res.headers.get("content-range"), "bytes 10-12/100");
      assert.equal(await res.text(), "12");
    } finally {
      fake.restore();
    }
  });

  it("HEAD probes one byte upstream and returns no body", async () => {
    const fake = withUpstream(() => new Response("0", {
      status: 206,
      headers: { "content-range": "bytes 0-0/100" },
    }));
    try {
      const res = await worker.fetch(new Request(`${ORIGIN}/v1/pc/pilot/blobs/${ABC_SHA}.zip`, { method: "HEAD" }));
      assert.equal(fake.calls[0].init.headers.range, "bytes=0-0");
      assert.equal(res.status, 206);
      assert.equal(await res.text(), "");
    } finally {
      fake.restore();
    }
  });

  it("answers 404 (never 500) when the gateway does not have the bytes", async () => {
    const fake = withUpstream(() => new Response("nope", { status: 404 }));
    try {
      const res = await worker.fetch(new Request(`${ORIGIN}/v1/pc/pilot/blobs/${ABC_SHA}.zip`));
      assert.equal(res.status, 404);
      assert.notEqual(res.status, 500);
      assert.deepEqual(await res.json(), { error: "ota-payload-unavailable" });
    } finally {
      fake.restore();
    }
  });

  it("answers 404 when the gateway throws (pre-HTTP failure)", async () => {
    const fake = withUpstream(() => {
      throw new Error("network down");
    });
    try {
      const res = await worker.fetch(new Request(`${ORIGIN}/v1/pc/pilot/blobs/${ABC_SHA}.zip`));
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: "ota-payload-unavailable" });
    } finally {
      fake.restore();
    }
  });
});

describe("path guard", () => {
  it("refuses paths outside /v1/pc/pilot/", async () => {
    for (const u of [
      "/health",
      "/v1/other/builds.json",
      "/v1/pc/pilot",
      "/v1/pc/pilot/",
      "/v1/pc/pilot",
      "/manifest.json",
      "/latest",
      "/v1/pc/pilot/../builds.json",
      "/v1/pc/pilot/virtio_x86_64/123/other.json",
      `/v1/pc/pilot/blobs/${ABC_SHA}`,
      `/v1/pc/pilot/blobs/${ABC_SHA.toUpperCase()}.zip`,
      `/v1/pc/pilot/blobs/${ABC_SHA.slice(1)}.zip`,
      "/v1/pc/pilot/blobs/not-hex.zip",
      "/v1/pc/pilot/blobs/abc.zip",
    ]) {
      const res = await worker.fetch(new Request(`${ORIGIN}${u}`));
      assert.equal(res.status, 404, u);
      assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8", u);
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
  it("has no r2_buckets binding", () => {
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    assert.equal(config.includes("r2_buckets"), false);
    assert.equal(config.includes("r2"), false);
  });

  it("routes the ota.awai.network custom domain", () => {
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    assert.match(config, /"ota\.awai\.network"/);
  });
});
