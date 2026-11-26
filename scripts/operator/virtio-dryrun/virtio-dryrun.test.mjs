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
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
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
if [ "$1" = --config ] && [ "$2" = /dev/null ] && [ "$3" = copyto ]; then
  [ "$RCLONE_CONFIG_APKSTAGE_TYPE:$RCLONE_CONFIG_APKSTAGE_ACCOUNT:$RCLONE_CONFIG_APKSTAGE_KEY" = "b2:fixture-account:fixture-key" ] || exit 99
  case "$4" in
    apkstage:awai-os-release-artifacts/awai-virtio-g2-inputs/fixture-stage/AwaiHome.apk|\
    apkstage:awai-os-release-artifacts/awai-virtio-g2-inputs/fixture-stage/AwaiStore.apk)
      cp "$STUB_APK_STAGE/\${4##*/}" "$5" || { echo "transport error with fixture-key" >&2; exit 1; }
      ;;
    *) exit 99 ;;
  esac
  exit 0
fi
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
    // #523's fail-closed apps guard: every run names a mode.
    AWAI_WITHOUT_APPS: "1",
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
    "curl -fsSL $KIT_URL",
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
    AWAI_WITHOUT_APPS: "1",
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
    RELEASE_TYPE: "userdebug", AWAI_WITHOUT_APPS: "1",
    AWAI_FEED_URL: "https://feed.example/ota.json",
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

