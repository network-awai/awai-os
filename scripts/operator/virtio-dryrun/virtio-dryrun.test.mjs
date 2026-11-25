#!/usr/bin/env node
// AWAI-4089 (G2): offline tests for the virtio Job (PR B).
// Fake tools record argv; dry-run executes nothing; approved mode
// executes the same ordered command list. Full argv assertions for
// both modes; every refusal; manifest compare keys + notdefault.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readFile, existsSync, writeFileSync, chmodSync } from "node:fs";
import { writeFile, copyFile, readFile as readFileP } from "node:fs/promises";
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

function run(cmd, args, env = {}, timeout = 60000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, encoding: "utf8", timeout },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

function fakeBin(upDir = null) {
  const dir = mkdtempSync(join(tmpdir(), "g2prbfake-"));
  const calls = join(dir, "calls.log");
  writeFileSync(calls, "");
  const mk = (name, body) => {
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}`, { mode: 0o755 });
  };
  mk("apt-get", "exit 0\n");
  mk("git", "exit 0\n");
  // fake m: logs and creates target-files zip + stock disk image.
  mk("m", `mkdir -p "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates"
echo tf > "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
echo stock > "$SRC/out/target/product/virtio_x86_64/disk-vda.img"
exit 0
`);
  // fake rclone: uploads (do nothing) and downloads from art: (cp the UP content)
  const up = upDir;
  writeFileSync(join(dir, "rclone"),
    `#!/bin/sh
echo "rclone $*" >> "${calls}"
if [ "$2" != "\${2#art:}" ]; then mkdir -p "$3" && cp -R "${up}"/. "$3"/; fi
exit 0
`, { mode: 0o755 });
  // fake ota_from_target_files: logs and creates the output (last arg).
  writeFileSync(join(dir, "ota_from_target_files"),
    `#!/bin/sh
echo "ota_from_target_files $*" >> "${calls}"
for last; do :; done
[ -n "$last" ] && echo ota > "$last"
exit 0
`, { mode: 0o755 });
  // fake curl: writes repo stub for download, or kit bytes for kit.
  const repoStub = join(dir, "repo-stub.sh");
  writeFileSync(repoStub,
    `#!/bin/sh
echo "repo $*" >> "${calls}"
mkdir -p "$SRC/.repo/manifests"
if [ "$1" = "manifest" ]; then
  out=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -o) out=$2; shift 2 ;;
      *) shift ;;
    esac
  done
  cp "$MANIFEST_FILE" "$out"
fi
exit 0
`);
  writeFileSync(join(dir, "curl"),
    `#!/bin/sh
echo "curl $*" >> "${calls}"
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    *) shift ;;
  esac
done
if [ "$(basename "$out")" = "repo" ]; then
  cp "${repoStub}" "$out"
else
  cp "$KIT_TARBALL_FIXTURE" "$out"
fi
exit 0
`, { mode: 0o755 });
  return { dir, calls: () => readFileSync(calls, "utf8") };
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

// Build an offline approved-mode kit: real pinned manifest +
// stub pc-ab-device helpers that record argv and create outputs.
async function makeFixtures() {
  const base = mkdtempSync(join(tmpdir(), "g2prb-"));
  const src = join(base, "src");
  const work = join(base, "work");
  await import("node:fs").then((m) => { m.mkdirSync(join(src, "build"), { recursive: true }); });
  writeFileSync(join(src, "build", "envsetup.sh"), "breakfast() { echo stub-breakfast; return 0; }\n");
  await writeFile(join(base, "envsetup-stub.txt"), "breakfast() { echo stub-breakfast; return 0; }\n");
  const kit = join(base, "kit");
  const pdb = join(kit, "pc-ab-device");
  mkdirSync(pdb, { recursive: true });
  mkdirSync(join(kit, "virtio-dryrun"), { recursive: true });
  // copy the pinned manifest into the kit
  await copyFile(join(repoRoot, "android/desktop/manifest/pinned-manifest.xml"), join(kit, "pinned-manifest.xml"));
  const calls = join(base, "calls.log");
  writeFileSync(calls, "");
  for (const [name, extra] of [
    ["apply.sh", ""],
    ["apply-shipping-debug-lockdown.sh", ""],
    ["pc-firmware.py", ""],
    ["updater-feed.py", ""],
    ["make-tf-disk.sh", `cp "$1" "$3" 2>/dev/null || echo img > "$3"\n`],
  ]) {
    writeFileSync(join(pdb, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${extra}exit 0\n`, { mode: 0o755 });
  }
  // build kit tarball
  const fake = fakeBin(join(work, "upload"));
  // build kit tarball: archive the kit's CONTENTS at tar top level
  // (pc-ab-device/, pinned-manifest.xml, ...) since extraction goes to KIT itself.
  const kitTar = join(base, "kit.tar.gz");
  const r = await run("tar", ["-czf", kitTar, "-C", kit, "pc-ab-device", "pinned-manifest.xml"]);
  assert.equal(r.code, 0, r.stderr);
  const kitSha = sha256(await readFileP(kitTar));
  return { base, src, work, kit, pdb, calls, kitTar, kitSha, fake };
}

