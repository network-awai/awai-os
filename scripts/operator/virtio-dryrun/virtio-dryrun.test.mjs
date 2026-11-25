#!/usr/bin/env node
// AWAI-4089 (G2): offline tests for the virtio Job (PR B).
// The kit is a REAL kit built by scripts/operator/virtio-dryrun/
// make-kit.sh <commit> (git archive); the approved end-to-end test
// extracts it into an empty directory and runs the kit's own
// build-inside.sh with the Job's command shape. Stub PATH carries
// external programs only (repo, git, curl, rclone, apt-get,
// ota_from_target_files). `m`/`breakfast` are envsetup.sh functions.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { readFile as readFileP } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const buildInside = join(here, "build-inside.sh");
const makeKit = join(here, "make-kit.sh");
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

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function currentCommit() {
  const r = await run("git", ["rev-parse", "HEAD"], { PATH: process.env.PATH });
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.trim();
}

// Build a REAL kit from the current commit via make-kit.sh and
// extract it into an empty directory.
async function extractedRealKit() {
  const base = mkdtempSync(join(tmpdir(), "g2kit-"));
  const kitTar = join(base, "kit.tar.gz");
  const mk = await run("bash", [makeKit, await currentCommit(), kitTar]);
  assert.equal(mk.code, 0, mk.stderr);
  const kitSha = mk.stdout.trim().split("\n").pop().trim();
  assert.match(kitSha, /^[0-9a-f]{64}$/, mk.stdout);
  const kit = join(base, "kit");
  mkdirSync(kit, { recursive: true });
  const ex = await run("tar", ["-xzf", kitTar, "-C", kit]);
  assert.equal(ex.code, 0, ex.stderr);
  assert.ok(existsSync(join(kit, "android/desktop/manifest/pinned-manifest.xml")));
  assert.ok(existsSync(join(kit, "pc-ab-device/apply.sh")));
  assert.ok(existsSync(join(kit, "scripts/operator/virtio-dryrun/build-inside.sh")));
  assert.ok(existsSync(join(kit, "scripts/operator/virtio-dryrun/check-manifest-revisions.py")));
  assert.ok(existsSync(join(kit, "scripts/operator/same-build/inputs/setupwizard-awai.patch")));
  assert.ok(existsSync(join(kit, "scripts/operator/same-build/inputs/res/layout/awai_welcome_activity.xml")));
  assert.ok(existsSync(join(kit, "scripts/operator/same-build/inputs/setup-logo.png")));
  return { base, kit, kitTar, kitSha };
}

// Stub PATH: external programs only. `m` and `breakfast` are NOT
// binaries here (they are envsetup.sh functions).
function stubPath(work, kitTar) {
  const dir = mkdtempSync(join(tmpdir(), "g2stubs-"));
  const calls = join(dir, "calls.log");
  writeFileSync(calls, "");
  const mk = (name, body) => {
    writeFileSync(join(dir, name),
      `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}`, { mode: 0o755 });
  };
  mk("apt-get", "exit 0\n");
  mk("git", "exit 0\n");
  // timeout stub logs the budget and forwards to the stubbed command
  // (in production `timeout 20m` bounds the firmware fetch).
  writeFileSync(join(dir, "timeout"),
    `#!/bin/sh\necho "timeout $*" >> "${calls}"\nshift\nexec "$@"\n`, { mode: 0o755 });
  const up = join(work, "upload");
  writeFileSync(join(dir, "rclone"),
    `#!/bin/sh
echo "rclone $*" >> "${calls}"
if [ "$2" != "\${2#art:}" ]; then mkdir -p "$3" && cp -R "${up}"/. "$3"/; fi
exit 0
`, { mode: 0o755 });
  writeFileSync(join(dir, "ota_from_target_files"),
    `#!/bin/sh
echo "ota_from_target_files $*" >> "${calls}"
for last; do :; done
[ -n "$last" ] && echo ota > "$last"
exit 0
`, { mode: 0o755 });
  // repo stub, delivered into $(BUILD_WORK_DIR)/bin/repo by fake curl
  const repoStub = join(dir, "repo-stub.sh");
  writeFileSync(repoStub,
    `#!/bin/sh
echo "repo $*" >> "${calls}"
echo "cwd $(pwd)" >> "${calls}"
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
  cp "${kitTar}" "$out"
fi
exit 0
`, { mode: 0o755 });
  // Helper script stubs (shadowed via PATH; in production the kit's
  // real helpers resolve from $KIT/pc-ab-device, which is appended).
  const kcalls = join(dir, "kitcalls.log");
  writeFileSync(kcalls, "");
  for (const [name, extra] of [
    ["apply.sh", ""],
    ["apply-shipping-debug-lockdown.sh", ""],
    ["pc-firmware.py", ""],
    ["updater-feed.py", ""],
    ["make-tf-disk.sh", `cp "$1" "$3" 2>/dev/null || echo img > "$3"\n`],
  ]) {
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${kcalls}"\n${extra}exit 0\n`, { mode: 0o755 });
  }
  return { dir, calls: () => readFileSync(calls, "utf8"), kcalls: () => readFileSync(kcalls, "utf8"), callsFile: calls };
}

