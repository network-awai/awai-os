import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker, { sha256HexToCid, YATAVERSE_ORIGIN } from "../worker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_HEX =
  "8f671359a2fec6dcd88b5e5242531adaaabd1cf231d2ceea66e6fbe19449aed3";
const EXAMPLE_CID =
  "bafkreiepm4jvtix6y3onrc26kjbfggw2vk6rz4rr2lhouzxg7pqzisno2m";

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("64hex -> CIDv1 conversion matches known vectors", () => {
  // Empty content SHA-256 -> well-known raw CID.
  assert.equal(
    sha256HexToCid(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ),
    "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
  );
  // Production example hex from docs/evidence (manifest-referenced ISO).
  assert.equal(sha256HexToCid(EXAMPLE_HEX), EXAMPLE_CID);
  // "hello world" SHA-256 raw CID.
  assert.equal(
    sha256HexToCid(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    ),
    "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e",
  );
  assert.throws(() => sha256HexToCid("xyz"), TypeError);
  assert.throws(() => sha256HexToCid("A".repeat(64)), TypeError);
});

test("artifact fetches yataverse CID and forwards Range preserving 206 and Content-Range", async () => {
  const stub = stubFetch(async (url, init) => {
    assert.equal(url, `${YATAVERSE_ORIGIN}/ipfs/${EXAMPLE_CID}`);
    assert.equal(init.headers.get("Range"), "bytes=1-2");
    return new Response(new Uint8Array([65, 116]), {
      status: 206,
      headers: {
        "Content-Length": "2",
        "Content-Range": "bytes 1-2/4",
        ETag: '"fixture"',
      },
    });
  });
  try {
    const res = await worker.fetch(
      new Request(
        `https://release.example/stable/${EXAMPLE_HEX}.nar-export`,
        { headers: { Range: "bytes=1-2" } },
      ),
      {},
    );
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), "bytes 1-2/4");
    assert.equal(res.headers.get("content-length"), "2");
    assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(await res.text(), "At");
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("upstream 404 is 404, never 500", async () => {
  const stub404 = stubFetch(async () =>
    new Response("not here", { status: 404 }),
  );
  try {
    const res = await worker.fetch(
      new Request(`https://release.example/${EXAMPLE_HEX}.iso`),
      {},
    );
    assert.equal(res.status, 404);
    assert.notEqual(res.status, 500);
  } finally {
    stub404.restore();
  }

  const stubThrow = stubFetch(async () => {
    throw new Error("network down");
  });
  try {
    const res = await worker.fetch(
      new Request(`https://release.example/${EXAMPLE_HEX}.iso`),
      {},
    );
    assert.equal(res.status, 404);
    assert.notEqual(res.status, 500);
  } finally {
    stubThrow.restore();
  }
});

test("wrangler.jsonc has no r2_buckets", () => {
  const raw = fs.readFileSync(path.join(__dirname, "..", "wrangler.jsonc"), "utf8");
  assert.equal(raw.includes("r2_buckets"), false);
  assert.equal(raw.includes("RELEASES"), false);
  assert.equal(raw.includes("aiueos-releases"), false);
  // Still a parseable config with account kept.
  const parsed = JSON.parse(raw);
  assert.equal(parsed.name, "aiueos-updates");
  assert.equal(parsed.account_id, "4da88288dc30d9ee257f319d3c33ecf0");
});

test("invalid paths are 404 without upstream fetch", async () => {
  const stub = stubFetch(async () => {
    throw new Error("must not fetch");
  });
  try {
    for (const p of [
      "/config.json",
      "/stable/config.json",
      "/stable/manifest.json.bak",
      "/stable/xyz.iso",
      "/stable/" + "A".repeat(64) + ".iso",
      "/stable/" + "a".repeat(63) + ".iso",
      "/stable/" + "a".repeat(64) + ".zip",
      "/stable//" + EXAMPLE_HEX + ".iso",
    ]) {
      const res = await worker.fetch(
        new Request(`https://release.example${p}`),
        {},
      );
      assert.equal(res.status, 404, p);
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("manifest without MANIFEST_CID is 404 without fetch; with CID it proxies yataverse", async () => {
  const stub = stubFetch(async (url) => {
    assert.equal(
      url,
      `${YATAVERSE_ORIGIN}/ipfs/bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku`,
    );
    return new Response('{"schema":"aiueos.update-manifest.v1"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    const missing = await worker.fetch(
      new Request("https://release.example/stable/manifest.json"),
      {},
    );
    assert.equal(missing.status, 404);
    assert.notEqual(missing.status, 500);

    const ok = await worker.fetch(
      new Request("https://release.example/stable/manifest.json"),
      {
        MANIFEST_CID:
          "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
      },
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.equal(ok.headers.get("content-type"), "application/json");
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.match(await ok.text(), /aiueos\.update-manifest/);
  } finally {
    stub.restore();
  }
});

test("method guard and HEAD preserve headers with empty body", async () => {
  const stub = stubFetch(async () =>
    new Response("data", {
      status: 200,
      headers: { "Content-Length": "4" },
    }),
  );
  try {
    const post = await worker.fetch(
      new Request("https://release.example/stable/manifest.json", {
        method: "POST",
      }),
      {},
    );
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");

    const head = await worker.fetch(
      new Request(`https://release.example/${EXAMPLE_HEX}.iso`, {
        method: "HEAD",
      }),
      {},
    );
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "4");
    assert.equal(await head.text(), "");
  } finally {
    stub.restore();
  }
});

test("upstream 200 stays 200 for plain GET, channel prefix optional", async () => {
  for (const p of [
    `/${EXAMPLE_HEX}.iso`,
    `/stable/${EXAMPLE_HEX}.iso`,
    `/canary/${EXAMPLE_HEX}.nar-export`,
  ]) {
    const stub = stubFetch(async (url) => {
      assert.equal(url, `${YATAVERSE_ORIGIN}/ipfs/${EXAMPLE_CID}`);
      return new Response("payload", {
        status: 200,
        headers: { "Content-Length": "7" },
      });
    });
    try {
      const res = await worker.fetch(
        new Request(`https://release.example${p}`),
        {},
      );
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get("content-range"), null);
      assert.equal(await res.text(), "payload");
    } finally {
      stub.restore();
    }
  }
});
