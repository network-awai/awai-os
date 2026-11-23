import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(root, "vendor/THIRD-PARTY-LICENSES.md");

// AWAI-3883 vendor license attribution: the kotoba runtime is public Apache-2.0
// (kotoba-lang/kotoba), not internal. Each vendored file needs its own section with
// filename, SPDX and upstream source, plus the full licence texts (Apache-2.0 §4(d)).
const EXPECTED = [
  {
    file: "kotoba-client-runtime.js",
    spdx: "Apache-2.0",
    source: "kotoba-lang/kotoba",
    upstreamPath: "lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js",
  },
  {
    file: "kotoba-client-consent.css",
    spdx: "Apache-2.0",
    source: "kotoba-lang/kotoba",
    upstreamPath: "lib/kotoba.wasmWebcomponent/src/kotoba-client-consent.css",
  },
  {
    file: "awai-inference-client.js",
    spdx: "internal, no third-party licence",
    source: "packages/awai-inference",
    upstreamPath: "packages/awai-inference",
  },
  {
    file: "egov/gyosei.html",
    spdx: "Apache-2.0",
    source: "network-awai/app-itonami-egov",
    upstreamPath: "dist/gyosei.html",
  },
];

test("every vendored file has an attribution section with SPDX and upstream source", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  for (const entry of EXPECTED) {
    const heading = `## vendor/${entry.file}`;
    const start = bundle.indexOf(heading);
    assert.notEqual(start, -1, `missing section ${heading}`);
    const rest = bundle.slice(start);
    const next = rest.indexOf("\n## vendor/");
    const section = next === -1 ? rest : rest.slice(0, next);
    assert.ok(section.includes(entry.spdx), `${entry.file}: SPDX ${entry.spdx} missing`);
    assert.ok(section.includes(entry.source), `${entry.file}: source ${entry.source} missing`);
    assert.ok(section.includes(entry.upstreamPath), `${entry.file}: upstream path ${entry.upstreamPath} missing`);
  }
});

test("the full Apache-2.0 text and the kotoba NOTICE are bundled byte-present", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  // Apache-2.0: preamble, terms end, appendix.
  assert.ok(bundle.includes("Apache License\n                           Version 2.0, January 2004"), "Apache preamble");
  assert.ok(bundle.includes("END OF TERMS AND CONDITIONS"), "Apache terms end");
  assert.ok(bundle.includes("APPENDIX: How to apply the Apache License"), "Apache appendix");
  assert.ok(bundle.includes("SPDX-Identifier"), "SPDX marker");
  // kotoba NOTICE (Apache-2.0 §4(d)).
  assert.ok(bundle.includes("kotoba\nCopyright 2026 Jun Kawasaki"), "NOTICE copyright");
  assert.ok(bundle.includes("https://github.com/kotoba-lang"), "NOTICE project URL");
});

test("completeness: every vendored script/style file has a per-file section", async () => {
  const bundle = await readFile(bundlePath, "utf8");
  const found = [];
  async function walk(dir, prefix) {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${name.name}` : name.name;
      if (name.isDirectory()) await walk(path.join(dir, name.name), rel);
      else if (/\.(js|css|html)$/.test(name.name)) found.push(rel);
    }
  }
  await walk(path.join(root, "vendor"), "");
  assert.ok(found.length > 0, "no vendored files found");
  for (const rel of found.sort()) {
    assert.ok(bundle.includes(`## vendor/${rel}`), `vendored file without a section: ${rel}`);
  }
});
