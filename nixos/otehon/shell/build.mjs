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
import { osOperations, phoneOperations, runtimeDescriptor } from "./src/runtime.js";
import { scriptSrc, styleSrc, staticReportConnectSrc } from "./src/csp.js";

const relayOrigin = process.env.RELAY_ORIGIN ?? "https://relay.awai.network";
// OTEHON_HTTP=1 builds the shell for the loopback preview server instead of
// the file:// kiosk. The http output must never ship in the OS image: its
// script/style sources allow 'self' so the page runs over http.
const cspMode = process.env.OTEHON_HTTP === "1" ? "http" : "file";

const mvnRepo = process.env.MVN_REPO;
const clojure = (args) => execFileSync("clojure", [
  // The Nix image build pins an offline Maven repo (desktop.nix) because its
  // sandbox has no network. Local builds omit MVN_REPO and use ~/.m2.
  ...(mvnRepo ? ["-Sdeps", `{:mvn/local-repo "${mvnRepo}"}`] : []),
  "-M", ...args,
], { stdio: "inherit" });

// Garden stylesheets first (dist CSS), then the two browser bundles.
clojure(["-m", "shell.styles.build"]);
clojure(["-m", "shadow.cljs.devtools.cli", "release", "shell"]);
clojure(["-m", "shadow.cljs.devtools.cli", "release", "link"]);
clojure(["-m", "shadow.cljs.devtools.cli", "release", "soshiki-runtime"]);
await mkdir("dist/soshiki-runtime", { recursive: true });
const chatConnect = clientRuntimeConnectSrc(runtimeDescriptor("soshiki-runtime/index.html", osOperations(relayOrigin)), [...new Set(osOperations(relayOrigin).map(o => o.capability))], [], []);
await writeFile("dist/soshiki-runtime/index.html", (await readFile("soshiki-runtime/index.html", "utf8")).replace("__CONNECT_SRC__", `${chatConnect} 'self'`));

async function page({ html, outdir, operations, appOrigins }) {
  await mkdir(`${outdir}/assets`, { recursive: true });
  await copyFile("vendor/kotoba-client-consent.css", `${outdir}/assets/consent.css`);
  const capabilities = [...new Set(operations.map((operation) => operation.capability))];
  const connect = staticReportConnectSrc(
    clientRuntimeConnectSrc(runtimeDescriptor("index.html", operations), capabilities, [], appOrigins),
    cspMode, outdir === "dist",
  );
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
