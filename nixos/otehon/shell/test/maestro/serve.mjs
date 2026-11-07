// Local-only synthetic-account fixture. Run from nixos/otehon/shell after npm ci.
import { build } from "esbuild";
import { compileString } from "cherry-cljs/index.js";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
const result = await build({
  entryPoints: ["test/maestro/harness.jsx"], bundle: true, format: "iife", write: false,
  plugins: [{ name: "cljc", setup(b) { b.onLoad({ filter: /\.cljc$/ }, async ({ path }) => ({ contents: compileString(await readFile(path, "utf8")), loader: "js" })); } }],
});
const html = '<!doctype html><html><head><meta charset="utf-8"><title>Isolated Bunsho Test</title></head><body><div id="root"></div><script src="/main.js"></script></body></html>';
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }).end(html); return; }
  if (req.url === "/main.js") { res.writeHead(200, { "content-type": "text/javascript" }).end(result.outputFiles[0].contents); return; }
  res.writeHead(404).end();
}).listen(18821, "127.0.0.1", () => console.log("MAESTRO_HARNESS_READY"));
