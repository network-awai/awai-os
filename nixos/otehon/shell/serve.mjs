// Preview server for the Otehon shell: serves dist/ on loopback only.
// No dependency beyond node itself. Pair it with the http build variant:
//
//   OTEHON_HTTP=1 npm run build && npm run serve
//
// or in one step: npm run preview
//
// The default (file:) build stays the OS image artifact; this server is a
// local preview convenience, not a deployment.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = new URL("./dist/", import.meta.url);
const port = Number(process.argv[2] ?? 8901);
const host = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = new URL(`.${pathname}`, root);
    // Refuse anything that escapes dist/.
    if (!file.pathname.startsWith(root.pathname)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[path.extname(pathname)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

server.listen(port, host, () => {
  console.log(`otehon shell preview on http://${host}:${port}/`);
});
