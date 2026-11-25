// AWAI-3115: one EN devnet compute order from the Itonami app on an Android emulator this run owns.
//
// usage (from dapps/awai-compute, with test/devnet_stack.sh running and the debug APK built with
// scripts/devnet-trust.mjs for the same CA and with AWAI_COMPUTE_DESK_ORIGIN /
// AWAI_COMPUTE_PROVIDER_DID set):
//   node test/live_android.mjs SERIAL APK STACK_DIR OUT_DIR
//
// Every decision is a real tap through `adb shell input tap` (trusted input), including the shared
// broker's "Allow once" / "Deny" and the panel's approve/cancel buttons. Chrome DevTools on the
// debug WebView is used only to read the page and to fill the test wallet's address and signature
// during first-run sign-in. The test wallet is a secp256k1 key made for this run; it signs the
// app's own sign-in message, so the app's signature verification still runs.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { secp256k1 } from "../../../otehon/shell/node_modules/@noble/curves/secp256k1.js";
import { keccak_256 } from "../../../otehon/shell/node_modules/@noble/hashes/sha3.js";

const [serial, apk, stackDir, outArg] = process.argv.slice(2);
const out = path.resolve(outArg); mkdirSync(out, { recursive: true });
const stack = JSON.parse(readFileSync(path.join(stackDir, "stack.json"), "utf8"));
const PKG = "network.itonami.app";
const adb = (...a) => execFileSync("adb", ["-s", serial, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ check: name, passed: !!ok, detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
};
const step = (s) => { appendFileSync(path.join(out, "steps.log"), `${new Date().toISOString()} ${s}\n`); console.log("..", s); };
const nodeHeight = async () => (await (await fetch(`${stack.node}/v1/head`)).json()).height;
const deskRequests = () => readFileSync(path.join(stackDir, "desk", "requests.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const orders = () => deskRequests().filter((r) => r.path === "/v1/compute/orders" && r.method === "POST").length;
const ordersAny = () => deskRequests().filter((r) => r.path === "/v1/compute/orders").length;
const deskPort = new URL(stack.desk).port;

// ---- device
step("install and reverse");
adb("install", "-r", apk);
adb("shell", "pm", "clear", PKG);
adb("reverse", `tcp:${deskPort}`, `tcp:${deskPort}`);
adb("shell", "settings", "put", "system", "screen_off_timeout", "1800000");
// The Itonami context lives in the desktop sidebar (hidden below 800 CSS px). Show the emulator as a
// 1920x1080 desktop at density 160, the Otehon reference width; reset at the end.
adb("shell", "wm", "size", "1920x1080");
adb("shell", "wm", "density", "160");
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
await sleep(6000);

// ---- DevTools (read and fill only)
// A cold start on a loaded emulator can raise "App not responding". Press "Wait" (never "Close app")
// and record it.
const anrWaits = [];
function waitOnAnr() {
  const focus = adb("shell", "dumpsys", "window").match(/mCurrentFocus=[^\n]*/)?.[0] ?? "";
  if (!/Application Not Responding/.test(focus)) return false;
  adb("shell", "uiautomator", "dump", "/sdcard/anr.xml");
  const xml = adb("shell", "cat", "/sdcard/anr.xml");
  const m = xml.match(/text="Wait"[^>]*bounds="\[(\\d+),(\\d+)\\]\[(\\d+),(\\d+)\]"/);
  if (!m) return false;
  adb("shell", "input", "tap", String((+m[1] + +m[3]) >> 1), String((+m[2] + +m[4]) >> 1));
  anrWaits.push(new Date().toISOString());
  return true;
}
let pid = "";
for (let i = 0; i < 60 && !pid; i++) {
  try { pid = adb("shell", "pidof", PKG).trim(); } catch { await sleep(1000); }
}
for (let i = 0; i < 30 && !adb("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`); i++) await sleep(1000);
adb("forward", "tcp:9339", `localabstract:webview_devtools_remote_${pid}`);
let pages = [];
for (let i = 0; i < 90 && !pages.some((p) => p.type === "page"); i++) {
  waitOnAnr();
  pages = await fetch("http://127.0.0.1:9339/json").then((r) => r.json()).catch(() => []);
  if (!pages.some((p) => p.type === "page")) await sleep(1000);
}
const page = pages.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const waiting = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await js(expr)) return true; await sleep(300); } return false; };

// Map a CSS-pixel rect in the WebView to screen pixels using the WebView's bounds from uiautomator.
let origin = null; // the WebView does not move during a run; read it once, retrying a flaky dump
function webviewOrigin() {
  for (let i = 0; !origin && i < 8; i++) {
    try {
      adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
      const m = adb("shell", "cat", "/sdcard/ui.xml").match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\\d+),(\\d+)\\]\[(\\d+),(\\d+)\]"/);
      if (m) origin = { x: +m[1], y: +m[2] };
    } catch { /* retry */ }
    if (!origin) execFileSync("sleep", ["1"]);
  }
  if (!origin) throw Error("WebView not found on screen");
  return origin;
}
async function tap(selector, label) {
  await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:"center"})`);
  await sleep(400);
  const r = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,dpr:devicePixelRatio,disabled:!!e.disabled}})()`);
  if (!r) throw Error(`no element ${selector}`);
  const o = webviewOrigin();
  const x = Math.round(o.x + r.x * r.dpr), y = Math.round(o.y + r.y * r.dpr);
  step(`tap ${label ?? selector} at ${x},${y}`);
  adb("shell", "input", "tap", String(x), String(y));
  await sleep(700);
}
const consentScope = () => js(`document.querySelector("dialog.kotoba-client-consent[open] .kotoba-client-consent-scope")?.textContent ?? ""`);
async function consent(choice) {
  if (!(await waitFor(`!!document.querySelector("dialog.kotoba-client-consent[open]")`))) throw Error("no consent dialog");
  const scope = await consentScope();
  await sleep(1200); // the broker arms Allow only after the dialog has been visible for a moment
  const index = choice === "allow" ? "last-of-type" : "first-of-type";
  await tap(`dialog.kotoba-client-consent[open] button:${index}`, `consent ${choice}`);
  return scope;
}
const screenshot = (name) => writeFileSync(path.join(out, name), execFileSync("adb", ["-s", serial, "exec-out", "screencap", "-p"]));
const computeState = () => js(`document.querySelector(".awai-compute")?.dataset.computeState ?? null`);

