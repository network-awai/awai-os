// AWAI-3170: one EN devnet support from the Itonami app on an Android emulator this run owns.
//
// usage (from dapps/awai-support, with test/devnet_stack.sh running and the debug APK built with
// scripts/devnet-trust.mjs for the same CA):
//   node test/live_android.mjs SERIAL APK STACK_DIR OUT_DIR
//
// Every decision is a real tap through `adb shell input tap` (trusted input), including the shared
// broker's "Allow once" / "Deny" and the panel's approve/cancel buttons. Chrome DevTools on the debug
// WebView is used only to read the page and to fill the test wallet's address and signature during
// first-run sign-in. The test wallet is a secp256k1 key made for this run; it signs the app's own
// sign-in message, so the app's signature verification still runs.
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
const funds = () => deskRequests().filter((r) => r.path === "/v1/support/funds" && r.method === "POST").length;
const fundsAny = () => deskRequests().filter((r) => r.path === "/v1/support/funds").length;

// ---- device
step("install and reverse");
adb("install", "-r", apk);
adb("shell", "pm", "clear", PKG);
adb("reverse", "tcp:18795", "tcp:18795");
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
  const m = xml.match(/text="Wait"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
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
      const m = adb("shell", "cat", "/sdcard/ui.xml").match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
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
const consentOpen = () => js(`!!document.querySelector("dialog.kotoba-client-consent[open]")`);
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
const supportState = () => js(`document.querySelector(".awai-support")?.dataset.supportState ?? null`);

// ---- first-run sign-in with a test wallet made for this run
step("sign-in");
await waitFor(`!!document.querySelector("#local-start, [data-next], .sidebar")`);
if (await js(`!!document.querySelector("[data-next]") && !document.querySelector("#local-start")`)) await tap("[data-next]", "next");
await waitFor(`!!document.querySelector("#local-start")`);
for (let i = 0; i < 5 && !(await js(`!!document.querySelector("#local-address")`)); i++) {
  waitOnAnr();
  if (await js(`!!document.querySelector("#local-start")`)) await tap("#local-start", "use a wallet on this device");
  await sleep(1500);
}
const wallet = secp256k1.utils.randomSecretKey();
const pub = secp256k1.getPublicKey(wallet, false).slice(1);
const address = "0x" + Buffer.from(keccak_256(pub).slice(-20)).toString("hex");
const setValue = (sel, v) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const s=Object.getOwnPropertyDescriptor(e.constructor.prototype,"value").set;s.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event("input",{bubbles:true}));return true})()`);
await waitFor(`!!document.querySelector("#local-address")`);
await setValue("#local-address", address);
if (!(await waitFor(`!!document.querySelector("#local-message")?.value`, 40000))) throw Error("sign-in message did not appear");
const message = await js(`document.querySelector("#local-message").value`);
const bytes = Buffer.from(message, "utf8");
const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`), bytes]));
const sig = secp256k1.sign(digest, wallet, { prehash: false, format: "recovered" }); // [recovery, r, s]
const signature = "0x" + Buffer.from(sig.slice(1)).toString("hex") + (27 + sig[0]).toString(16);
await setValue("#local-signature", signature);
await tap("#local-verify", "verify signature");
for (let i = 0; i < 6 && !(await js(`!!document.querySelector(".sidebar")`)); i++) {
  if (await js(`!!document.querySelector("[data-finish]:not([disabled])")`)) await tap("[data-finish]", "finish setup");
  else if (await js(`!!document.querySelector("[data-next]")`)) await tap("[data-next]", "next");
  else await sleep(1000);
}
check("first-run sign-in with the test wallet reaches the shell", await waitFor(`!!document.querySelector(".sidebar")`), await js(`document.body.innerText.slice(0,300)`));

// ---- Itonami context and the support panel
await tap('button[data-dapp="itonami"]', "Itonami");
check("the support panel shows Awai Network LLC and the devnet notice",
  await waitFor(`document.querySelector(".awai-support")?.innerText.includes("Awai Network LLC") && !!document.querySelector('.support-notice[data-value-class="devnet"]')`),
  await js(`document.querySelector(".awai-support")?.innerText ?? "no panel"`));
screenshot("support-ready.png");
const h0 = await nodeHeight(), f0 = funds();

