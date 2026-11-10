// Build the OS shell (dist/) and the phone page (dist/link/). The connect-src of each
// page comes from its operations, through the shared runtime's own derivation.
import { build } from "esbuild";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { clientRuntimeConnectSrc } from "./vendor/kotoba-client-runtime.js";
import { osOperations, phoneOperations, runtimeDescriptor } from "./src/runtime.js";
import { saifuContentCsp } from "./src/saifu-bundle.js";

const relayOrigin = process.env.RELAY_ORIGIN ?? "https://relay.awai.network";
const pinsPath = process.env.OTEHON_SAIFU_PINS;
const bundlePath = process.env.OTEHON_SAIFU_BUNDLE;
if (Boolean(pinsPath) !== Boolean(bundlePath)) throw new Error("both trusted Saifu pins and bundle are required");
let saifu = null;
let saifuScript = "";
let saifuStyle = "";
if (pinsPath && bundlePath) {
  if ((await stat(pinsPath)).size > 16384 || (await stat(bundlePath)).size > 12000000) throw new Error("Saifu build input too large");
  const pins = JSON.parse(await readFile(pinsPath, "utf8"));
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const csp = await saifuContentCsp(bundle, pins);
  saifuScript = csp.script;
  saifuStyle = csp.style;
  saifu = { pins, bundle };
}
const define = {
  "process.env.NODE_ENV": '"production"',
  RELAY_ORIGIN: JSON.stringify(relayOrigin),
  SAIFU_EMBEDDED: JSON.stringify(saifu),
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
  await writeFile(`${outdir}/index.html`, template.replace("__CONNECT_SRC__", connect).replace("__SAIFU_SCRIPT_SRC__", saifuScript).replace("__SAIFU_STYLE_SRC__", saifuStyle));
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
