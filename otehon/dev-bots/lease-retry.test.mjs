import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classify, intSetting, reasonOf, leaseWithRetry } from "./lease-retry.mjs";

const seq = (results) => { let i = 0; const calls = []; return { calls, lease: () => { calls.push("lease"); return results[Math.min(i++, results.length - 1)]; }, recover: (c) => { calls.push(`recover:${c}`); return { status: 0 }; }, sleep: (s) => calls.push(`sleep:${s}`), log: (l) => calls.push(`log:${l}`) }; };
const net = { status: 1, stdout: "", stderr: "kagitaba-lease: fetch failed\n" };
const refused = { status: 1, stdout: "", stderr: "kagitaba-lease: lease refused (403): repository not granted\n" };
const ok = { status: 0, stdout: "tok-abc\n", stderr: "lease 1 expires soon\n" };

test("classify: transport failures retry, refusals do not", () => {
  for (const s of ["fetch failed", "connect ECONNREFUSED 1.2.3.4:1", "Connect Timeout Error", "lease refused (503): busy"]) assert.equal(classify(s), "transport", s);
  for (const s of ["lease refused (403): no", "bad --perm \"x\"", "", undefined]) assert.equal(classify(s), "refused", String(s));
});

test("first attempt succeeds: no recovery, no sleep", () => {
  const d = seq([ok]);
  assert.deepEqual(leaseWithRetry({ tries: 3, waitS: 5, recover: "fix" }, d), { ok: true, token: "tok-abc", attempts: 1, recovered: 0 });
  assert.deepEqual(d.calls, ["lease"]);
});

test("transport failure runs recovery, waits, then succeeds", () => {
  const d = seq([net, ok]);
  const r = leaseWithRetry({ tries: 3, waitS: 7, recover: "fix-net" }, d);
  assert.deepEqual(r, { ok: true, token: "tok-abc", attempts: 2, recovered: 1 });
  assert.deepEqual(d.calls.filter((c) => !c.startsWith("log:")), ["lease", "recover:fix-net", "sleep:7", "lease"]);
});

test("attempts are bounded and the last failure does not recover again", () => {
  const d = seq([net]);
  const r = leaseWithRetry({ tries: 3, waitS: 1, recover: "fix" }, d);
  assert.deepEqual(r, { ok: false, attempts: 3, recovered: 2, kind: "transport" });
  assert.equal(d.calls.filter((c) => c === "lease").length, 3);
  assert.equal(d.calls.filter((c) => c.startsWith("recover:")).length, 2);
});

test("a refusal is final: one attempt, no recovery", () => {
  const d = seq([refused, ok]);
  assert.deepEqual(leaseWithRetry({ tries: 5, waitS: 1, recover: "fix" }, d), { ok: false, attempts: 1, recovered: 0, kind: "refused" });
  assert.deepEqual(d.calls.filter((c) => !c.startsWith("log:")), ["lease"]);
});

test("exit 0 without a token is a failure, not a token", () => {
  const d = seq([{ status: 0, stdout: "\n", stderr: "" }]);
  assert.equal(leaseWithRetry({ tries: 3 }, d).ok, false);
});

test("without a recovery command it still waits and retries", () => {
  const d = seq([net, ok]);
  assert.equal(leaseWithRetry({ tries: 2, waitS: 2 }, d).ok, true);
  assert.deepEqual(d.calls.filter((c) => !c.startsWith("log:")), ["lease", "sleep:2", "lease"]);
});

test("a throwing recovery command does not stop the retry", () => {
  const d = seq([net, ok]);
  d.recover = () => { throw new Error("no bash"); };
  assert.equal(leaseWithRetry({ tries: 2, waitS: 0, recover: "x" }, d).ok, true);
});

test("logs never carry the token or token-shaped text", () => {
  const d = seq([{ status: 1, stdout: "", stderr: "fetch failed for ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n" }, ok]);
  leaseWithRetry({ tries: 2, waitS: 0 }, d);
  const logs = d.calls.filter((c) => c.startsWith("log:")).join("\n");
  assert.ok(!logs.includes("tok-abc") && !logs.includes("ghs_ABCDEFGHIJ"), logs);
  assert.equal(reasonOf("a\nlast line"), "last line");
});

test("intSetting keeps the default outside the range or for non-integers", () => {
  assert.equal(intSetting("4", 3, 1, 10), 4);
  for (const v of ["0", "11", "abc", "", undefined, "2.5", "-1"]) assert.equal(intSetting(v, 3, 1, 10), 3, String(v));
});

test("CLI: token on stdout only on success; recovery hook runs between attempts", () => {
  const self = fileURLToPath(new URL("./lease-retry.mjs", import.meta.url));
  // Fails with a transport error until the recovery hook has created the marker file.
  const marker = `${process.env.TMPDIR ?? "/tmp"}/lease-retry-test-${process.pid}`;
  const fake = `const fs=require("fs");if(fs.existsSync(${JSON.stringify(marker)})){console.log("tok-cli");}else{console.error("fetch failed");process.exit(1);}`;
  const env = { ...process.env, DEV_BOTS_LEASE_WAIT_S: "0", DEV_BOTS_NET_RECOVER: `touch ${marker}` };
  try {
    const r = spawnSync(process.execPath, [self, "--", process.execPath, "-e", fake], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "tok-cli\n");
    assert.ok(!r.stderr.includes("tok-cli"));
    const bad = spawnSync(process.execPath, [self, "--", process.execPath, "-e", 'console.error("lease refused (403): no");process.exit(1)'], { encoding: "utf8", env });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, "");
    assert.equal((bad.stderr.match(/attempt/g) ?? []).length, 1);
    assert.equal(spawnSync(process.execPath, [self], { encoding: "utf8" }).status, 2);
  } finally {
    spawnSync("rm", ["-f", marker]);
  }
});