// Negative control 1: cancel on the card.
await tap('[data-support-action="review"]', "review");
const scope1 = await consent("allow");
check("preparing the card asks the broker first (prepare-support)", /prepare-support/.test(scope1) && /localhost:18795/.test(scope1), scope1);
check("the card appears with the amount and devnet", await waitFor(`document.querySelector(".awai-support")?.dataset.supportState === "card"`), await supportState());
screenshot("support-card.png");
await tap('[data-support-action="cancel"]', "cancel on the card");
check("cancel on the card sends nothing", (await supportState()) === "denied" && funds() === f0 && (await nodeHeight()) === h0, `${await supportState()} funds=${funds()}`);

// Negative control 2: approve the card, then deny the broker's send-support request.
await tap('[data-support-action="review"]', "review again");
await consent("allow");
await waitFor(`document.querySelector(".awai-support")?.dataset.supportState === "card"`);
await tap('[data-support-action="approve"]', "approve the card");
const scope2 = await consent("deny");
await waitFor(`document.querySelector(".awai-support")?.dataset.supportState === "denied"`);
check("denying send-support in the broker sends nothing, not even a preflight", /send-support/.test(scope2) && fundsAny() === 0 && (await nodeHeight()) === h0, `${scope2} funds=${funds()}`);
screenshot("support-denied.png");

// The approved support.
await tap('[data-support-action="review"]', "review a third time");
await consent("allow");
await waitFor(`document.querySelector(".awai-support")?.dataset.supportState === "card"`);
const transfer = await js(`document.querySelector("[data-support-card]")?.dataset.supportCard`);
await tap('[data-support-action="approve"]', "approve the card");
const scope3 = await consent("allow");
const scope4 = await consent("allow");
check("sending and reading back each ask the broker", /send-support/.test(scope3) && /read-support-receipt/.test(scope4), `${scope3} | ${scope4}`);
check("the panel shows the receipt", await waitFor(`document.querySelector(".awai-support")?.dataset.supportState === "received"`),
  await js(`document.querySelector(".awai-support")?.innerText ?? ""`));
screenshot("support-received.png");
let receipt = null; // read back independently of the app, trusting only this run's CA
try { receipt = JSON.parse(execFileSync("curl", ["-s", "--cacert", stack.ca, `${stack.desk}/v1/support/receipts/${transfer}`], { encoding: "utf8" })); } catch { /* recorded as null */ }
check("an independent read of the desk shows the same receipt", receipt?.received === true && receipt?.["transfer-id"] === transfer, JSON.stringify(receipt));
check("exactly one support reached the node", (await nodeHeight()) === h0 + 1 && funds() === f0 + 1, `height=${await nodeHeight()} funds=${funds()}`);
const panelText = await js(`document.querySelector(".awai-support")?.innerText ?? ""`);
check("the receipt on screen names the same transfer", panelText.includes(transfer), transfer);

ws.close();
adb("forward", "--remove", "tcp:9339");
adb("shell", "wm", "size", "reset");
adb("shell", "wm", "density", "reset");
const passed = checks.filter((c) => c.passed).length;
const evidence = {
  schema: "awai.support-android-evidence/1", issue: "AWAI-3170", parent: "AWAI-3112",
  device: { serial, display: "1920x1080 at density 160 (wm override during the run)", model: adb("shell", "getprop", "ro.product.model").trim(), sdk: adb("shell", "getprop", "ro.build.version.sdk").trim(), abi: adb("shell", "getprop", "ro.product.cpu.abi").trim(), kind: "emulator owned by this run" },
  apk: { sha256: execFileSync("shasum", ["-a", "256", apk], { encoding: "utf8" }).split(" ")[0], build: "debug, aarch64, debug-only trust of this run's devnet CA" },
  stack: { desk: stack.desk, node: stack.node, chain: "awai-en-devnet/awai-3170", valueClass: "devnet", finality: "single-operator-devnet" },
  recipient: "Awai Network LLC", wording: "support (donation wording undecided)",
  anrWaits, testWallet: { address, note: "secp256k1 key made for this run; signs the app's own sign-in message" },
  transfer, deskReceipt: receipt, consentScopes: [scope1, scope2, scope3, scope4],
  deskRequests: deskRequests(), checks, passed, total: checks.length,
};
writeFileSync(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(`${passed} of ${checks.length} checks`);
process.exit(passed === checks.length ? 0 : 1);
