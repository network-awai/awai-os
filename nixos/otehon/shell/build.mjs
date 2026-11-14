// Build the OS shell (dist/) and the phone page (dist/link/).
// Views are ClojureScript (Reagent/Hiccup) compiled by shadow-cljs and
// stylesheets are Garden data compiled on the JVM; both need `clojure` on
// PATH (Nix provides pkgs.clojure). esbuild remains only for the optional
// Node test driver. The connect-src of each page comes from its operations,
// through the shared runtime's own derivation.
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { clientRuntimeConnectSrc } from "./vendor/kotoba-client-runtime.js";

// The ClojureScript build reads the broker runtime from inside src/.
await copyFile("vendor/kotoba-client-runtime.js", "src/vendor-runtime.gen.js");
const { osOperations, phoneOperations, runtimeDescriptor } = await import("./src/runtime.js");
import { scriptSrc, styleSrc, imageSrc } from "./src/csp.js";
import { buildDougaka } from "./dougaka-bundle.mjs";

const relayOrigin = process.env.RELAY_ORIGIN ?? "https://relay.awai.network";
// OTEHON_HTTP=1 builds for the stable loopback OS origin and HTTP preview.
// File-mode remains only for legacy images; profile migration is a separate gate.
const cspMode = process.env.OTEHON_HTTP === "1" ? "http" : "file";

const mvnRepo = process.env.MVN_REPO;
// The Nix image build pins a read-only store path; Maven writes lock files
// next to cached artifacts, so resolve a writable copy once. A writable
// input (local ~/.m2 builds) is returned as-is.
import { resolveWritableRepo } from "./mvn-repo.mjs";
const activeMvnRepo = mvnRepo ? resolveWritableRepo(mvnRepo) : undefined;
const clojure = (args) => execFileSync("clojure", [
  // The Nix image build pins an offline Maven repo (desktop.nix) because its
  // sandbox has no network. Local builds omit MVN_REPO and use ~/.m2.
  ...(activeMvnRepo ? ["-Sdeps", `{:mvn/local-repo "${activeMvnRepo}"}`] : []),
  "-M", ...args,
], { stdio: "inherit" });

// Garden stylesheets first (dist CSS), then the two browser bundles.
clojure(["-m", "shell.styles.build"]);
clojure(["-m", "shadow.cljs.devtools.cli", "release", "shell"]);
clojure(["-m", "shadow.cljs.devtools.cli", "release", "link"]);

async function page({ html, outdir, operations, appOrigins }) {
  await mkdir(`${outdir}/assets`, { recursive: true });
  await copyFile("vendor/kotoba-client-consent.css", `${outdir}/assets/consent.css`);
  await copyFile("assets/awai-logo.png", `${outdir}/assets/awai-logo.png`);
  const capabilities = [...new Set(operations.map((operation) => operation.capability))];
  const connect = clientRuntimeConnectSrc(runtimeDescriptor("index.html", operations), capabilities, [], appOrigins);
  const template = await readFile(html, "utf8");
  // The dapp catalog cannot be required by shadow-cljs, so it is embedded as
  // JSON for the shell to parse. dapps.json stays the source of truth (Nix
  // reads it too). Only the shell page carries the placeholder.
  const catalog = JSON.stringify(JSON.parse(await readFile("src/dapps.json", "utf8")));
  await writeFile(
    `${outdir}/index.html`,
    template
      .replace("__CONNECT_SRC__", connect)
      .replace("__SCRIPT_SRC__", scriptSrc(cspMode))
      .replace("__STYLE_SRC__", styleSrc(cspMode))
      .replace("__IMAGE_SRC__", imageSrc(cspMode))
      .replace("__DAPPS_JSON__", catalog)
      .replace("__RELAY_ORIGIN__", relayOrigin),
  );
}

await page({
  html: "index.html",
  outdir: "dist",
  operations: osOperations(relayOrigin),
  appOrigins: [],
});
await page({
  html: "link/index.html",
  outdir: "dist/link",
  operations: phoneOperations(relayOrigin),
  appOrigins: ["https://awai.network"],
});

// Dougaka Studio: the vendored static bundle re-laid for file://
// (bundled host, inlined scittle, file: CSP). The page carries its own
// descriptor and per-operation consent; no shell broker changes.
await buildDougaka({ vendorDir: "vendor-dougaka", outDir: "dist/dougaka" });

if (process.env.OTEHON_E2E === "1") {
  await build({
    entryPoints: ["test/e2e-driver.mjs"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: "dist/e2e-driver.mjs",
    define: {
      "process.env.NODE_ENV": '"production"',
      RELAY_ORIGIN: JSON.stringify(relayOrigin),
    },
    logLevel: "warning",
  });
}
