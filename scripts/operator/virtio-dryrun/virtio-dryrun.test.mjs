#!/usr/bin/env node
// AWAI-4089 (G2): offline tests for the virtio Job (PR B).
// Stub PATH must NOT contain `m` or `breakfast`: a fake
// build/envsetup.sh defines them as shell functions and records
// their argv. The script sources it in the main shell, so the
// organizer's regression (`m: command not found`, because the
// previous revision sourced envsetup in a separate `bash -c`)
// is covered. Fake `repo`, `git`, `apt-get`, `curl`,
// `ota_from_target_files` and `rclone` record argv. Dry-run
// executes nothing; approved mode executes the same list.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, readFile as readFileP } from "node:fs/promises";
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

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

// Build an offline approved-mode kit: real pinned manifest +
// stub pc-ab-device helpers that record argv and create outputs.
// The src tree carries a fake build/envsetup.sh DEFINING `breakfast`
// and `m` as shell functions (recorded in the functions calls log).
async function makeFixture() {
  const base = mkdtempSync(join(tmpdir(), "g2prb2-"));
  const src = join(base, "src");
  const work = join(base, "work");
  const fncalls = join(base, "fncalls.log");
  writeFileSync(fncalls, "");
  mkdirSync(join(src, "build"), { recursive: true });
  writeFileSync(join(src, "build", "envsetup.sh"),
    `breakfast() { echo "breakfast $*" >> "${fncalls}"; }
m() { echo "m $*" >> "${fncalls}";
  mkdir -p "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates"
  echo tf > "$SRC/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
  echo stock > "$SRC/out/target/product/virtio_x86_64/disk-vda.img"
}
`);
  const kit = join(work, "kit");
  const pdb = join(kit, "pc-ab-device");
  const kcalls = join(base, "kitcalls.log");
  writeFileSync(kcalls, "");
  mkdirSync(pdb, { recursive: true });
  mkdirSync(join(kit, "android/desktop/manifest"), { recursive: true });
  // the patch count recorded at run time counts real patch files;
  // the fixture carries two placeholders so the count is observable.
  mkdirSync(join(pdb, "patches"), { recursive: true });
  writeFileSync(join(pdb, "patches", "dummy-a.patch"), "patch not executed in the fixture\n");
  writeFileSync(join(pdb, "patches", "dummy-b.patch"), "patch not executed in the fixture\n");
  await copyFile(join(repoRoot, "android/desktop/manifest/pinned-manifest.xml"),
    join(kit, "android/desktop/manifest/pinned-manifest.xml"));
  for (const [name, extra] of [
    ["apply.sh", ""],
    ["apply-shipping-debug-lockdown.sh", ""],
    ["pc-firmware.py", ""],
    ["updater-feed.py", ""],
    ["make-tf-disk.sh", `cp "$1" "$3" 2>/dev/null || echo img > "$3"\n`],
  ]) {
    writeFileSync(join(pdb, name), `#!/bin/sh\necho "${name} $*" >> "${kcalls}"\n${extra}exit 0\n`, { mode: 0o755 });
  }
  const kitTar = join(base, "kit.tar.gz");
  const r = await run("tar", ["-czf", kitTar, "-C", kit, "pc-ab-device", "android"]);
  assert.equal(r.code, 0, r.stderr);
  const kitSha = sha256(await readFileP(kitTar));

  const fakes = mkdtempSync(join(tmpdir(), "g2fake2-"));
  const fcalls = join(fakes, "calls.log");
  writeFileSync(fcalls, "");
  const mk = (name, body) => {
    writeFileSync(join(fakes, name),
      `#!/bin/sh\necho "${name} $*" >> "${fcalls}"\n${body}`, { mode: 0o755 });
  };
  mk("apt-get", "exit 0\n");
  mk("git", "exit 0\n");
  mk("make", "exit 0\n");
  const up = join(work, "upload");
  writeFileSync(join(fakes, "rclone"),
    `#!/bin/sh
echo "rclone $*" >> "${fcalls}"
if [ "$2" != "\${2#art:}" ]; then mkdir -p "$3" && cp -R "${up}"/. "$3"/; fi
exit 0
`, { mode: 0o755 });
  writeFileSync(join(fakes, "ota_from_target_files"),
    `#!/bin/sh
echo "ota_from_target_files $*" >> "${fcalls}"
for last; do :; done
[ -n "$last" ] && echo ota > "$last"
exit 0
`, { mode: 0o755 });
  // repo stub, delivered by fake curl into $(BUILD_WORK_DIR)/bin/repo
  const repoStub = join(fakes, "repo-stub.sh");
  writeFileSync(repoStub,
    `#!/bin/sh
echo "repo $*" >> "${fcalls}"
echo "cwd $(pwd)" >> "${fcalls}"
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
  writeFileSync(join(fakes, "curl"),
    `#!/bin/sh
echo "curl $*" >> "${fcalls}"
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
  return { base, src, work, kit, kcalls, fncalls, kitTar, kitSha, fakes, fcalls };
}

function envFor(fix, extra = {}) {
  return {
    PATH: `${fix.fakes}:${process.env.PATH}`,
    MANIFEST_FILE: pinnedManifest,
    SRC: fix.src,
    BUILD_WORK_DIR: fix.work,
    KIT: join(fix.work, "kit"),
    KIT_URL: "https://example.invalid/kit.tar.gz",
    KIT_SHA256: fix.kitSha,
    RELEASE_TYPE: "userdebug",
    AWAI_FEED_URL: "https://feed.example/ota.json",
    AWAI_POOL_LABEL: "awai-pc-release-test000000",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
test("dry-run prints the exact command list and executes nothing", async () => {
  const fix = await makeFixture();
  const r = await run("bash", [buildInside],
    envFor(fix, { DRY_RUN: "1", PATH: `${fix.fakes}:${process.env.PATH}` }));
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout;
  const lines = out.split("\n").filter((l) => l.startsWith("[dry-run] "));
  assert.ok(lines.length >= 30, `expected >=30 printed commands, got ${lines.length}`);
  for (const snippet of [
    "apt-get -qq update",
    "apt-get -qq install -y",
    "install -y bc bison",
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
    "source build/envsetup.sh",
    "breakfast lineage_virtio_x86_64 userdebug",
    "m target-files-package otatools diskimage-vda",
    "make-tf-disk.sh",
    "ota_from_target_files -k ",
    "ota_from_target_files -k ",
    "-i ",
    "rclone copy ",
    "sha256sum",
  ]) {
    assert.match(out, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing: ${snippet}`);
  }
  assert.match(out, /\bota_from_target_files -k .*-i /);
  assert.doesNotMatch(out, /<target-files\.zip>/);
  assert.match(out, /^\[dry-run\] /m);
  // Nothing executed in dry-run (all stub logs empty).
  assert.equal(readFileSync(fix.fncalls, "utf8"), "");
  assert.equal(readFileSync(fix.fcalls, "utf8"), "");
  assert.equal(readFileSync(fix.kcalls, "utf8"), "");
});

test("approved mode executes the same ordered command list end to end", async () => {
  const fix = await makeFixture();
  const env = envFor(fix, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1" });
  const r = await run("bash", [buildInside], env, 120000);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /AWAI4089_BILLING_MODE/);

  const fcalls = readFileSync(fix.fcalls, "utf8");
  // fake-tool argv in order
  const order = [
    "apt-get -qq update",
    "apt-get -qq install -y",
    "curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo",
    "curl -fsSL https://example.invalid/kit.tar.gz",
    "git config --global user.email virtio-g2@awai.network",
    "git config --global user.name",
    "repo init -u https://github.com/LineageOS/android.git",
    "repo sync -m default.xml --no-manifest-update",
    "repo manifest -r",
    "git init -q",
    "git -C",
  ];
  let pos = -1;
  for (const snippet of order) {
    const i = fcalls.indexOf(snippet);
    assert.ok(i > pos, `${snippet} out of order or missing (pos ${pos}, found ${i})`);
    pos = i;
  }
  // repo must have run with cwd === $SRC
  const cwdLines = fcalls.split("\n").filter((l) => l.startsWith("cwd "));
  assert.ok(cwdLines.length >= 3, cwdLines.join("\n"));
  for (const l of cwdLines) assert.equal(l.slice(4), fix.src);

  // olddefconfig sits after the patch steps and before `m`:
  // patch steps (apply.sh etc. in kit stubs) ran in an earlier stage,
  // and the `m` function call must come after `make olddefconfig`.
  const callList = fcalls.split("\n");
  const kIndex = callList.findIndex((l) => l.startsWith("make -C "));
  assert.ok(kIndex >= 0, callList.join("\n"));
  assert.match(callList[kIndex], /kernel\/virt\/virtio olddefconfig/);
  // the `m` function call (recorded after olddefconfig) is asserted below.
  // envsetup functions recorded: breakfast + m (NOT binaries on PATH)
  const fncalls = readFileSync(fix.fncalls, "utf8");
  assert.match(fncalls, /breakfast lineage_virtio_x86_64 userdebug/);
  assert.match(fncalls, /m target-files-package otatools diskimage-vda/);
  // `m` was not a PATH binary: no early "command not found", chain completed.
  assert.match(r.stdout, /AWAI4089_DONE approved=1/);

  // kit stub argv
  const kcalls = readFileSync(fix.kcalls, "utf8");
  for (const s of ["apply.sh ", "apply-shipping-debug-lockdown.sh ", "pc-firmware.py prepare ",
    "updater-feed.py configure-release ", "make-tf-disk.sh "]) {
    assert.ok(kcalls.includes(s), `kit stub not called: ${s}`);
  }
  // both OTA invocations actually ran through the fake
  const otaLines = fcalls.split("\n").filter((l) => l.startsWith("ota_from_target_files "));
  assert.equal(otaLines.length, 2, fcalls);
  assert.match(otaLines[0], /-k .*testkey .*virtio-full-ota\.zip$/);
  assert.match(otaLines[1], /-i .*virtio-target-files-v1\.zip .*virtio-incremental-ota\.zip$/);
  // restore verification ran (rclone copy back, then real sha256sum -c)
  assert.match(r.stdout, /AWAI4089_PATCH_COUNT=2/);
  assert.match(r.stdout, /AWAI4089_RESTORE_VERIFY ok/);
});

test("approved mode without KIT_URL/KIT_SHA256 refuses (nothing executed)", async () => {
  const fix = await makeFixture();
  const r = await run("bash", [buildInside],
    envFor(fix, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", KIT_URL: "", KIT_SHA256: "" }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /KIT_URL and KIT_SHA256 are required/);
  assert.equal(readFileSync(fix.fcalls, "utf8"), "");
});

test("approved mode with kit SHA mismatch refuses", async () => {
  const fix = await makeFixture();
  const r = await run("bash", [buildInside],
    envFor(fix, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", KIT_SHA256: "0".repeat(64) }));
  assert.notEqual(r.code, 0);
  assert.equal(readFileSync(fix.kcalls, "utf8").includes("apply.sh"), false);
});

test("approved mode without feed URL refuses (before any execution)", async () => {
  const fix = await makeFixture();
  const r = await run("bash", [buildInside],
    envFor(fix, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", AWAI_FEED_URL: "" }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_FEED_URL is required/);
  assert.equal(readFileSync(fix.fcalls, "utf8"), "");
});

test("approved mode without pool label refuses", async () => {
  const fix = await makeFixture();
  const r = await run("bash", [buildInside],
    envFor(fix, { BILLING_ALLOWED: "1", OWNER_APPROVED: "1", AWAI_POOL_LABEL: "" }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /AWAI_POOL_LABEL is required/);
  assert.equal(readFileSync(fix.fcalls, "utf8"), "");
});

test("approval gate uses AND both flags; either flag alone refuses", async () => {
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
  const fix = await makeFixture();
  const bad = join(fix.base, "bad.xml");
  writeFileSync(bad, "<manifest/>\n");
  const r = await run("bash", [buildInside],
    { DRY_RUN: "1", RELEASE_TYPE: "userdebug", AWAI_FEED_URL: "x", MANIFEST_FILE: bad });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWAI4089_REFUSES: pinned manifest SHA-256 differs/);
  assert.doesNotMatch(r.stdout, /apt-get/);
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

test("job definition prints Job JSON (toolchain-first, no rclone bootstrap)", async () => {
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
  assert.match(cmd, /bash \/root\/build\/virtio-dryrun\/build-inside\.sh/);
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