test("apps mode is explicit: neither, both, or without-apps on user refuse", async () => {
  const stub = stubPath(join(tmpdir(), "apps-"), undefined);
  const work = join(tmpdir(), "appswork-");
  const base = { ...envFor(stub, work), DRY_RUN: "1" };
  let r = await run("bash", [buildInside], { ...base, AWAI_WITHOUT_APPS: "" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI4094_REFUSES: an explicit apps mode is required/);
  r = await run("bash", [buildInside], { ...base, AWAI_HOME_APK: "/tmp/AwaiHome.apk" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /mutually exclusive/);
  r = await run("bash", [buildInside], { ...base, RELEASE_TYPE: "user" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_WITHOUT_APPS=1 is refused for RELEASE_TYPE=user/);
  // userdebug + without-apps passes: exactly one recorded line
  r = await run("bash", [buildInside], base);
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.split("\n").filter((l) => l.startsWith("AWAI4094_APPS: "));
  assert.deepEqual(lines, ["AWAI4094_APPS: without-apps (evaluation)"]);
  assert.equal(stub.calls(), "");
});

test("local prebuilt apps mode requires both file and signer pins and records the expected signers", async () => {
  const stub = stubPath(join(tmpdir(), "pre-"), undefined);
  const work = join(tmpdir(), "prework-");
  const home = "a".repeat(64), store = "b".repeat(64);
  const base = {
    ...envFor(stub, work), DRY_RUN: "1", AWAI_WITHOUT_APPS: "",
    AWAI_HOME_APK: "/tmp/AwaiHome.apk", AWAI_STORE_APK: "/tmp/AwaiStore.apk",
    AWAI_HOME_APK_SHA256: "c".repeat(64), AWAI_STORE_APK_SHA256: "d".repeat(64),
    AWAI_HOME_EXPECTED_SIGNER_SHA256: home,
    AWAI_STORE_EXPECTED_SIGNER_SHA256: store,
    AWAI_APKSIGNER: "/usr/bin/apksigner",
  };
  let r = await run("bash", [buildInside], { ...base, AWAI_HOME_APK_SHA256: "" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_HOME_APK_SHA256 must be a lowercase SHA-256 digest/);
  r = await run("bash", [buildInside], base);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^AWAI4094_APPS: prebuilt home=${home} store=${store}$`, "m"));
  assert.match(r.stdout, /\[dry-run\] cp .*\/apks\.<run>\/AwaiHome\.apk .*\/device\/virt\/virtio-common\/awai-apps\/AwaiHome\.apk/);
  assert.doesNotMatch(r.stdout, /example\.invalid\/kit\.tar\.gz/);
  assert.match(r.stdout, /\[dry-run\] cp .*\/apks\.<run>\/AwaiStore\.apk .*\/device\/virt\/virtio-common\/awai-apps\/AwaiStore\.apk/);
  assert.equal(stub.calls(), "");
});

test("prebuilt apps mode copies the APKs into the device tree for the build", async () => {
  const kitInfo = await extractedRealKit();
  const work = mkdtempSync(join(tmpdir(), "g2apps-"));
  const fncalls = join(work, "fncalls.log");
  writeFileSync(fncalls, "");
  const src = join(work, "src");
  mkdirSync(join(src, "build"), { recursive: true });
  writeFileSync(join(src, "build", "envsetup.sh"),
    `breakfast() { local t=$1 v=\${2:-userdebug}; echo "lunch lineage_$t-ap3a-$v" >> "${fncalls}"; }
m() { echo "m $*" >> "${fncalls}";
  echo "home-signer=\${AWAI_HOME_EXPECTED_SIGNER_SHA256:-} store-signer=\${AWAI_STORE_EXPECTED_SIGNER_SHA256:-} apksigner=\${AWAI_APKSIGNER:-} without=\${AWAI_WITHOUT_APPS:-}" >> "${fncalls}";
  mkdir -p "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates"
  echo tf > "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
  echo stock > "$SRC/out/target/product/virtio_x86_64/disk-vda.img"
}
`);
  const apkDir = mkdtempSync(join(tmpdir(), "g2apk-"));
  const homeApk = join(apkDir, "AwaiHome.apk");
  const storeApk = join(apkDir, "AwaiStore.apk");
  const signerStub = join(apkDir, "apksigner");
  writeFileSync(homeApk, "home-apk\n");
  writeFileSync(storeApk, "store-apk\n");
  writeFileSync(signerStub, `#!/bin/sh
[ "$1 $2" = "verify --print-certs" ] || exit 99
case "$3" in
  */AwaiHome.apk) digest=${"a".repeat(64)} ;;
  */AwaiStore.apk) digest=${"b".repeat(64)} ;;
  *) exit 99 ;;
esac
echo "Signer #1 certificate SHA-256 digest: $digest"
`, { mode: 0o755 });
  const stub = stubPath(work, kitInfo.kitTar);
  const env = envFor(stub, work, {
    SRC: src, KIT: kitInfo.kit, KIT_SHA256: kitInfo.kitSha,
    BILLING_ALLOWED: "1", OWNER_APPROVED: "1", AWAI_WITHOUT_APPS: "",
    AWAI_HOME_APK: homeApk, AWAI_STORE_APK: storeApk,
    AWAI_HOME_APK_SHA256: sha256(readFileSync(homeApk)),
    AWAI_STORE_APK_SHA256: sha256(readFileSync(storeApk)),
    AWAI_HOME_EXPECTED_SIGNER_SHA256: "a".repeat(64),
    AWAI_STORE_EXPECTED_SIGNER_SHA256: "b".repeat(64),
    AWAI_APKSIGNER: signerStub,
  });
  const r = await run("bash", [join(kitInfo.kit, "scripts/operator/virtio-dryrun/build-inside.sh")], env, 120000);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /AWAI4094_APPS: prebuilt home=a{64} store=b{64}/);
  assert.match(r.stdout, /AWAI4094_APK_VERIFIED AwaiHome\.apk[^\n]*\nAWAI4094_APK_VERIFIED AwaiStore\.apk[\s\S]*repo init/);
  const appsDir = join(src, "device/virt/virtio-common/awai-apps");
  assert.equal(readFileSync(join(appsDir, "AwaiHome.apk"), "utf8"), "home-apk\n");
  assert.equal(readFileSync(join(appsDir, "AwaiStore.apk"), "utf8"), "store-apk\n");
  const fb = readFileSync(fncalls, "utf8");
  assert.match(fb, /m target-files-package otatools diskimage-vda/);
  // the build receives the signer inputs and no without-apps escape
  assert.match(fb, new RegExp(`home-signer=${"a".repeat(64)} store-signer=${"b".repeat(64)} apksigner=${signerStub} without=$`, "m"));
  assert.match(r.stderr + r.stdout, /AWAI4089_DONE approved=1/);
  const noTool = await run("bash", [buildInside], { ...env, AWAI_APKSIGNER: signerStub + ".missing" });
  assert.equal(noTool.code, 2, noTool.stderr);
  assert.match(noTool.stderr, /apksigner is missing or not executable/);
  assert.doesNotMatch(noTool.stdout, /repo (init|sync)/);
});

test("pinned manifest SHA validated before anything else", async () => {
  const bad = join(tmpdir(), "bad.xml");
  writeFileSync(bad, "<manifest/>\n");
  const r = await run("bash", [buildInside],
    { DRY_RUN: "1", RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "x", AWAI_WITHOUT_APPS: "1", MANIFEST_FILE: bad });
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
    DRY_RUN: "1", RELEASE_TYPE: "userdebug", AWAI_WITHOUT_APPS: "1",
    AWAI_FEED_URL: "https://feed.example/ota.json",
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
  // apps mode reaches the container env and the Job labels
  assert.equal(env.AWAI_WITHOUT_APPS, "1");
  assert.equal(job.metadata.labels["awai.network/apps-mode"], "without-apps");
  assert.equal(job.spec.template.spec.volumes.some((v) => v.name === "apk-stage"), false);
  const stub = stubPath(fakeDir, undefined);
  const dry = await run("bash", job.spec.template.spec.containers[0].command.slice(1),
    { ...env, PATH: `${stub.dir}:${process.env.PATH}` });
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /AWAI4089_DRY_RUN/);
  assert.equal(stub.calls(), "");
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

test("job definition requires an explicit apps mode and carries it", async () => {
  const base = {
    DRY_RUN: "1", RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "https://feed.example/ota.json",
    AWAI_VKE_NODE_POOL: "awai-pc-release-012345abcdef",
    AWAI_POOL_LABEL: "awai-pc-release-012345abcdef",
  };
  // neither mode
  let r = await run("bash", [jobScript], base);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /AWAI4094_REFUSES: an explicit apps mode is required/);
  // without-apps on user
  r = await run("bash", [jobScript], { ...base, RELEASE_TYPE: "user", AWAI_WITHOUT_APPS: "1" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_WITHOUT_APPS=1 is refused for RELEASE_TYPE=user/);
  // Staged prebuilt: only the stage ID and the four pins reach the env.
  const prebuilt = {
    AWAI_APK_STAGE: "fixture-stage",
    AWAI_HOME_APK_SHA256: "c".repeat(64), AWAI_STORE_APK_SHA256: "d".repeat(64),
    AWAI_HOME_EXPECTED_SIGNER_SHA256: "a".repeat(64),
    AWAI_STORE_EXPECTED_SIGNER_SHA256: "b".repeat(64),
  };
  for (const bad of [
    { AWAI_APK_STAGE: "https://example.invalid/secret?token=fixture" },
    { AWAI_HOME_APK: "/apks/AwaiHome.apk" },
    { AWAI_STORE_EXPECTED_SIGNER_SHA256: "bad" },
  ]) {
    r = await run("bash", [jobScript], { ...base, ...prebuilt, ...bad });
    assert.equal(r.code, 2, r.stderr);
    assert.equal(r.stdout, "");
    assert.doesNotMatch(r.stderr, /token=fixture/);
  }
  r = await run("bash", [jobScript], { ...base, ...prebuilt, RELEASE_TYPE: "user" });
  assert.equal(r.code, 0, r.stderr);
  const job = JSON.parse(r.stdout);
  const pod = job.spec.template.spec;
  const worker = pod.containers[0];
  const env = Object.fromEntries(worker.env.map((e) => [e.name, e.value]));
  for (const [k, v] of Object.entries(prebuilt)) assert.equal(env[k], v, k);
  assert.equal(env.AWAI_WITHOUT_APPS, "");
  assert.equal(env.AWAI_APKSIGNER, undefined);
  assert.deepEqual(worker.envFrom, [{ secretRef: { name: "release-artifacts-b2" } }]);
  assert.deepEqual(worker.volumeMounts[1], {
    name: "apk-stage", mountPath: "/run/secrets/awai-apk-stage", readOnly: true,
  });
  const inputSecret = pod.volumes[1].secret;
  assert.equal(inputSecret.secretName, "release-apk-stage-b2");
  assert.equal(inputSecret.defaultMode, 0o400);
  assert.deepEqual(inputSecret.items.map(({ key }) => key),
    ["RCLONE_CONFIG_ART_TYPE", "RCLONE_CONFIG_ART_ACCOUNT", "RCLONE_CONFIG_ART_KEY"]);
  assert.equal(job.metadata.labels["awai.network/apps-mode"], "prebuilt");
});

test("staged user Job verifies before source work and builds from the verified snapshots", async (t) => {
  const kitInfo = await extractedRealKit();
  const stage = join(kitInfo.base, "stage");
  const secret = join(kitInfo.base, "secret");
  mkdirSync(stage);
  mkdirSync(secret, { mode: 0o700 });
  for (const [key, value] of Object.entries({ TYPE: "b2", ACCOUNT: "fixture-account", KEY: "fixture-key" })) {
    writeFileSync(join(secret, `RCLONE_CONFIG_ART_${key}`), value, { mode: 0o400 });
  }
  const home = "home-apk\n", store = "store-apk\n";
  const homeSigner = "a".repeat(64), storeSigner = "b".repeat(64);
  const homeFile = join(stage, "AwaiHome.apk"), storeFile = join(stage, "AwaiStore.apk");
  writeFileSync(homeFile, home);
  writeFileSync(storeFile, store);

  const cases = [
    ["approved pair", {}, null],
    ["missing APK", { STUB_MISSING: "1" }, /could not fetch AwaiStore\.apk/],
    ["file hash mismatch", { AWAI_HOME_APK_SHA256: "0".repeat(64) }, /AwaiHome\.apk file SHA-256 mismatch/],
    ["wrong signer", { AWAI_STORE_EXPECTED_SIGNER_SHA256: "0".repeat(64) }, /AwaiStore\.apk signer SHA-256 mismatch/],
    ["apksigner rejects signature", { STUB_APKSIGNER: "reject" }, /apksigner could not verify AwaiHome\.apk/],
    ["additional signer", { STUB_APKSIGNER: "multiple" }, /AwaiHome\.apk signer SHA-256 mismatch/],
    ["absent stage Secret", { AWAI_APK_STAGE_SECRET_DIR: secret + ".missing" }, /APK stage Secret is unavailable/],
  ];
  for (const [name, overrides, refusal] of cases) {
    await t.test(name, async () => {
      const work = mkdtempSync(join(tmpdir(), "g2staged-"));
      const src = join(work, "src");
      mkdirSync(join(src, "build"), { recursive: true });
      writeFileSync(join(src, "build", "envsetup.sh"), `breakfast() { :; }
m() {
  [ -z "\${AWAI_ALLOW_UNVERIFIED_APKS:-}\${AWAI_WITHOUT_APPS:-}\${RCLONE_CONFIG_APKSTAGE_KEY:-}" ] || return 99
  [ -x "$AWAI_APKSIGNER" ] || return 99
  mkdir -p "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates"
  echo tf > "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
  echo stock > "$SRC/out/target/product/virtio_x86_64/disk-vda.img"
}
`);
      const stub = stubPath(work, kitInfo.kitTar);
      writeFileSync(join(stub.dir, "apksigner"), `#!/bin/sh
echo "apksigner $*" >> "${stub.callsFile}"
[ "$1 $2" = "verify --print-certs" ] || exit 99
[ -z "\${RCLONE_CONFIG_APKSTAGE_KEY:-}" ] || exit 99
[ "\${STUB_APKSIGNER:-}" != reject ] || { echo "private verifier diagnostic" >&2; exit 1; }
case "$3" in
  "$BUILD_WORK_DIR"/apks.*/AwaiHome.apk) digest=${homeSigner}; echo "changed after download" > "${homeFile}" ;;
  "$BUILD_WORK_DIR"/apks.*/AwaiStore.apk) digest=${storeSigner} ;;
  *) exit 99 ;;
