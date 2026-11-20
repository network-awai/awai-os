// Run a token-lease command, retrying when the minter cannot be reached.
//
// Usage: node lease-retry.mjs -- <lease command> [args...]
//
// The lease command prints the token on stdout and a reason on stderr (for
// example kagitaba-lease.mjs lease ...). This wrapper prints the token on
// stdout only when an attempt succeeds, and never logs it. Progress goes to
// stderr.
//
//   DEV_BOTS_LEASE_TRIES   attempts in total, 1-10 (default 3)
//   DEV_BOTS_LEASE_WAIT_S  seconds to wait before a retry, 0-300 (default 5)
//   DEV_BOTS_NET_RECOVER   optional shell command run before each retry, e.g.
//                          one that reconnects the VPN. Its output is dropped.
//
// Only a transport failure is retried. A refusal by the minter (policy, bad
// argument, 4xx) would be refused again, so it fails at once.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TRANSPORT = /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND|timed? ?out|socket hang up|lease refused \(5\d\d\)/i;

/** "transport" (worth retrying) or "refused" (final). */
export function classify(stderr) {
  return TRANSPORT.test(String(stderr ?? "")) ? "transport" : "refused";
}

/** Integer setting within [min, max]; anything else is the default. */
export function intSetting(value, def, min, max) {
  const s = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(s)) return def;
  const n = Number(s);
  return n >= min && n <= max ? n : def;
}

/** Keep the reason readable and free of anything token-shaped. */
export function reasonOf(stderr) {
  return String(stderr ?? "").trim().split("\n").pop().replace(/[A-Za-z0-9_\-]{30,}/g, "<redacted>").slice(0, 200) || "no reason given";
}

/**
 * @param {{tries: number, waitS: number, recover?: string}} opts
 * @param deps lease() -> {status, stdout, stderr}; recover(cmd) -> {status};
 *             sleep(seconds); log(line)
 * @returns {{ok: boolean, token?: string, attempts: number, recovered: number, kind?: string}}
 */
export function leaseWithRetry({ tries = 3, waitS = 5, recover = "" } = {}, { lease, recover: runRecover = () => ({ status: 0 }), sleep = () => {}, log = () => {} }) {
  let recovered = 0;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let r;
    try {
      r = lease();
    } catch (e) {
      r = { status: 1, stdout: "", stderr: String(e?.message ?? e) };
    }
    const token = String(r?.stdout ?? "").trim();
    if (r?.status === 0 && token !== "") return { ok: true, token, attempts: attempt, recovered };
    const stderr = r?.status === 0 ? "lease command printed no token" : r?.stderr;
    const kind = r?.status === 0 ? "refused" : classify(stderr);
    log(`lease attempt ${attempt}/${tries} failed (${kind}): ${reasonOf(stderr)}`);
    if (kind !== "transport" || attempt === tries) return { ok: false, attempts: attempt, recovered, kind };
    if (recover) {
      let rr;
      try {
        rr = runRecover(recover);
      } catch (e) {
        rr = { status: 1 };
      }
      recovered += 1;
      log(`network recovery command exit ${rr?.status ?? "unknown"}`);
    }
    sleep(waitS);
  }
  return { ok: false, attempts: tries, recovered, kind: "transport" };
}

export function main(argv, env = process.env) {
  const cmd = argv[0] === "--" ? argv.slice(1) : argv;
  if (!cmd.length) {
    console.error("usage: node lease-retry.mjs -- <lease command> [args...]");
    return 2;
  }
  const r = leaseWithRetry(
    {
      tries: intSetting(env.DEV_BOTS_LEASE_TRIES, 3, 1, 10),
      waitS: intSetting(env.DEV_BOTS_LEASE_WAIT_S, 5, 0, 300),
      recover: String(env.DEV_BOTS_NET_RECOVER ?? "").trim(),
    },
    {
      lease: () => spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      recover: (c) => spawnSync("bash", ["-c", c], { stdio: "ignore", timeout: 120000 }),
      sleep: (s) => { if (s > 0) spawnSync("sleep", [String(s)]); },
      log: (line) => console.error(`lease-retry: ${line}`),
    },
  );
  if (!r.ok) return 1;
  process.stdout.write(`${r.token}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
