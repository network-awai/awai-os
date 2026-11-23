// Runnable local check: real HTTP over a loopback server, worker only
// (no upstream fetch). Run: node test/local-check.mjs
// Proves (1) index is application/json + no-store, (2) a withdrawal
// returns [], (3) an unpublished channel answers [], (4) off-prefix
// and malformed paths are refused with 400.
import { createServer } from "node:http";
import worker, { INDEXES } from "../src/worker.js";

// Feed fixtures through the worker's own INDEXES map. The pinned payload
// URL is carried verbatim; this worker never fetches it.
INDEXES["virtio_x86_64/123"] = [{
  type: "DEV", version: "24.0", datetime: 1800000000,
  files: [{
    filename: "update.zip",
    sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    size: 496,
    url: "https://raw.githubusercontent.com/network-awai/awai-os/0000000000000000000000000000000000000000/store/fixture/update.zip",
    os_sdk_level: 36,
  }],
}];
INDEXES["virtio_x86_64/124"] = []; // withdrawn

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

const index = await fetch(`${base}/v1/pc/pilot/virtio_x86_64/123/builds.json`);
check("index application/json", index.headers.get("content-type") === "application/json", index.headers.get("content-type"));
check("index cache-control no-store", index.headers.get("cache-control") === "no-store", index.headers.get("cache-control"));
check("index body is the published offer", (await index.text()).includes("raw.githubusercontent.com"));

const withdrawal = await fetch(`${base}/v1/pc/pilot/virtio_x86_64/124/builds.json`);
check("withdrawal returns []", (await withdrawal.text()) === "[]");

const unpublished = await fetch(`${base}/v1/pc/pilot/unknown_device/999/builds.json`);
check("unpublished channel answers []", (await unpublished.text()) === "[]");

const refused = await fetch(`${base}/v1/other/builds.json`);
check("non-/v1/pc/pilot/ path refused 400", refused.status === 400, `status=${refused.status}`);

const malformed = await fetch(`${base}/v1/pc/pilot/blobs/not-hex.zip`);
check("malformed in-prefix path refused 400", malformed.status === 400, `status=${malformed.status}`);

server.close();
await new Promise((resolve) => server.once("close", resolve));
process.exitCode = failures ? 1 : 0;
if (!failures) console.log("LOCAL CHECK OK");