function envFor(stub, work, extra = {}) {
  return {
    PATH: `${stub.dir}:${process.env.PATH}`,
    SRC: join(work, "src"),
    BUILD_WORK_DIR: work,
    KIT: join(work, "kit"),
    KIT_URL: "https://example.invalid/kit.tar.gz",
    KIT_SHA256: "0".repeat(64),
    RELEASE_TYPE: "userdebug",
    AWAI_FEED_URL: "https://feed.example/ota.json",
    AWAI_POOL_LABEL: "awai-pc-release-test000000",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
test("dry-run prints the exact command list and executes nothing", async () => {
  const stub = stubPath(join(tmpdir(), "dry-"), undefined);
  const work = join(tmpdir(), "drywork-");
  const r = await run("bash", [buildInside],
    { ...envFor(stub, work), DRY_RUN: "1", PATH: `${stub.dir}:${process.env.PATH}` });
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout;
  const lines = out.split("\n").filter((l) => l.startsWith("[dry-run] "));
  assert.ok(lines.length >= 30, `expected >=30 printed commands, got ${lines.length}`);
  for (const snippet of [
    "apt-get -qq update",
    "apt-get -qq install -y",
    "gdisk",
    "curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo",
    "curl -fsSL https://example.invalid/kit.tar.gz",
    "python3 -c",
    "tar -xzf",
    "git config --global user.email virtio-g2@awai.network",
    "git config --global user.name",
    "repo init -u https://github.com/LineageOS/android.git -b lineage-24.0",
    "repo sync -m default.xml --no-manifest-update",
    "repo manifest -r -o",
    "check-manifest-revisions.py",
    "apply.sh",
    "apply-shipping-debug-lockdown.sh",
    "pc-firmware.py prepare",
    "updater-feed.py configure-release",
    "1d158e23847b5d9f9523ce6cfc51df2b0c54f6cd",
    "setupwizard-awai.patch",
    "awai_welcome_logo.png",
    "ROOMSERVICE_DRYRUN=true",
    "USE_CCACHE=1",
    "source build/envsetup.sh",
    "breakfast virtio_x86_64 userdebug",
    "m target-files-package otatools diskimage-vda",
    "v1-tf",
    "make-tf-disk.sh",
    "ota_from_target_files -k ",
    "ota_from_target_files -k ",
    "rclone copy ",
    "sha256sum",
  ]) {
    assert.match(out, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing: ${snippet}`);
  }
  assert.match(out, /\bota_from_target_files -k .*-i /);
  assert.doesNotMatch(out, /<target-files\.zip>/);
  assert.doesNotMatch(out, /olddefconfig/);
  assert.match(out, /^\[dry-run\] /m);
  assert.equal(stub.calls(), "");
  assert.equal(stub.kcalls(), "");
});

test("approved mode executes the same ordered command list end to end (real kit)", async () => {
  const kitInfo = await extractedRealKit();
  const work = mkdtempSync(join(tmpdir(), "g2work-"));
  // fixture SRC with envsetup functions
  const fncalls = join(work, "fncalls.log");
  writeFileSync(fncalls, "");
  const src = join(work, "src");
  mkdirSync(join(src, "build"), { recursive: true });
  writeFileSync(join(src, "build", "envsetup.sh"),
    `breakfast() { local t=$1 v=\${2:-userdebug}; echo "ro-dryrun=$ROOMSERVICE_DRYRUN ccache=$USE_CCACHE" >> "${fncalls}"; case "$t" in *user|*userdebug|*eng) echo "lunch $t" >> "${fncalls}" ;; *) echo "lunch lineage_$t-ap3a-$v" >> "${fncalls}" ;; esac; }
m() { echo "m $*" >> "${fncalls}";
  mkdir -p "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates"
  echo tf > "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
  echo stock > "$SRC/out/target/product/virtio_x86_64/disk-vda.img"
}
`);
  const stub = stubPath(work, kitInfo.kitTar);
  const env = envFor(stub, work, {
    SRC: src, KIT: kitInfo.kit, KIT_SHA256: kitInfo.kitSha,
    BILLING_ALLOWED: "1", OWNER_APPROVED: "1",
  });
  const script = join(kitInfo.kit, "scripts/operator/virtio-dryrun/build-inside.sh");
  const r = await run("bash", [script], env, 120000);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /AWAI4089_BILLING_MODE/);
  assert.match(r.stdout, /AWAI4089_KIT_PRESENT/);
  assert.match(r.stdout, /AWAI4089_MANIFEST_SHA256_VALIDATED 61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d /);

  const fcalls = stub.calls();
  const order = [
    "apt-get -qq update",
    "apt-get -qq install -y",
    "curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo",
    "git config --global user.email virtio-g2@awai.network",
    "git config --global user.name",
    "repo init -u https://github.com/LineageOS/android.git",
    "repo sync -m default.xml --no-manifest-update",
    "repo manifest -r",
    "git init -q",
    "git -C",
    "SetupWizard checkout 1d158e23847b5d9f9523ce6cfc51df2b0c54f6cd",
    "SetupWizard apply --check",
    "SetupWizard apply",
  ];
  let pos = -1;
  for (const snippet of order) {
    const i = fcalls.indexOf(snippet, pos + 1);
    assert.ok(i > pos, `${snippet} out of order or missing (pos ${pos}, found ${i})`);
    pos = i;
  }
  // repo must have run with cwd === $SRC
  const cwdLines = fcalls.split("\n").filter((l) => l.startsWith("cwd "));
  assert.ok(cwdLines.length >= 3, cwdLines.join("\n"));
  for (const l of cwdLines) assert.equal(l.slice(4), src);

  // envsetup functions recorded: breakfast + m (NOT binaries on PATH)
  const fb = readFileSync(fncalls, "utf8");
  assert.match(fb, /lunch lineage_virtio_x86_64-ap3a-userdebug/);
  assert.match(fb, /ro-dryrun=true/);
  assert.match(fb, /ccache=1/);
  assert.match(fb, /m target-files-package otatools diskimage-vda/);

  // helper stubs (shadowed via PATH) were used
  const kcalls = stub.kcalls();
  for (const s of ["apply.sh ", "apply-shipping-debug-lockdown.sh ", "pc-firmware.py prepare ",
    "updater-feed.py configure-release ", "make-tf-disk.sh "]) {
    assert.ok(kcalls.includes(s), `helper stub not called: ${s}`);
  }
  const otaLines = fcalls.split("\n").filter((l) => l.startsWith("ota_from_target_files "));
  assert.equal(otaLines.length, 2, fcalls);
  assert.match(otaLines[0], /-k .*testkey .*virtio-full-ota\.zip$/);
  assert.match(otaLines[1], /-i .*virtio-target-files-v1\.zip .*virtio-incremental-ota\.zip$/);
  assert.match(r.stdout, /AWAI4089_PATCH_COUNT=/);
  assert.match(r.stdout, /AWAI4089_RESTORE_VERIFY ok/);
  assert.match(r.stdout, /AWAI4089_DONE approved=1/);
});

test("Job command from empty dir runs the extracted kit to restore (real kit)", async () => {
  const kitInfo = await extractedRealKit();
  // kit is trimmed to Job needs and comes from the requested commit.
  const listing = await run("tar", ["-tzf", kitInfo.kitTar]);
  assert.equal(listing.code, 0, listing.stderr);
  for (const want of [
    "scripts/operator/virtio-dryrun/build-inside.sh",
    "android/desktop/manifest/pinned-manifest.xml",
    "pc-ab-device/apply.sh",
    "pc-ab-device/apply-shipping-debug-lockdown.sh",
    "pc-ab-device/pc-firmware.py",
    "pc-ab-device/updater-feed.py",
    "pc-ab-device/make-tf-disk.sh",
    "pc-ab-device/patches/virtio-common-awai-pc-gpu-sysfs.patch",
    "scripts/operator/same-build/inputs/setupwizard-awai.patch",
    "scripts/operator/same-build/inputs/res/layout/awai_welcome_activity.xml",
    "scripts/operator/same-build/inputs/setup-logo.png",
  ]) {
    assert.ok(listing.stdout.includes(want), `kit missing ${want}`);
  }
  for (const banned of ["pc-ab-device/installer/", "pc-ab-device/evidence/", "pc-ab-device/kvm/"]) {
    assert.ok(!listing.stdout.includes(banned), `kit must not contain ${banned}`);
  }
  // No double-apply: #510's stats patch was removed (same-line collision
  // with the Awai Welcome patch), so the kit's only SetupWizard patch
  // is setupwizard-awai.patch, and apply.sh carries no SetupWizard block.
  const setupwizardEntries = listing.stdout.split("\n")
    .filter((l) => l.includes("inputs/setupwizard-") || l.includes("setupwizard-stats"));
  assert.deepEqual(setupwizardEntries, ["./scripts/operator/same-build/inputs/setupwizard-awai.patch"]);
  // Generate the approved Job; its command must fetch+verify+extract
  // the kit itself before running the extracted build-inside.sh.
  const work = mkdtempSync(join(tmpdir(), "g2jobwork-"));
  const gen = await run("bash", [jobScript], {
    BUILD_WORK_DIR: work,
    BILLING_ALLOWED: "1", OWNER_APPROVED: "1", RELEASE_TYPE: "userdebug",
    AWAI_FEED_URL: "https://feed.example/ota.json",
    AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef",
    KIT_URL: "https://example.invalid/kit.tar.gz", KIT_SHA256: kitInfo.kitSha,
    AWAI_POOL_LABEL: "awai-pc-release-012345abcdef",
  });
  assert.equal(gen.code, 0, gen.stderr);
  const job = JSON.parse(gen.stdout);
  const cmdArr = job.spec.template.spec.containers[0].command;
  assert.equal(cmdArr[0], "bash");
  const scriptString = cmdArr[cmdArr.length - 1];
  assert.match(scriptString, /kit\.tar\.gz/);
  assert.match(scriptString, /tar -xzf/);
  assert.match(scriptString, /kit\/scripts\/operator\/virtio-dryrun\/build-inside\.sh/);
  const jobEnv = Object.fromEntries(
    job.spec.template.spec.containers[0].env.map((e) => [e.name, e.value]));
  assert.equal(jobEnv.BUILD_WORK_DIR, work);
  assert.equal(jobEnv.KIT_SHA256, kitInfo.kitSha);
  // plan ceiling (vc2-16c-64gb): see same-build/workflow.sh
  assert.equal(job.spec.template.spec.containers[0].resources.requests.memory, "52Gi");
  assert.match(scriptString, /openjdk-21-jdk-headless/);
  assert.match(scriptString, /gdisk/);
  // fixture SRC with envsetup functions (m/breakfast stay functions)
  const fncalls = join(work, "fncalls.log");
  writeFileSync(fncalls, "");
  const src = join(work, "src");
  mkdirSync(join(src, "build"), { recursive: true });
  writeFileSync(join(src, "build", "envsetup.sh"),
    `breakfast() { local t=$1 v=\${2:-userdebug}; echo "ro-dryrun=$ROOMSERVICE_DRYRUN ccache=$USE_CCACHE" >> "${fncalls}"; case "$t" in *user|*userdebug|*eng) echo "lunch $t" >> "${fncalls}" ;; *) echo "lunch lineage_$t-ap3a-$v" >> "${fncalls}" ;; esac; }
m() { echo "m $*" >> "${fncalls}";
  mkdir -p "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates"
  echo tf > "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
  echo stock > "$SRC/out/target/product/virtio_x86_64/disk-vda.img"
}
`);
  const stub = stubPath(work, kitInfo.kitTar);
  const env = {
    PATH: `${stub.dir}:${process.env.PATH}`,
    BUILD_WORK_DIR: work, SRC: src, KIT: join(work, "kit"),
    KIT_URL: "https://example.invalid/kit.tar.gz", KIT_SHA256: kitInfo.kitSha,
    RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "https://feed.example/ota.json",
    AWAI_POOL_LABEL: "awai-pc-release-012345abcdef",
    BILLING_ALLOWED: "1", OWNER_APPROVED: "1",
  };
  // the kit dir starts empty: only the Job command populates it
  assert.ok(!existsSync(env.KIT));
  const r = await run("bash", cmdArr.slice(1), env, 120000);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(env.KIT, "scripts/operator/virtio-dryrun/build-inside.sh")));
  assert.match(r.stdout, /AWAI4089_KIT_PRESENT/);
  assert.match(r.stdout, /AWAI4089_DONE approved=1/);
  assert.match(r.stdout, /AWAI4089_RESTORE_VERIFY ok/);
  const pcMatch = r.stdout.match(/AWAI4089_PATCH_COUNT=(\d+)/);
  assert.ok(pcMatch, r.stdout);
  const { readdirSync } = await import("node:fs");
  const patchFiles = readdirSync(join(env.KIT, "pc-ab-device", "patches"))
    .filter((n) => n.endsWith(".patch"));
  // count = pc-ab-device patches + the single SetupWizard patch
  assert.equal(Number(pcMatch[1]), patchFiles.length + 1);
  assert.ok(patchFiles.includes("virtio-common-awai-pc-gpu-sysfs.patch"));
  assert.ok(existsSync(join(env.KIT, "scripts/operator/same-build/inputs/setupwizard-awai.patch")));
  assert.ok(existsSync(join(env.KIT, "scripts/operator/same-build/inputs/setup-logo.png")));
  const applySh = readFileSync(join(env.KIT, "pc-ab-device", "apply.sh"), "utf8");
  assert.ok(!applySh.includes("packages/apps/SetupWizard"), "apply.sh must not carry a SetupWizard block");
  const fb = readFileSync(fncalls, "utf8");
  assert.match(fb, /lunch lineage_virtio_x86_64-ap3a-userdebug/);
  assert.match(fb, /ro-dryrun=true/);
  assert.match(fb, /ccache=1/);
  assert.match(fb, /m target-files-package otatools diskimage-vda/);
  const calls = stub.calls();
  const order = [
    "apt-get -qq update",
    "apt-get -qq install -y",
    "curl -fsSL https://example.invalid/kit.tar.gz",
    "repo init -u https://github.com/LineageOS/android.git",
    "repo sync -m default.xml --no-manifest-update",
    "repo manifest -r",
    "timeout 20m git -C",
    "SetupWizard checkout 1d158e23847b5d9f9523ce6cfc51df2b0c54f6cd",
    "SetupWizard apply",
    "rclone copy",
    "rclone copy",
    "ota_from_target_files",
    "rclone copy",
    "rclone copy",
  ];
  let pos = -1;
  for (const snippet of order) {
    const i = calls.indexOf(snippet, pos + 1);
    assert.ok(i > pos, `${snippet} out of order or missing (pos ${pos}, found ${i})\n${calls}`);
    pos = i;
  }
  const rcloneLines = calls.split("\n").filter((l) => l.startsWith("rclone copy "));
  assert.equal(rcloneLines.length, 4, calls);
  assert.match(rcloneLines[0], /v1-tf/);
  assert.match(rcloneLines[3], /^rclone copy art:/);
});

test("approved mode without KIT_URL/KIT_SHA256 refuses (nothing executed)", async () => {
  const stub = stubPath(join(tmpdir(), "x-"), undefined);
  const work = join(tmpdir(), "xwork-");
  const r = await run("bash", [buildInside],
    envFor(stub, work, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", KIT_URL: "", KIT_SHA256: "" }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /KIT_URL and KIT_SHA256 are required/);
  assert.equal(stub.calls(), "");
});

test("approved mode with kit SHA mismatch refuses", async () => {
  const kitInfo = await extractedRealKit();
  const stub = stubPath(kitInfo.base, kitInfo.kitTar);
  const emptyWork = join(kitInfo.base, "emptywork");
  const r = await run("bash", [buildInside],
    envFor(stub, emptyWork, {
      SRC: join(kitInfo.base, "emptykit/src"), KIT: join(kitInfo.base, "emptykit/kit"),
      KIT_URL: "https://example.invalid/kit.tar.gz", KIT_SHA256: "0".repeat(64),
      BILLING_ALLOWED: "1", OWNER_APPROVED: "1",
    }));
  assert.notEqual(r.code, 0);
  assert.equal(stub.kcalls().includes("apply.sh"), false);
});

test("approved mode without feed URL refuses (before any execution)", async () => {
  const stub = stubPath(join(tmpdir(), "z-"), undefined);
  const r = await run("bash", [buildInside],
    envFor(stub, join(tmpdir(), "zwork-"), { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", AWAI_FEED_URL: "" }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_FEED_URL is required/);
  assert.equal(stub.calls(), "");
});

test("approved mode without pool label refuses", async () => {
  const stub = stubPath(join(tmpdir(), "p-"), undefined);
  const r = await run("bash", [buildInside],
    envFor(stub, join(tmpdir(), "pwork-"), { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", AWAI_POOL_LABEL: "" }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_POOL_LABEL is required/);
  assert.equal(stub.calls(), "");
});

test("approval gate requires AND both flags", async () => {
  for (const env of [
    { BILLING_ALLOWED: "1", OWNER_APPROVED: "" },
    { BILLING_ALLOWED: "", OWNER_APPROVED: "1" },
  ]) {
    const r = await run("bash", [buildInside],
      { ...env, RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "x" });
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

test("pinned manifest SHA validated before anything else", async () => {
  const bad = join(tmpdir(), "bad.xml");
  writeFileSync(bad, "<manifest/>\n");
  const r = await run("bash", [buildInside],
    { DRY_RUN: "1", RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "x", MANIFEST_FILE: bad });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_REFUSES: pinned manifest SHA-256 differs/);
  // the manifest is validated from the (fetched) kit, before any
  // source-mutating step: with DRY_RUN=1 the apt steps are only
  // printed, and nothing beyond the manifest check executes.
  assert.doesNotMatch(r.stdout, /repo init|apply\.sh/);
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
  const withDarwin = good.replace("</manifest>", `<project path="darwin/p" name="darwin/p" revision="${"c".repeat(40)}" groups="notdefault"/>\n</manifest>\n`);
  writeFileSync(a, withDarwin);
  r = await run("python3", [comparePy, a, b]);
  assert.equal(r.code, 0, r.stderr);
  writeFileSync(a, good);
  writeFileSync(b, good.replace("a".repeat(40), "1".repeat(40)));
  r = await run("python3", [comparePy, a, b]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_MANIFEST_MISMATCH p1/);
});

test("SetupWizard patches applied in order, exactly once (single awai patch)", async () => {
  const kitInfo = await extractedRealKit();
  // The kit inventories exactly one SetupWizard patch (the Awai Welcome
  // patch from same-build inputs); #510's stats patch was removed because
  // it collides on the same lines, so double-apply cannot happen.
  const { readdirSync } = await import("node:fs");
  const wiz = readdirSync(join(kitInfo.kit, "scripts/operator/same-build/inputs"))
    .filter((n) => n.endsWith(".patch"));
  assert.deepEqual(wiz, ["setupwizard-awai.patch"]);
  const work = mkdtempSync(join(tmpdir(), "g2wiz-"));
  const fncalls = join(work, "fncalls.log");
  writeFileSync(fncalls, "");
  const src = join(work, "src");
  mkdirSync(join(src, "build"), { recursive: true });
  writeFileSync(join(src, "build", "envsetup.sh"),
    `breakfast() { local t=$1 v=\${2:-userdebug}; echo "ro-dryrun=$ROOMSERVICE_DRYRUN ccache=$USE_CCACHE" >> "${fncalls}"; case "$t" in *user|*userdebug|*eng) echo "lunch $t" >> "${fncalls}" ;; *) echo "lunch lineage_$t-ap3a-$v" >> "${fncalls}" ;; esac; }
