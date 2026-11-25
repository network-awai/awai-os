#!/usr/bin/env node
// AWAI-4089 (G2): offline tests for the virtio dry-run Job.
// Follows the repo's fake-tool pattern (scripts/operator/testdata/):
// PATH-provided fakes record every invocation; happy-path runs must
// leave the fakes' logs empty (dry-run prints, never executes).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const buildInside = join(here, "build-inside.sh");
const jobScript = join(here, "virtio-job.sh");
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

test("missing DRY_RUN aborts the build definition", async () => {
  const { env } = { env: { DRY_RUN: "" } };
  const r = await run("bash", [buildInside], env);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI4089_REFUSES: DRY_RUN=1 is required/);
  assert.equal(r.stdout, "");
});

test("manifest sha256 is validated before anything else", async () => {
  const bad = join(mkdtempSync(join(tmpdir(), "g2badman-")), "pinned-manifest.xml");
  writeFileSync(bad, "<manifest/>\n");
  const r = await run("bash", [buildInside], { DRY_RUN: "1", MANIFEST_FILE: bad });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_REFUSES: pinned manifest SHA-256 differs/);
  assert.doesNotMatch(r.stdout, /repo init/);
});

test("dry-run prints the expected steps and never invokes faked tools", async () => {
  const fake = fakeBin();
  const r = await run("bash", [buildInside], {
    DRY_RUN: "1",
    MANIFEST_FILE: pinnedManifest,
    PATH: `${fake.dir}:${process.env.PATH}`,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /AWAI4089_MANIFEST_SHA256_VALIDATED 61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d/);
  assert.match(r.stdout, /repo init -u https:\/\/github\.com\/LineageOS\/android\.git -b lineage-24\.0/);
  assert.match(r.stdout, /install pinned manifest as-is: .*\.repo\/manifests\/default\.xml/);
  assert.match(r.stdout, /NOT RUN: repo sync/);
  assert.match(r.stdout, /breakfast lineage_virtio_x86_64 userdebug/);
  for (const patch of [
    "virtio-common-awai-pc.patch", "virtio-common-aw-mesa-sphal.patch",
    "virtio-userdata-block-checkpoint.patch", "virtio-userdata-ext4-checkpoint-wait.patch",
    "virt-common-awai-pc.patch", "virt-common-awai-boot-name.patch",
    "virt-common-user-no-adb-tcp.patch", "virtio-x86-64-awai-radeon.patch",
    "virtio-x86-64-awai-radeon-default.patch", "vendor-lineage-no-ota-downgrade.patch",
    "vendor-lineage-kernel-output-prefix.patch", "build-no-trade-in-mode-trigger.patch",
    "mainline-common-user-no-insecure-debugging.patch",
    "updater-empty-feed-withdrawal.patch", "updater-serialize-ab-preparation.patch",
    "updater-pc-maintenance.patch", "setupwizard-awai.patch",
  ]) {
    assert.match(r.stdout, new RegExp(patch.replace(/\./g, "\\.")), `missing ${patch}`);
  }
  assert.doesNotMatch(r.stdout, /git -C \S+ apply --check -p1 --unidiff-zero [^ ]*virtio-userdata/);
  assert.match(r.stdout, /EXCLUDED mkbootimg-header-version\.patch/);
  assert.match(r.stdout, /EXCLUDED virtio-userdata\.patch: not chosen/);
  assert.match(r.stdout, /EXCLUDED virtio-userdata-ext4-checkpoint\.patch: obsoleted/);
  assert.match(r.stdout, /m target-files-package otatools/);
  assert.match(r.stdout, /make-tf-disk\.sh/);
  assert.match(r.stdout, /ota_from_target_files <target-files\.zip> <full-ota\.zip>/);
  assert.match(r.stdout, /incremental-ota\.zip/);
  assert.equal(fake.calls(), "", `faked tools were invoked: ${fake.calls()}`);
});

test("a non-applicable patch aborts with a clear message", async () => {
  const src = mkdtempSync(join(tmpdir(), "g2badsrc-"));
  const badProj = join(src, "device/virt/virtio-common");
  mkdirSync(badProj, { recursive: true });
  writeFileSync(join(badProj, "BoardConfigCommon.mk"), "this does not match the patch\n");
  const r = await run("bash", [buildInside, "--validate-against", src], {
    DRY_RUN: "1", MANIFEST_FILE: pinnedManifest,
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_NOT_APPLICABLE: virtio-common-awai-pc\.patch does not apply at device\/virt\/virtio-common/);
});

test("job definition prints Job JSON without invoking workload tools", async () => {
  const fake = fakeBin();
  const r = await run("bash", [jobScript], {
    DRY_RUN: "1",
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
  assert.match(c.command.join(" "), /build-inside\.sh/);
  assert.equal(fake.calls(), "", `workload tools were invoked: ${fake.calls()}`);
});

test("job definition without DRY_RUN aborts and prints nothing", async () => {
  const r = await run("bash", [jobScript], { AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI4089_REFUSES: DRY_RUN=1 is required/);
  assert.equal(r.stdout, "");
});

test("job definition refuses without a node-pool selector", async () => {
  const r = await run("bash", [jobScript], { DRY_RUN: "1" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI_VKE_NODE_POOL/);
});