// ---- first-run sign-in with a test wallet made for this run
step("sign-in");
await waitFor(`!!document.querySelector("#local-start, [data-next], .sidebar")`, 60000);
const alreadySignedIn = await js(`!!document.querySelector(".sidebar")`);
let address = null;
if (!alreadySignedIn) {
if (await js(`!!document.querySelector("[data-next]") && !document.querySelector("#local-start")`)) await tap("[data-next]", "next");
await waitFor(`!!document.querySelector("#local-start")`);
for (let i = 0; i < 5 && !(await js(`!!document.querySelector("#local-address")`)); i++) {
  waitOnAnr();
  if (await js(`!!document.querySelector("#local-start")`)) await tap("#local-start", "use a wallet on this device");
  await sleep(1500);
}
const wallet = secp256k1.utils.randomSecretKey();
const pub = secp256k1.getPublicKey(wallet, false).slice(1);
address = "0x" + Buffer.from(keccak_256(pub).slice(-20)).toString("hex");
const setValue = (sel, v) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const s=Object.getOwnPropertyDescriptor(e.constructor.prototype,"value").set;s.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event("input",{bubbles:true}));return true})()`);
await waitFor(`!!document.querySelector("#local-address")`);
await setValue("#local-address", address);
if (!(await waitFor(`!!document.querySelector("#local-message")?.value`, 40000))) throw Error("sign-in message did not appear");
const message = await js(`document.querySelector("#local-message").value`);
const bytes = Buffer.from(message, "utf8");
const digest = keccak_256(Buffer.concat([Buffer.from(`\\x19Ethereum Signed Message:\\n${bytes.length}`), bytes]));
const sig = secp256k1.sign(digest, wallet, { prehash: false, format: "recovered" }); // [recovery, r, s]
const signature = "0x" + Buffer.from(sig.slice(1)).toString("hex") + (27 + sig[0]).toString(16);
await setValue("#local-signature", signature);
await tap("#local-verify", "verify signature");
for (let i = 0; i < 6 && !(await js(`!!document.querySelector(".sidebar")`)); i++) {
  if (await js(`!!document.querySelector("[data-finish]:not([disabled])")`)) await tap("[data-finish]", "finish setup");
  else if (await js(`!!document.querySelector("[data-next]")`)) await tap("[data-next]", "next");
  else await sleep(1000);
}
}
check("first-run sign-in with the test wallet reaches the shell", await waitFor(`!!document.querySelector(".sidebar")`), await js(`document.body.innerText.slice(0,300)`));

// ---- Itonami context and the compute panel
await tap('button[data-dapp="itonami"]', "Itonami");
check("the compute panel shows the devnet notice",
  await waitFor(`document.querySelector(".awai-compute")?.innerText.includes("devnet") && !!document.querySelector('.compute-notice[data-value-class="devnet"]')`),
  await js(`document.querySelector(".awai-compute")?.innerText ?? "no panel"`));
screenshot("compute-ready.png");
const h0 = await nodeHeight(), o0 = orders();

// Negative control 1: cancel on the card.
await tap('[data-compute-action="review"]', "review");
const scope1 = await consent("allow");
check("preparing the offer asks the broker first (prepare-compute)", /prepare-compute/.test(scope1) && new RegExp(`localhost:${deskPort}`).test(scope1), scope1);
check("the offer card appears with provider and devnet", await waitFor(`document.querySelector(".awai-compute")?.dataset.computeState === "card"`), await computeState());
screenshot("compute-card.png");
await tap('[data-compute-action="cancel"]', "cancel on the card");
check("cancel on the card sends nothing", (await computeState()) === "denied" && orders() === o0 && (await nodeHeight()) === h0, `${await computeState()} orders=${orders()}`);

// Negative control 2: approve the offer, then deny the broker's run-compute request.
await tap('[data-compute-action="review"]', "review again");
await consent("allow");
await waitFor(`document.querySelector(".awai-compute")?.dataset.computeState === "card"`);
await tap('[data-compute-action="approve"]', "approve the offer");
const scope2 = await consent("deny");
await waitFor(`document.querySelector(".awai-compute")?.dataset.computeState === "denied"`);
check("denying run-compute in the broker sends nothing, not even a preflight", /run-compute/.test(scope2) && ordersAny() === 0 && (await nodeHeight()) === h0, `${scope2} orders=${orders()}`);
screenshot("compute-denied.png");

// The approved order.
await tap('[data-compute-action="review"]', "review a third time");
await consent("allow");
await waitFor(`document.querySelector(".awai-compute")?.dataset.computeState === "card"`);
const orderId = await js(`document.querySelector("[data-compute-card]")?.dataset.computeCard`);
await tap('[data-compute-action="approve"]', "approve the offer");
const scope3 = await consent("allow");
const scope4 = await consent("allow");
check("running and reading back each ask the broker", /run-compute/.test(scope3) && /read-work-receipt/.test(scope4), `${scope3} | ${scope4}`);
check("the panel shows the work receipt", await waitFor(`document.querySelector(".awai-compute")?.dataset.computeState === "received"`),
  await js(`document.querySelector(".awai-compute")?.innerText ?? ""`));
screenshot("compute-received.png");
let receipt = null; // read back independently of the app, trusting only this run's CA
try { receipt = JSON.parse(execFileSync("curl", ["-s", "--cacert", stack.ca, `${stack.desk}/v1/compute/receipts/${orderId}`], { encoding: "utf8" })); } catch { /* recorded as null */ }
check("an independent read of the desk shows the same receipt", receipt?.received === true && receipt?.["order-id"] === orderId, JSON.stringify(receipt));
check("exactly one compute transfer reached the node", (await nodeHeight()) === h0 + 1 && orders() === o0 + 1, `height=${await nodeHeight()} orders=${orders()}`);
const panelText = await js(`document.querySelector(".awai-compute")?.innerText ?? ""`);
check("the receipt on screen names the same order", panelText.includes(orderId), orderId);

ws.close();
adb("forward", "--remove", "tcp:9339");
adb("shell", "wm", "size", "reset");
adb("shell", "wm", "density", "reset");
adb("reverse", "--remove", `tcp:${deskPort}`);
const passed = checks.filter((c) => c.passed).length;
const evidence = {
  schema: "awai.compute-android-evidence/1", issue: "AWAI-3115", parent: "AWAI-3112",
  device: { serial, display: "1920x1080 at density 160 (wm override during the run)", model: adb("shell", "getprop", "ro.product.model").trim(), sdk: adb("shell", "getprop", "ro.build.version.sdk").trim(), abi: adb("shell", "getprop", "ro.product.cpu.abi").trim(), kind: "emulator owned by this run" },
  apk: { sha256: execFileSync("shasum", ["-a", "256", apk], { encoding: "utf8" }).split(" ")[0], build: `debug, ${adb("shell", "getprop", "ro.product.cpu.abi").trim()}, debug-only trust of this run's devnet CA` },
  stack: { desk: stack.desk, node: stack.node, chain: "awai-en-devnet/awai-3115", valueClass: "devnet", finality: "single-operator-devnet" },
  wording: "provide (devnet only)",
  anrWaits, signIn: alreadySignedIn ? "existing account on the device, untouched" : "test wallet", testWallet: alreadySignedIn ? null : { address, note: "secp256k1 key made for this run; signs the app's own sign-in message" },
  orderId, deskReceipt: receipt, consentScopes: [scope1, scope2, scope3, scope4],
  deskRequests: deskRequests(), checks, passed, total: checks.length,
};
writeFileSync(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(`${passed} of ${checks.length} checks`);
process.exit(passed === checks.length ? 0 : 1);