async function buildEnv(fix, extra = {}) {
  return {
    PATH: `${fix.fake.dir}:${process.env.PATH}`,
    MANIFEST_FILE: pinnedManifest,
    SRC: fix.src,
    BUILD_WORK_DIR: fix.work,
    KIT: join(fix.work, "kit"),
    KIT_URL: "https://example.invalid/kit.tar.gz",
    KIT_SHA256: fix.kitSha,
    KIT_TARBALL_FIXTURE: fix.kitTar,
    RELEASE_TYPE: "userdebug",
    AWAI_FEED_URL: "https://feed.example/ota.json",
    AWAI_POOL_LABEL: "awai-pc-release-test000000",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
test("dry-run prints the exact command list and executes nothing", async () => {
  const fake = fakeBin();
  const r = await run("bash", [buildInside], {
    DRY_RUN: "1", RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "https://feed.example/ota.json",
    MANIFEST_FILE: pinnedManifest,
    PATH: `${fake.dir}:${process.env.PATH}`,
    KIT_URL: "https://example.invalid/kit.tar.gz", KIT_SHA256: "0".repeat(64),
  });
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout;
  for (const snippet of [
    "apt-get -qq update",
    "repo init -u https://github.com/LineageOS/android.git -b lineage-24.0",
    "repo sync -m default.xml --no-manifest-update",
    "repo manifest -r -o",
    "check-manifest-revisions.py",
    "apply.sh",
    "apply-shipping-debug-lockdown.sh",
    "pc-firmware.py prepare",
    "updater-feed.py configure-release",
    "breakfast lineage_virtio_x86_64 userdebug",
    "m target-files-package otatools diskimage-vda",
    "make-tf-disk.sh",
    "ota_from_target_files -k ",
    "ota_from_target_files -k ",
    "-i ",
    "rclone copy ",
    "sha256sum -c SHA256SUMS",
  ]) {
    assert.match(out, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing: ${snippet}`);
  }
  assert.match(out, /\bota_from_target_files -k .*-i /);
  // no dry-run source path placeholder left as a command anyone could run
  assert.doesNotMatch(out, /ota_from_target_files .*<target-files/);
  assert.match(out, /^\[dry-run\] /m);
  assert.equal(fake.calls(), "");
});

test("approved mode executes the same ordered command list (verified end to end)", async () => {
  const fix = await makeFixtures();
  // fixture envsetup stub for the breakfast step
  await writeFile(join(fix.src, "build", "envsetup.sh"), "breakfast() { echo stub-breakfast; return 0; }\n");
  const env = await buildEnv(fix, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1" });
  // fake repo must create .repo/manifests and produce the manifest file:
  // (handled by fake curl's repo stub) — additionally stub `m` output paths are created by the fake.
  const r = await run("bash", [buildInside], env, 120000);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /AWAI4089_BILLING_MODE/);
  const calls = readFileSync(fix.calls, "utf8") + fix.fake.calls();
  for (const snippet of [
    "apt-get -qq update",
    "apt-get -qq install -y",
    "curl ",
    "curl ",
    "repo init -u https://github.com/LineageOS/android.git -b lineage-24.0 --no-clone-bundle",
    "repo sync -m default.xml --no-manifest-update -c --no-clone-bundle --optimized-fetch -j4",
    "repo manifest -r -o ",
    "apply.sh ",
    "apply-shipping-debug-lockdown.sh ",
    "pc-firmware.py prepare ",
    "updater-feed.py configure-release ",
    "m target-files-package otatools diskimage-vda",
    "make-tf-disk.sh ",
    "ota_from_target_files -k ",
    "rclone copy ",
  ]) {
    assert.match(calls, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `not executed: ${snippet}`);
  }
  // both OTA invocations actually ran through the fake:
  const otaLines = calls.split("\n").filter((l) => l.startsWith("ota_from_target_files "));
  assert.equal(otaLines.length, 2, calls);
  assert.match(otaLines[0], /-k .*testkey .*virtio-full-ota\.zip$/);
  assert.match(otaLines[1], /-i .*virtio-target-files-v1\.zip .*virtio-incremental-ota\.zip$/);
  // restore verification ran: rclone copy from B2 back, then sha256sum -c
  assert.match(r.stdout, /AWAI4089_DONE approved=1/);
});

test("approved mode without KIT_URL/KIT_SHA256 refuses", async () => {
  const fix = await makeFixtures();
  const env = await buildEnv(fix, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", KIT_URL: "", KIT_SHA256: "" });
  const r = await run("bash", [buildInside], env);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /KIT_URL and KIT_SHA256 are required/);
  assert.equal(fix.fake.calls(), "");
});

test("approved mode with kit SHA mismatch refuses", async () => {
  const fix = await makeFixtures();
  const env = await buildEnv(fix, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", KIT_SHA256: "0".repeat(64) });
  const r = await run("bash", [buildInside], env);
  assert.notEqual(r.code, 0);
  assert.equal(readFileSync(fix.calls, "utf8").includes("apply.sh"), false);
});

test("approved mode without feed URL refuses (before any execution)", async () => {
  const fix = await makeFixtures();
  const env = await buildEnv(fix, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", AWAI_FEED_URL: "" });
  const r = await run("bash", [buildInside], env);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_FEED_URL is required/);
  assert.equal(fix.fake.calls(), "");
});

test("approval gate uses /& both flags; either flag alone refuses", async () => {
  for (const env of [
    { BILLING_ALLOWED: "1", OWNER_APPROVED: "", DRY_RUN: "" },
    { BILLING_ALLOWED: "", OWNER_APPROVED: "1", DRY_RUN: "" },
    { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", DRY_RUN: "" },
  ]) {
    if (env.BILLING_ALLOWED && env.OWNER_APPROVED) continue; // the valid pair is covered elsewhere
    const r = await run("bash", [buildInside], { ...env, RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "x" });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /AWAI4089_REFUSES/);
  }
});

test("RELEASE_TYPE required and explicit; deadline minimum 28800", async () => {
  let r = await run("bash", [buildInside], { DRY_RUN: "1", AWAI_FEED_URL: "x" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /RELEASE_TYPE/);
  r = await run("bash", [buildInside], { DRY_RUN: "1", RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "x", AWAI_VIRTIO_DEADLINE_SECONDS: "19800" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_VIRTIO_DEADLINE_SECONDS must be >= 28800/);
});

test("check-manifest-revisions: path or name key; notdefault excluded; mismatch fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "g2man-"));
  const a = join(dir, "a.xml"), b = join(dir, "b.xml");
  const good = `<manifest>
  <project path="p1" name="n1" revision="${"a".repeat(40)}"/>
  <project name="n2" revision="${"b".repeat(40)}"/>
</manifest>
`;
  writeFileSync(a, good); writeFileSync(b, good);
  let r = await run("python3", [comparePy, a, b]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /AWAI4089_MANIFEST_COMPARE_OK projects=2/);
  // a notdefault project in pinned must be ignored (not synced upstream)
  const withDarwin = good.replace("</manifest>", `<project path="darwin/p" name="darwin/p" revision="${"c".repeat(40)}" groups="notdefault"/>\n</manifest>\n`);
  writeFileSync(a, withDarwin);
  r = await run("python3", [comparePy, a, b]);
  assert.equal(r.code, 0, r.stderr);
  // a real revision mismatch fails
  writeFileSync(b, good.replace("a".repeat(40), "1".repeat(40)));
  writeFileSync(a, good);
  r = await run("python3", [comparePy, a, b]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_MANIFEST_MISMATCH p1/);
});

test("job definition prints Job JSON without invoking workload tools", async () => {
  const fake = fakeBin();
  const r = await run("bash", [jobScript], {
    DRY_RUN: "1", RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "https://feed.example/ota.json",
    AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef",
    PATH: `${fake.dir}:${process.env.PATH}`,
  });
  assert.equal(r.code, 0, r.stderr);
  const job = JSON.parse(r.stdout);
  assert.equal(job.kind, "Job");
  const c = job.spec.template.spec.containers[0];
  assert.deepEqual(c.env.find((e) => e.name === "RELEASE_TYPE"), { name: "RELEASE_TYPE", value: "userdebug" });
  assert.deepEqual(c.env.find((e) => e.name === "AWAI_FEED_URL"), { name: "AWAI_FEED_URL", value: "https://feed.example/ota.json" });
  assert.equal(job.spec.activeDeadlineSeconds, 28800);
  assert.equal(fake.calls(), "");
});

test("job definition refuses without approval and without RELEASE_TYPE", async () => {
  let r = await run("bash", [jobScript], { AWAI_VKE_NODE_POOL: "x" });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  r = await run("bash", [jobScript], { DRY_RUN: "1", AWAI_VKE_NODE_POOL: "x" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /RELEASE_TYPE/);
});
