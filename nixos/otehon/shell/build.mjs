// Build the OS shell (dist/) and the phone page (dist/link/). The connect-src of each
// page comes from its operations, through the shared runtime's own derivation.
import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { clientRuntimeConnectSrc } from "./vendor/kotoba-client-runtime.js";
import { osOperations, phoneOperations, runtimeDescriptor } from "./src/runtime.js";
import { scriptSrc, styleSrc } from "./src/csp.js";

const relayOrigin = process.env.RELAY_ORIGIN ?? "https://relay.awai.network";
// OTEHON_HTTP=1 builds the shell for the loopback preview server instead of
// the file:// kiosk. The http output must never ship in the OS image: its
// script/style sources allow 'self' so the page runs over http.
const cspMode = process.env.OTEHON_HTTP === "1" ? "http" : "file";
const define = {
  "process.env.NODE_ENV": '"production"',
  RELAY_ORIGIN: JSON.stringify(relayOrigin),
};

async function page({ source, html, outdir, operations, appOrigins }) {
  await mkdir(`${outdir}/assets`, { recursive: true });
  await build({
    entryPoints: { main: source },
    bundle: true,
    minify: true,
    format: "iife",
    jsx: "automatic",
    outdir: `${outdir}/assets`,
    define,
    logLevel: "warning",
  });
  await copyFile("vendor/kotoba-client-consent.css", `${outdir}/assets/consent.css`);
  const capabilities = [...new Set(operations.map((operation) => operation.capability))];
  const connect = clientRuntimeConnectSrc(runtimeDescriptor("index.html", operations), capabilities, [], appOrigins);
  const template = await readFile(html, "utf8");
  await writeFile(
    `${outdir}/index.html`,
    template
      .replace("__CONNECT_SRC__", connect)
      .replace("__SCRIPT_SRC__", scriptSrc(cspMode))
      .replace("__STYLE_SRC__", styleSrc(cspMode)),
  );
}

await page({
  source: "src/main.jsx",
  html: "index.html",
  outdir: "dist",
  operations: osOperations(relayOrigin),
  appOrigins: [],
});
await page({
  source: "link/main.jsx",
  html: "link/index.html",
  outdir: "dist/link",
  operations: phoneOperations(relayOrigin),
  appOrigins: ["https://awai.network"],
});

if (process.env.OTEHON_E2E === "1") {
  await build({
    entryPoints: ["test/e2e-driver.mjs"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: "dist/e2e-driver.mjs",
    logLevel: "warning",
  });
}