esac
echo "Signer #1 certificate SHA-256 digest: $digest"
if [ "\${STUB_APKSIGNER:-}" = multiple ]; then echo "Signer #2 certificate SHA-256 digest: ${storeSigner}"; fi
`, { mode: 0o755 });
      writeFileSync(homeFile, home);
      writeFileSync(storeFile, store);
      if (overrides.STUB_MISSING) unlinkSync(storeFile);
      const gen = await run("bash", [jobScript], {
        BUILD_WORK_DIR: work, RELEASE_TYPE: "user", BILLING_ALLOWED: "1", OWNER_APPROVED: "1",
        AWAI_VKE_NODE_POOL: "fixture-pool", AWAI_POOL_LABEL: "fixture-run",
        AWAI_FEED_URL: "https://feed.example/ota.json", KIT_URL: "https://example.invalid/kit.tar.gz",
        KIT_SHA256: kitInfo.kitSha, AWAI_APK_STAGE: "fixture-stage",
        AWAI_HOME_APK_SHA256: sha256(home), AWAI_STORE_APK_SHA256: sha256(store),
        AWAI_HOME_EXPECTED_SIGNER_SHA256: homeSigner, AWAI_STORE_EXPECTED_SIGNER_SHA256: storeSigner,
        ...overrides,
      });
      assert.equal(gen.code, 0, gen.stderr);
      const worker = JSON.parse(gen.stdout).spec.template.spec.containers[0];
      const env = Object.fromEntries(worker.env.map(({ name, value }) => [name, value]));
      const r = await run("bash", worker.command.slice(1), {
        ...env, SRC: src, KIT: join(work, "kit"), PATH: `${stub.dir}:${process.env.PATH}`,
        STUB_APK_STAGE: stage, AWAI_APK_STAGE_SECRET_DIR: secret,
        AWAI_ALLOW_UNVERIFIED_APKS: "1", AWAI_WITHOUT_APPS: " 1 ",
        ...overrides,
      });
      const calls = stub.calls();
      assert.doesNotMatch(r.stdout + r.stderr + gen.stdout + calls,
        /fixture-account|fixture-key|private verifier diagnostic/);
      assert.equal(readdirSync(work).some((name) => name.startsWith("apks.")), false);
      if (refusal) {
        assert.equal(r.code, 2, r.stderr);
        assert.match(r.stderr, refusal);
        assert.doesNotMatch(calls + r.stdout, /repo (init|sync)|git config/);
        assert.equal(stub.kcalls(), "");
        return;
      }
      assert.equal(r.code, 0, r.stderr);
      assert.match(calls, /apt-get -qq install -y apksigner=31\.0\.2-1ubuntu1[\s\S]*rclone --config \/dev\/null copyto[\s\S]*apksigner verify --print-certs [^\n]*AwaiHome\.apk[\s\S]*apksigner verify --print-certs [^\n]*AwaiStore\.apk[\s\S]*repo init[\s\S]*repo sync/);
      const appsDir = join(src, "device/virt/virtio-common/awai-apps");
      assert.equal(readFileSync(join(appsDir, "AwaiHome.apk"), "utf8"), home);
      assert.equal(readFileSync(join(appsDir, "AwaiStore.apk"), "utf8"), store);
      assert.equal(readFileSync(homeFile, "utf8"), "changed after download\n");
    });
  }
});
