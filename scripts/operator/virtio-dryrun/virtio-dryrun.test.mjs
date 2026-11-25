#!/usr/bin/env node
// AWAI-4089 (G2): offline tests for the virtio dry-run Job.
// Follows the repo's fake-tool pattern (scripts/operator/testdata/):
// PATH-provided fakes record every invocation; happy-path runs must
// leave the fakes' logs empty (dry-run prints, never executes).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const buildInside = join(here, "build-inside.sh");
const jobScript = join(here, "virtio-job.sh");
const comparePy = join(here, "check-manifest-revisions.py");
const repoRoot = join(here, "../../..");
const pinnedManifest = join(repoRoot, "android/desktop/manifest/pinned-manifest.xml");

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, encoding: "utf8" },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

function fakeBin() {
  const dir = mkdtempSync(join(tmpdir(), "g2fakebin-"));
  const calls = join(dir, "calls.log");
  writeFileSync(calls, "");
  for (const name of ["kubectl", "repo"]) {
    writeFileSync(join(dir, name),
      `#!/bin/sh\necho "${name} $*" >> "${calls}"\nexit 99\n`, { mode: 0o755 });
  }
  return { dir, calls: () => readFileSync(calls, "utf8") };
}

test("missing approval (DRY_RUN unset, BILLING/OWNER unset) aborts", async () => {
  const r = await run("bash", [buildInside], { DRY_RUN: "" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI4089_REFUSES: DRY_RUN=1 \(default\) or BILLING_ALLOWED=1\+OWNER_APPROVED=1/);
  assert.equal(r.stdout, "");
});

test("approval gate uses /& both flags; either flag alone refuses", async () => {
  for (const env of [
    { BILLING_ALLOWED: "1", OWNER_APPROVED: "", DRY_RUN: "" },
    { BILLING_ALLOWED: "", OWNER_APPROVED: "1", DRY_RUN: "" },
  ]) {
    const r = await run("bash", [buildInside], env);
    assert.equal(r.code, 2, JSON.stringify(env));
    assert.match(r.stderr, /AWAI4089_REFUSES/);
  }
});

test("RELEASE_TYPE is required and explicit (no silent default, no other values)", async () => {
  for (const t of ["", "eng", "16.0", "userdebug "]) {
    const r = await run("bash", [buildInside],
      { DRY_RUN: "1", MANIFEST_FILE: pinnedManifest, RELEASE_TYPE: t });
    assert.equal(r.code, 2, JSON.stringify(t));
    assert.match(r.stderr, /AWAI4089_REFUSES: RELEASE_TYPE must be explicitly set/);
  }
  for (const t of ["user", "userdebug"]) {
    const r = await run("bash", [buildInside],
      { DRY_RUN: "1", MANIFEST_FILE: pinnedManifest, RELEASE_TYPE: t });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`AWAI4089_RELEASE_TYPE=${t}`));
  }
});

test("deadline minimum is 28800 (8h per Job)", async () => {
  const r = await run("bash", [buildInside], {
    DRY_RUN: "1", MANIFEST_FILE: pinnedManifest, RELEASE_TYPE: "userdebug",
    AWAI_VIRTIO_DEADLINE_SECONDS: "19800",
  });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_VIRTIO_DEADLINE_SECONDS must be >= 28800/);
  const ok = await run("bash", [buildInside], {
    DRY_RUN: "1", MANIFEST_FILE: pinnedManifest, RELEASE_TYPE: "userdebug",
    AWAI_VIRTIO_DEADLINE_SECONDS: "28800",
  });
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /AWAI4089_DEADLINE_SECONDS=28800/);
});