m() { echo "m $*" >> "${fncalls}";
  mkdir -p "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates"
  echo tf > "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
  echo stock > "$SRC/out/target/product/virtio_x86_64/disk-vda.img"
}
`);
  const stub = stubPath(work, kitInfo.kitTar);
  const env = envFor(stub, work, {
    SRC: src, KIT: kitInfo.kit, KIT_SHA256: kitInfo.kitSha,
    BILLING_ALLOWED: "1", OWNER_APPROVED: "1",
  });
  const r = await run("bash", [join(kitInfo.kit, "scripts/operator/virtio-dryrun/build-inside.sh")], env, 120000);
  assert.equal(r.code, 0, r.stderr);
  // every SetupWizard git invocation, in argv order, before breakfast/m
  const gitLines = stub.calls().split("\n").filter((l) => l.includes("SetupWizard"));
  assert.deepEqual(gitLines, [
    `git -C ${join(src, "packages/apps/SetupWizard")} checkout 1d158e23847b5d9f9523ce6cfc51df2b0c54f6cd`,
    `git -C ${join(src, "packages/apps/SetupWizard")} apply --check ${join(kitInfo.kit, "scripts/operator/same-build/inputs/setupwizard-awai.patch")}`,
    `git -C ${join(src, "packages/apps/SetupWizard")} apply ${join(kitInfo.kit, "scripts/operator/same-build/inputs/setupwizard-awai.patch")}`,
  ]);
  const fb = readFileSync(fncalls, "utf8");
  assert.match(fb, /lunch lineage_virtio_x86_64-ap3a-userdebug/);
  assert.match(fb, /ro-dryrun=true/);
  assert.match(fb, /ccache=1/);
  assert.match(r.stdout, /AWAI4089_PATCH_COUNT=(\d+)/);
});

test("external commands covered by apt, otatools, kit, base image", async () => {
  // Pure text analysis (no execution, no stubs): parse the run commands
  // in build-inside.sh plus the sgdisk call in make-tf-disk.sh, and
  // require every apt-provided command to be in the apt package list
  // (both lists must match: the script's and the Job command's).
  const inside = readFileSync(buildInside, "utf8");
  const jobText = readFileSync(jobScript, "utf8");
  const tfDisk = readFileSync(join(repoRoot, "android/desktop/pc-ab-device/make-tf-disk.sh"), "utf8");
  // command -> provider: apt package | base image | kit | otatools | fetched
  // (apt-get itself comes from the image; it performs the install.)
  const providers = {
    "apt-get": "base", curl: "curl", python3: "python3", git: "git",
    rclone: "rclone", sgdisk: "gdisk",
    chmod: "base", mkdir: "base", cp: "base", ls: "base", wc: "base",
    tr: "base", date: "base", shasum: "base", sha256sum: "base",
    timeout: "base", tar: "base", bash: "base",
    repo: "fetched",
    "apply.sh": "kit", "apply-shipping-debug-lockdown.sh": "kit",
    "pc-firmware.py": "kit", "updater-feed.py": "kit", "make-tf-disk.sh": "kit",
    ota_from_target_files: "otatools",
  };
  const parseRuns = (text) => [...text.matchAll(/^\s*run\s+(\S+)/gm)]
    .map((m) => m[1]).filter((c) => !c.includes("="));
  const commands = new Set([...parseRuns(inside), "sgdisk"]);
  // bash -c strings invoke sha256sum through the shell
  for (const tok of [...inside.matchAll(/\b(sha256sum|shasum)\b/g)]) commands.add(tok[1]);
  // functions stay functions, never binaries
  for (const skip of ["source", "breakfast", "m", "cd", "eval", "export"]) commands.delete(skip);
  // every enumerated command is classified: no unreviewed externals
  for (const cmd of commands) {
    assert.ok(cmd in providers, `external command ${cmd} is unclassified`);
  }
  // otatools covers ota_from_target_files only
  const otatoolsCmds = [...commands].filter((c) => providers[c] === "otatools");
  assert.deepEqual(otatoolsCmds, ["ota_from_target_files"]);
  const parseApt = (text) => {
    const m = text.match(/apt-get -qq install -y ([^\n"]+)/);
    assert.ok(m, "apt package list not found");
    return new Set(m[1].trim().split(/\s+/));
  };
  const check = (pkgs) => [...commands]
    .filter((c) => providers[c] !== "base" && providers[c] !== "kit"
      && providers[c] !== "otatools" && providers[c] !== "fetched")
    .filter((c) => !pkgs.has(providers[c]));
  for (const pkgs of [parseApt(inside), parseApt(jobText)]) {
    assert.deepEqual(check(pkgs), []);
    assert.ok(pkgs.has("gdisk"), "apt list must include gdisk");
  }
  // negative control: without gdisk the checker must flag sgdisk
  const broken = new Set(parseApt(inside));
  broken.delete("gdisk");
  assert.ok(check(broken).includes("sgdisk"), "negative control must detect missing gdisk");
  assert.ok(tfDisk.includes("/usr/sbin/sgdisk"), "make-tf-disk.sh must call sgdisk");
});

test("job definition prints Job JSON (toolchain-first; kit fetch inside Job command)", async () => {
  const fakeDir = mkdtempSync(join(tmpdir(), "g2job-"));
  const callsFile = join(fakeDir, "calls.log");
  writeFileSync(callsFile, "");
  writeFileSync(join(fakeDir, "kubectl"),
    `#!/bin/sh\necho "kubectl $*" >> "${callsFile}"\nexit 99\n`, { mode: 0o755 });
  const r = await run("bash", [jobScript], {
    DRY_RUN: "1", RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "https://feed.example/ota.json",
    AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef",
    PATH: `${fakeDir}:${process.env.PATH}`,
    KIT_URL: "https://example.invalid/kit.tar.gz", KIT_SHA256: "0".repeat(64),
    AWAI_POOL_LABEL: "awai-pc-release-012345abcdef",
  });
  assert.equal(r.code, 0, r.stderr);
  const job = JSON.parse(r.stdout);
  assert.equal(job.kind, "Job");
  const cmd = job.spec.template.spec.containers[0].command.join(" ");
  assert.match(cmd, /apt-get -qq update/);
  assert.ok(cmd.indexOf("apt-get") < cmd.indexOf("rclone"), cmd);
  assert.match(cmd, /curl -fsSL/);
  assert.match(cmd, /tar -xzf/);
  assert.match(cmd, /scripts\/operator\/virtio-dryrun\/build-inside\.sh/);
  assert.equal(job.spec.activeDeadlineSeconds, 28800);
  const env = Object.fromEntries(job.spec.template.spec.containers[0].env.map((e) => [e.name, e.value]));
  assert.equal(env.AWAI_POOL_LABEL, "awai-pc-release-012345abcdef");
  assert.equal(readFileSync(callsFile, "utf8"), "");
});

test("job definition refuses without approval, RELEASE_TYPE, or pool", async () => {
  let r = await run("bash", [jobScript], { AWAI_VKE_NODE_POOL: "x" });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  r = await run("bash", [jobScript], { DRY_RUN: "1", AWAI_VKE_NODE_POOL: "x" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /RELEASE_TYPE/);
  r = await run("bash", [jobScript], { DRY_RUN: "1", RELEASE_TYPE: "user", AWAI_FEED_URL: "x" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI_VKE_NODE_POOL/);
});
