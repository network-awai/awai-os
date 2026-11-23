// Runnable local check: real HTTP over a loopback server, worker + a
// local-range fixture standing in for the yataverse gateway. Run:
//   node test/local-check.mjs
// Proves (1) index is application/json + no-store, (2) payload answers
// a ranged GET with 206 + Content-Range, (3) a withdrawal returns [],
// (4) a non-/v1/pc/pilot/ path is refused.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import worker, { INDEXES, cidFromSha256 } from "../src/worker.js";

const payload = Buffer.from("ota-fixture-bytes-0123456789", "utf8");
const sha = createHash("sha256").update(payload).digest("hex");

// Feed fixtures through the worker's own INDEXES map.
INDEXES["virtio_x86_64/123"] = [{
  type: "DEV", version: "24.0", datetime: 1800000000,
  files: [{
    filename: `${sha}.zip`, sha256: sha, size: payload.length,
    url: `https://ota.awai.network/v1/pc/pilot/blobs/${sha}.zip`, os_sdk_level: 36,
  }],
}];
INDEXES["virtio_x86_64/124"] = []; // withdrawn

const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const target = String(url);
  if (target === `https://yataverse.com/ipfs/${cidFromSha256(sha)}`) {
    const range = init?.headers?.range;
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = Number(m[1]);
      const end = m[2] === "" ? payload.length - 1 : Number(m[2]);
      return Promise.resolve(new Response(payload.subarray(start, end + 1), {
        status: 206,
        headers: {
          "content-range": `bytes ${start}-${end}/${payload.length}`,
          "content-length": String(end - start + 1),
          "content-type": "application/zip",
        },
      }));
    }
    return Promise.resolve(new Response(payload, { headers: { "content-type": "application/zip" } }));
  }
  return Promise.reject(new Error("unexpected upstream " + target));
};

const server = createServer(async (req, res) => {
  const response = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers }));
  const headers = {};
  for (const [k, v] of response.headers) headers[k] = v;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " " + detail : ""}`);
  if (!ok) failures += 1;
}

const index = await realFetch(`${base}/v1/pc/pilot/virtio_x86_64/123/builds.json`);
check("index application/json", index.headers.get("content-type") === "application/json", index.headers.get("content-type"));
check("index cache-control no-store", index.headers.get("cache-control") === "no-store", index.headers.get("cache-control"));
check("index body is the published offer", (await index.text()).includes(sha));

const ranged = await realFetch(`${base}/v1/pc/pilot/blobs/${sha}.zip`, { headers: { range: "bytes=4-9" } });
check("ranged GET answers 206", ranged.status === 206, `status=${ranged.status}`);
check("ranged GET Content-Range", ranged.headers.get("content-range") === `bytes 4-9/${payload.length}`, ranged.headers.get("content-range"));
check("ranged GET byte span", (await ranged.text()) === payload.subarray(4, 10).toString());

const withdrawal = await realFetch(`${base}/v1/pc/pilot/virtio_x86_64/124/builds.json`);
check("withdrawal returns []", (await withdrawal.text()) === "[]");

const refused = await realFetch(`${base}/v1/other/builds.json`);
check("non-/v1/pc/pilot/ path refused 404", refused.status === 404, `status=${refused.status}`);

server.close();
await new Promise((resolve) => server.once("close", resolve));
process.exitCode = failures ? 1 : 0;
if (!failures) console.log("LOCAL CHECK OK");
