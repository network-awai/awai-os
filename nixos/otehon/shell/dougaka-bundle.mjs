// Bundle the vendored dougaka Studio snapshot (vendor-dougaka/, built by
// app-itonami-dougaka `npm run build:site`, see PROVENANCE.edn) into
// dist/dougaka/ for file:// use in the kiosk browser.
//
// Three file:// adaptations, each asserted by test/dougaka.test.js:
// 1. studio-host.js is an ES module with relative imports: blocked under a
//    null origin, so esbuild bundles it (plus studio-contract/core/local and
//    the pinned kotoba-client-runtime) into assets/dougaka-host.js (iife).
// 2. `application/x-scittle src=` scripts are fetched at runtime: blocked
//    under a null origin, so their exact vendored bytes are inlined.
// 3. CSP keeps the bundle's own meta and adds file: to script-src/style-src
//    (shell template precedent: script-src file: — 'self' alone does not
//    cover file:// scripts in the kiosk Chromium). connect-src and the rest
//    are unchanged: generation.murakumo.cloud only.
import { build } from "esbuild";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCITTLE_RE = /<script type="application\/x-scittle" src="(\.\/[^"]+)"><\/script>/g;
const MODULE_TAG = '<script type="module" src="./studio-host.js">';
// Classic scripts run immediately; the original module was deferred, so keep
// defer to run after parsing (getElementById needs the body).
const BUNDLED_TAG = '<script defer src="./assets/dougaka-host.js">';

export async function buildDougaka({ vendorDir = "vendor-dougaka", outDir = "dist/dougaka" } = {}) {
  await mkdir(`${outDir}/assets`, { recursive: true });
  await mkdir(`${outDir}/vendor`, { recursive: true });
  await build({
    entryPoints: { "dougaka-host": `${vendorDir}/studio-host.js` },
    bundle: true,
    minify: true,
    format: "iife",
    outdir: `${outDir}/assets`,
    logLevel: "warning",
  });
  for (const file of await readdir(`${vendorDir}/vendor`)) {
    await copyFile(join(vendorDir, "vendor", file), join(outDir, "vendor", file));
  }
  for (const file of ["kotoba-client-consent.css", "studio.css"]) {
    await copyFile(join(vendorDir, file), join(outDir, file));
  }
  let html = await readFile(join(vendorDir, "index.html"), "utf8");
  if (!html.includes(MODULE_TAG)) throw new Error("module entry tag not found");
  html = html.replace(MODULE_TAG, BUNDLED_TAG);
  const sources = [...html.matchAll(SCITTLE_RE)].map((match) => match[1]);
  if (sources.length === 0) throw new Error("no x-scittle sources found");
  const bodies = new Map();
  for (const src of sources) bodies.set(src, await readFile(join(vendorDir, src), "utf8"));
  html = html.replace(SCITTLE_RE, (_, src) => `<script type="application/x-scittle">${bodies.get(src)}</script>`);
  html = html
    .replace("script-src 'self'", "script-src 'self' file:")
    .replace("style-src 'self'", "style-src 'self' file:");
  await writeFile(`${outDir}/index.html`, html);
  return { inlined: sources, outDir };
}

if (process.argv[1] && import.meta.url.endsWith("/dougaka-bundle.mjs")) {
  await buildDougaka();
}
