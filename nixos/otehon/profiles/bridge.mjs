// Platform service, separate from the static app origin. TLS credentials live
// in the host's managed certificate directory and never enter app artifacts.
import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
export const allowedOrigins = new Set(["null", "http://127.0.0.1:8901", "http://127.0.0.1:8902"]);
export function catalogHandler(readCatalog) {
  return async (request, response) => {
    const origin = request.headers.origin;
    const allowed = allowedOrigins.has(origin);
    const headers = { "content-type": "application/json", "cache-control": "no-store", "vary": "Origin", "x-content-type-options": "nosniff" };
    if (allowed) headers["access-control-allow-origin"] = origin;
    if (!allowed) { response.writeHead(403, headers); response.end("{}"); return; }
    if (request.method !== "GET" || request.url !== "/v1/itonami/profiles") {
      response.writeHead(404, headers); response.end("{}"); return;
    }
    try {
      const catalog = await readCatalog();
      response.writeHead(200, headers);
      response.end(catalog);
    } catch {
      response.writeHead(503, headers);
      response.end('{"error":"catalog-unavailable"}');
    }
  };
}

export async function startBridge(env = process.env) {
  if (!env.PROFILE_CATALOG_CERT || !env.PROFILE_CATALOG_KEY) throw new Error("profile-catalog-tls-required");
  const source = fileURLToPath(new URL("src/", import.meta.url));
  const readCatalog = async () => {
    const { stdout } = await execute(env.BB_COMMAND || "bb", ["-cp", source, "-m", "profile-catalog.core"],
      { env, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  };
  const [cert, key] = await Promise.all([readFile(env.PROFILE_CATALOG_CERT), readFile(env.PROFILE_CATALOG_KEY)]);
  const server = createServer({ cert, key }, catalogHandler(readCatalog));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(8777, "127.0.0.1", resolve); });
  console.log("Read-only itonami catalog at https://127.0.0.1:8777");
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await startBridge();
