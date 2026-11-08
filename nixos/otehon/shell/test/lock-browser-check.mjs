// Drives the built shell's screen lock in headless Chrome on a workstation, with trusted input
// and a random test wallet (docs/otehon/protection-0.1.0.md). It is not a VM check: it proves the
// shell's behaviour, not the OS image. Build first with IDLE_LOCK_MS=15000 node build.mjs.
// usage: CHROME=<chrome binary> [DIST=<dist dir>] node test/lock-browser-check.mjs <scratch-profile-dir>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { randomWallet, signPersonal } from "./signers.js";
const S = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = process.argv[2];
if (!PROFILE) {
  console.log("NOT_RUN no scratch profile directory");
  process.exit(3);
}
const URL_ = `file://${process.env.DIST ?? `${S}/dist`}/index.html`;
const IDLE = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chrome, ws, id = 0; const waiting = new Map(); const results = {};
async function start() {
  chrome = spawn(CHROME, ["--headless=new", `--user-data-dir=${PROFILE}`, "--remote-debugging-port=9333", "--no-first-run", "--window-size=1280,800", URL_], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      const t = (await (await fetch("http://127.0.0.1:9333/json")).json()).find((x) => x.type === "page" && x.url.startsWith("file:"));
      if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } }; return; }
    } catch {}
    await sleep(500);
  }
  throw new Error("no chrome");
}
async function stop() { ws.close(); chrome.kill("SIGTERM"); await new Promise((r) => chrome.on("exit", r)); }
const send = (method, params = {}) => { id++; ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => waiting.set(id, r)); };
const evaluate = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;
async function until(x, label, t = 20000) { const end = Date.now() + t; while (Date.now() < end) { const v = await evaluate(`(() => { const v = (${x}); return v instanceof Node ? true : v; })()`).catch(() => null); if (v) return v; await sleep(200); } throw new Error(`timeout: ${label}`); }
async function click(sel) { const b = JSON.parse(await until(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.disabled) return null; const r = e.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`, `click ${sel}`));
  const m = { x: b.x, y: b.y, button: "left", clickCount: 1 }; await send("Input.dispatchMouseEvent", { type: "mousePressed", ...m }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...m }); }
async function type(sel, text) { await click(sel); await evaluate(`document.querySelector(${JSON.stringify(sel)}).select()`); await send("Input.insertText", { text }); }
async function step(name, fn) { try { await fn(); results[name] = 1; console.log(`STEP ${name}=1`); } catch (e) { results[name] = 0; console.log(`STEP ${name}=0 ${e.message}`); throw e; } }
const dapps = "document.querySelectorAll('.dapp').length";
const nothing = "document.querySelectorAll('.dapp, .messages, .thread, [data-account]').length === 0";
const owner = randomWallet();
const text = ["LOCK", "CHECK", "CANARY"].join("_") + "_" + Date.now();
async function locked() { await until("document.querySelector('[data-lock-screen]')", "lock screen"); await until(nothing, "nothing rendered");
  await until("document.title.includes('locked=1 gate=1 dapps=0')", "title"); if (await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)) throw new Error("canary shown"); }
async function sign(w) { const m = await until("document.querySelector('#unlock-message')?.value", "message"); await type("#unlock-signature", signPersonal(w, m)); await click("#unlock-verify"); }
rmSync(PROFILE, { recursive: true, force: true });
try {
  await start();
  await step("signin", async () => {
    await until("document.querySelector('[data-step=hello]')", "hello");
    for (const n of ["language", "network", "signin"]) { await click("[data-next]"); await until(`document.querySelector('[data-step=${n}]')`, n); }
    await click("#local-start"); await type("#local-address", owner.address);
    const m = await until("document.querySelector('#local-message')?.value", "msg"); await type("#local-signature", signPersonal(owner, m)); await click("#local-verify");
    await until("document.querySelector('[data-step=trust]')", "trust"); await click("[data-next]"); await click("[data-finish]");
    await until(`${dapps} > 0`, "apps");
  });
  await step("message", async () => { await type(".composer textarea", text); await click(".composer button[type=submit]"); await until(`document.querySelector('.messages')?.innerText.includes(${JSON.stringify(text)})`, "shown"); });
  let last;
  await step("idle_not_yet", async () => { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 }); last = Date.now(); await sleep(5000); if (await evaluate("!!document.querySelector('[data-lock-screen]')")) throw new Error("early"); });
  await step("idle_lock", async () => { await until("document.querySelector('[data-lock-screen]')", "idle", IDLE + 10000); console.log(`FACT idle_lock_after_ms=${Date.now() - last}`); await locked(); });
  await step("reload_stays_locked", async () => { await send("Page.reload"); await sleep(1500); await locked(); });
  await step("edited_session_stays_locked", async () => { await evaluate("localStorage.removeItem('otehon.account.v1')"); await send("Page.reload"); await sleep(1500); await locked(); });
  await step("forged_unlock", async () => { await sign(randomWallet()); await until("document.querySelector('[data-unlock-error=wrong-signer]')", "refusal"); await locked(); });
  await step("unlock", async () => { await sign(owner); await until("!document.querySelector('[data-lock-screen]')", "unlocked"); console.log(`FACT after_unlock_without_session step=${await evaluate("document.querySelector('[data-step]')?.dataset.step")} dapps=${await evaluate(dapps)}`); });
  // Sign in again, since the session was removed above.
  await step("signin_again", async () => {
    await click("#local-start"); await type("#local-address", owner.address);
    const m = await until("document.querySelector('#local-message')?.value", "msg"); await type("#local-signature", signPersonal(owner, m)); await click("#local-verify");
    await until(`${dapps} > 0`, "apps"); await until(`document.querySelector('.messages')?.innerText.includes(${JSON.stringify(text)})`, "thread kept");
  });
  await step("lock_button", async () => { await click("[data-lock-now]"); await locked(); await sign(owner); await until(`${dapps} > 0`, "apps"); });
  await step("new_browser_starts_locked", async () => { await stop(); await start(); await locked(); await sign(owner); await until(`document.querySelector('.messages')?.innerText.includes(${JSON.stringify(text)})`, "thread"); });
  await step("erase", async () => { await click("[data-lock-now]"); await locked(); await click("#lock-erase"); await click("#lock-erase-confirm");
    await until("document.querySelector('[data-step=signin]')", "signin"); if (await evaluate(`(localStorage.getItem('otehon.threads.v1') ?? '').includes(${JSON.stringify(text)})`)) throw new Error("thread kept"); });
} catch {} finally { try { await stop(); } catch {} }
const pass = Object.keys(results).length === 12 && Object.values(results).every((v) => v === 1);
console.log(`RESULT ${pass ? "pass" : "fail"} ${Object.entries(results).map(([k, v]) => `${k}=${v}`).join(" ")}`);
rmSync(PROFILE, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
