// End-to-end: the 2026-11-22 incident. A storage guard sends SIGTERM to the whole
// process group while the build runs. The wrapper must still release the pool.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "vke-signal-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const state = join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ pools: [], jobs: [], namespace: null, calls: [] }));
  writeFileSync(join(dir, "kubeconfig"), "fake\n");
  return { dir, bin, state };
}

async function runWrapper({ dir, bin, state }, signalWhen, target = (pid) => -pid) {
  symlinkSync(join(here, "testdata/fake-kubectl.mjs"), join(bin, "kubectl"));
  chmodSync(join(here, "testdata/fake-kubectl.mjs"), 0o755);
  // The "build": marks a running Job, then waits to be killed.
  const build = join(dir, "build.sh");
  writeFileSync(build, `node -e 'const f=process.env.FAKE_VKE_STATE,fs=require("fs");const s=JSON.parse(fs.readFileSync(f));s.jobs=[{metadata:{name:"awai-pc-release-build"}}];fs.writeFileSync(f,JSON.stringify(s))'\ntrap 'exit 124' TERM\nsleep 60 & wait\n`);
  const child = spawn(process.execPath, ["--import", join(here, "testdata/fake-vultr.mjs"), join(here, "vke-release-pool.mjs"),
    "run", join(dir, "kubeconfig"), "--", "bash", build], {
    detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_VKE_STATE: state, VULTR_API_KEY: "test-key-not-real",
      AWAI_VKE_RELEASE_PLAN: "vc2-16c-64gb", AWAI_VKE_RUN_FILE: join(dir, "run") },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const poll = setInterval(() => {
    // The build and the wrapper rewrite the state file with a truncating write; a read that lands
    // mid-write sees a torn file (AWAI-3747: tatara/ci replica split, "Unexpected end of JSON input").
    // Skip that tick and re-check 50 ms later; a permanently broken file still fails by timeout.
    let current; try { current = JSON.parse(readFileSync(state, "utf8")); } catch { return; }
    if (signalWhen(current)) { clearInterval(poll); process.kill(target(child.pid), "SIGTERM"); }
  }, 50);
  const code = await new Promise((done) => child.on("close", (exitCode) => done(exitCode)));
  clearInterval(poll);
  return { code, stderr, final: JSON.parse(readFileSync(state, "utf8")) };
}

test("SIGTERM to the process group during the build still removes the pool and the lock", { timeout: 60_000 }, async () => {
  const env = setup();
  const { code, stderr, final } = await runWrapper(env, (state) => state.jobs.length > 0);
  assert.notEqual(code, 0);
  assert.equal(final.pools.length, 0, stderr);
  assert.equal(final.namespace, null, stderr);
  assert.equal(final.deleted, 1, JSON.stringify(final) + stderr);
  assert.deepEqual(final.created.labels, { "awai.network/purpose": "release-build", "awai.network/reapable": "true" });
  assert.match(stderr, /Received SIGTERM/);
  assert.match(stderr, /Released build pool awai-pc-release-[0-9a-f]{12}/);
  assert.doesNotMatch(stderr, /test-key-not-real/);
  assert.match(readFileSync(join(env.dir, "run"), "utf8"), /^awai-pc-release-[0-9a-f]{12}\n$/);
  rmSync(env.dir, { recursive: true, force: true });
});

test("SIGTERM to the wrapper alone while provisioning still releases the pool", { timeout: 60_000 }, async () => {
  const env = setup();
  const { code, stderr, final } = await runWrapper(env, (state) => state.pools.length > 0, (pid) => pid);
  assert.notEqual(code, 0);
  assert.equal(final.deleted, 1, stderr);
  assert.equal(final.pools.length, 0, stderr);
  assert.equal(final.namespace, null, stderr);
  assert.match(stderr, /Received SIGTERM/);
  rmSync(env.dir, { recursive: true, force: true });
});
