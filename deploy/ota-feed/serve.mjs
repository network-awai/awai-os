// Local dry-run server: serves src/worker.js over plain HTTP on
// 127.0.0.1:8787 so index/payload headers can be exercised with curl
// without wrangler. Index endpoints work fully; payload endpoints
// proxy to https://yataverse.com/ipfs/<CID> and 404 until the bytes
// are ingested into the yataverse network (see README.md).
import { createServer } from "node:http";
import worker from "./src/worker.js";

const PORT = Number(process.env.PORT || 8787);

async function handle(req, res) {
  const url = `http://127.0.0.1:${PORT}${req.url}`;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = v;
  const request = new Request(url, { method: req.method, headers });
  const response = await worker.fetch(request);
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(body);
}

createServer((req, res) => handle(req, res).catch((err) => {
  console.error(err);
  res.writeHead(500);
  res.end("serve-error");
})).listen(PORT, "127.0.0.1", () => {
  console.log(`ota-feed dry-run on http://127.0.0.1:${PORT} (payloads proxy to yataverse)`);
});