test("manifest sha256 is validated before anything else", async () => {
  const bad = join(mkdtempSync(join(tmpdir(), "g2badman-")), "pinned-manifest.xml");
  writeFileSync(bad, "<manifest/>\n");
  const r = await run("bash", [buildInside],
    { DRY_RUN: "1", MANIFEST_FILE: bad, RELEASE_TYPE: "userdebug" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_REFUSES: pinned manifest SHA-256 differs/);
  assert.doesNotMatch(r.stdout, /repo init/);
});

test("dry-run prints the real chain and never invokes faked tools", async () => {
  const fake = fakeBin();
  const r = await run("bash", [buildInside], {
    DRY_RUN: "1", RELEASE_TYPE: "userdebug",
    MANIFEST_FILE: pinnedManifest,
    PATH: `${fake.dir}:${process.env.PATH}`,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /AWAI4089_MANIFEST_SHA256_VALIDATED 61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d/);
  assert.match(r.stdout, /repo init -u https:\/\/github\.com\/LineageOS\/android\.git -b lineage-24\.0/);
  assert.match(r.stdout, /install pinned manifest as-is: .*\.repo\/manifests\/default\.xml/);
  assert.match(r.stdout, /repo sync -m default --no-manifest-update/);
  assert.match(r.stdout, /NOT RUN under DRY_RUN/);
  assert.match(r.stdout, /check-manifest-revisions\.py.*compare all 1264/);
  // Repo's own tools, no second explicit patch list.
  assert.match(r.stdout, /bash .*pc-ab-device\/apply\.sh/);
  assert.match(r.stdout, /bash .*pc-ab-device\/apply-shipping-debug-lockdown\.sh/);
  assert.match(r.stdout, /python3 .*\/pc-firmware\.py prepare/);
  assert.match(r.stdout, /python3 .*\/updater-feed\.py configure-release/);
  assert.match(r.stdout, /breakfast lineage_virtio_x86_64 userdebug/);
  assert.match(r.stdout, /m target-files-package otatools diskimage-vda/);
  assert.match(r.stdout, /make-tf-disk\.sh/);
  assert.match(r.stdout, /updater-feed\.py generate-ota/);
  assert.match(r.stdout, /full OTA/);
  assert.match(r.stdout, /incremental OTA/);
  assert.match(r.stdout, /upload v1 to B2 BEFORE the v2 build/);
  assert.match(r.stdout, /v2 build/);
  assert.match(r.stdout, /restore verify/);
  // Single explicit-list lines: no repo sync printed as runnable.
  assert.doesNotMatch(r.stdout, /git -C \/root\/build\/src\/\S+ apply --check/);
  // Exclusions are printed, not applied.
  assert.match(r.stdout, /EXCLUDED mkbootimg-header-version\.patch/);
  assert.match(r.stdout, /virtio-userdata-ext4-checkpoint\.patch is superseded/);
  assert.equal(fake.calls(), "", `faked tools were invoked: ${fake.calls()}`);
});

test("a non-applicable patch aborts with a clear message", async () => {
  const src = mkdtempSync(join(tmpdir(), "g2badsrc-"));
  const badProj = join(src, "device/virt/virtio-common");
  mkdirSync(badProj, { recursive: true });
  writeFileSync(join(badProj, "BoardConfigCommon.mk"), "this does not match the patch\n");
  const r = await run("bash", [buildInside, "--validate-against", src], {
    DRY_RUN: "1", MANIFEST_FILE: pinnedManifest, RELEASE_TYPE: "userdebug",
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_NOT_APPLICABLE: apply\.sh failed/);
});

test("check-manifest-revisions compares every path->revision entry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "g2manifest-"));
  const a = join(dir, "a.xml"), b = join(dir, "b.xml");
  const good = `<manifest>
  <project path="p1" name="n1" revision="0e8571a0d7fce749856e9dea72e99a8a83f8f9b4"/>
  <project path="p2" name="n2" revision="9d5c9307434bba31d19030fcc61086efcd248997"/>
</manifest>
`;
  writeFileSync(a, good);
  writeFileSync(b, good);
  let r = await run("python3", [comparePy, a, b]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /AWAI4089_MANIFEST_COMPARE_OK projects=2/);
  // Wrong revision on one entry.
  writeFileSync(b, good.replace("0e8571a0d7fce749856e9dea72e99a8a83f8f9b4", "1".repeat(40)));
  r = await run("python3", [comparePy, a, b]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_MANIFEST_MISMATCH p1/);
  // Missing entry.
  writeFileSync(b, `<manifest><project path="p1" name="n1" revision="0e8571a0d7fce749856e9dea72e99a8a83f8f9b4"/></manifest>\n`);
  r = await run("python3", [comparePy, a, b]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_MANIFEST_MISMATCH p2/);
  // Extra entry.
  writeFileSync(b, good + "<!-- p3 -->\n");
  writeFileSync(b, good.replace("</manifest>", '<project path="p3" name="n3" revision="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/></manifest>\n'));
  r = await run("python3", [comparePy, a, b]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_MANIFEST_MISMATCH p3/);
});

test("job definition prints Job JSON without invoking workload tools", async () => {
  const fake = fakeBin();
  const r = await run("bash", [jobScript], {
    DRY_RUN: "1", RELEASE_TYPE: "userdebug",
    AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef",
    PATH: `${fake.dir}:${process.env.PATH}`,
  });
  assert.equal(r.code, 0, r.stderr);
  const job = JSON.parse(r.stdout);
  assert.equal(job.apiVersion, "batch/v1");
  assert.equal(job.kind, "Job");
  const c = job.spec.template.spec.containers[0];
  assert.equal(job.spec.template.spec.nodeSelector["vke.vultr.com/node-pool"], "awai-pc-release-012345abcdef");
  assert.deepEqual(c.env.find((e) => e.name === "DRY_RUN"), { name: "DRY_RUN", value: "1" });
  assert.deepEqual(c.env.find((e) => e.name === "RELEASE_TYPE"), { name: "RELEASE_TYPE", value: "userdebug" });
  assert.equal(job.spec.activeDeadlineSeconds, 28800);
  assert.match(c.command.join(" "), /build-inside\.sh/);
  assert.match(c.command.join(" "), /rclone copy art:awai-os-release-artifacts\/awai-virtio-g2\/kit\//);
  assert.equal(fake.calls(), "", `workload tools were invoked: ${fake.calls()}`);
});

test("job definition without approval refuses (neither DRY_RUN nor BILLING+OWNER)", async () => {
  const r = await run("bash", [jobScript], { AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI4089_REFUSES/);
  assert.equal(r.stdout, "");
  const one = await run("bash", [jobScript],
    { AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef", BILLING_ALLOWED: "1" });
  assert.equal(one.code, 2);
  assert.equal(one.stdout, "");
});

test("job definition accepts explicit BILLING_ALLOWED+OWNER_APPROVED", async () => {
  const r = await run("bash", [jobScript], {
    BILLING_ALLOWED: "1", OWNER_APPROVED: "1", RELEASE_TYPE: "userdebug",
    AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef",
  });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /AWAI4089_BILLING_MODE/);
  const job = JSON.parse(r.stdout);
  const c = job.spec.template.spec.containers[0];
  assert.deepEqual(c.env.find((e) => e.name === "BILLING_ALLOWED"), { name: "BILLING_ALLOWED", value: "1" });
  assert.deepEqual(c.env.find((e) => e.name === "OWNER_APPROVED"), { name: "OWNER_APPROVED", value: "1" });
});

test("job definition refuses without RELEASE_TYPE or with bad deadline", async () => {
  const base = { DRY_RUN: "1", AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef" };
  let r = await run("bash", [jobScript], base);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /RELEASE_TYPE/);
  r = await run("bash", [jobScript],
    { ...base, RELEASE_TYPE: "user", AWAI_VIRTIO_DEADLINE_SECONDS: "19800" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_VIRTIO_DEADLINE_SECONDS must be >= 28800/);
  assert.equal(r.stdout, "");
});

test("job definition refuses without a node-pool selector", async () => {
  const r = await run("bash", [jobScript], { DRY_RUN: "1", RELEASE_TYPE: "user" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI_VKE_NODE_POOL/);
});

// --- scripts/ci/python-suite.sh ------------------------------------------------

const suiteSh = join(repoRoot, "scripts/ci/python-suite.sh");

function fakePython(dir, name, version) {
  writeFileSync(join(dir, name),
    `#!/bin/sh
case "$*" in
  *"sys.version_info"*) echo "${version}" ;;
  *"sys.executable"*) echo "$0";;
  "-c"*) echo "${version}" ;;
  --version) echo "Python ${version}" ;;
  -V) echo "Python ${version}" ;;
  *) echo "fake ${name} unittest-args: $*" >&2; exit 0 ;;
esac
`, { mode: 0o755 });
}

test("python-suite picks >=3.11 among candidates (order python3, .13, .12, .11)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "g2py-"));
  fakePython(dir, "python3", "3.9.6");
  fakePython(dir, "python3.12", "3.12.4");
  fakePython(dir, "python3.11", "3.11.9");
  const r = await run("bash", [suiteSh, "-c", "import sys; print('py-ok')"], { PATH: `${dir}:/usr/bin:/bin` });
  // fake python3.12 echoes version for -c, so unittest exits non-zero; check the reported pick instead.
  assert.match(r.stdout + r.stderr, /AWAI_PYTHON_SUITE interpreter=.*python3\.12 version=3\.12\.4/);
  assert.doesNotMatch(r.stdout + r.stderr, /AWAI_PYTHON_SUITE_REFUSES/);
});

test("python-suite prefers python3 when it is already >=3.11", async () => {
  const dir = mkdtempSync(join(tmpdir(), "g2py2-"));
  fakePython(dir, "python3", "3.11.9");
  fakePython(dir, "python3.12", "3.12.4");
  const r = await run("bash", [suiteSh, "-c", "pass"], { PATH: `${dir}:/usr/bin:/bin` });
  assert.match(r.stdout + r.stderr, /AWAI_PYTHON_SUITE interpreter=.*python3 version=3\.11\.9/);
});

test("python-suite fails clearly when no >=3.11 interpreter exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "g2py3-"));
  fakePython(dir, "python3", "3.9.6");
  const r = await run("bash", [suiteSh, "-c", "pass"], { PATH: `${dir}:/usr/bin:/bin` });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI_PYTHON_SUITE_REFUSES: no Python >= 3\.11 found/);
});
