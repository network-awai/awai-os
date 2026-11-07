// Drives the built shell in headless Chrome on a workstation (docs/otehon/daily-0.1.0.md):
// Japanese text on every screen, the accessibility tree, the Settei and Web screens, and the
// language surviving a reload. It is not a VM check. The Settei helper and the web launcher are
// replaced here by stand-ins on the same ports, which answer like the real ones but check nothing,
// so this proves the shell's side only.
//
// usage: [CHROME=<chrome>] [DIST=<dist dir>] [BASELINE=1] node test/daily-browser-check.mjs <scratch-profile-dir>
//        BASELINE=1 runs only the accessibility audit, on screens an older shell also has.
// exit:  0 every step passed, 1 a step failed or the audit found something, 3 the check could not run
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import catalog from "../src/dapps.json" with { type: "json" };
import { TEXT } from "../src/i18n.js";
import { auditTree, summarize } from "./a11y.mjs";
import { randomWallet, signPersonal } from "./signers.js";

const S = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = process.argv[2];
const BASELINE = process.env.BASELINE === "1";
const PORT = 9334;
if (!PROFILE) {
  console.log("NOT_RUN no scratch profile directory");
  process.exit(3);
}
const PAGE = `file://${process.env.DIST ?? `${S}/dist`}/index.html`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Stand-ins for the loopback services. They record what the shell sent.
const standIn = { zone: "UTC", posts: [], opens: 0 };
const ZONES = ["America/New_York", "Asia/Tokyo", "Europe/Berlin", "UTC"];
function serve(port, handle) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      response.setHeader("Access-Control-Allow-Origin", "null");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (request.method === "OPTIONS") return response.writeHead(204).end();
      const [status, value] = handle(request.method, request.url, body ? JSON.parse(body) : null);
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
const servers = BASELINE
  ? []
  : [
      await serve(8774, (method, url, body) => {
        if (url !== "/v1/timezone") return [404, { error: "not-found" }];
        if (method === "GET") return [200, { zone: standIn.zone, zones: ZONES }];
        standIn.posts.push(body);
        // The stand-in refuses Berlin, so the check sees how the screen shows a refusal.
        if (body?.zone === "Europe/Berlin" || !ZONES.includes(body?.zone)) return [400, { error: "unknown-zone" }];
        standIn.zone = body.zone;
        return [200, { zone: body.zone }];
      }),
      await serve(8775, (method, url) => {
        if (method !== "POST" || url !== "/v1/open") return [404, { error: "not-found" }];
        standIn.opens += 1;
        return [200, { opened: true }];
      }),
    ];

let chrome;
let socket;
let id = 0;
const waiting = new Map();
const results = {};
const findings = {};

async function start() {
  chrome = spawn(
    CHROME,
    ["--headless=new", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, "--no-first-run", "--window-size=1280,800", PAGE],
    { stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(
        (item) => item.type === "page" && item.url.startsWith("file:"),
      );
      if (target) {
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = reject;
        });
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.id && waiting.has(message.id)) {
            waiting.get(message.id)(message);
            waiting.delete(message.id);
          }
        };
        await send("Accessibility.enable");
        return;
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(500);
  }
  throw new Error("no chrome");
}
async function stop() {
  socket?.close();
  chrome?.kill("SIGTERM");
  await new Promise((resolve) => chrome?.on("exit", resolve));
}
function send(method, params = {}) {
  id += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => waiting.set(id, resolve));
}
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
async function until(expression, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await evaluate(`(() => { const v = (${expression}); return v instanceof Node ? true : v; })()`).catch(
      () => null,
    );
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`timeout: ${label}`);
}
async function click(selector) {
  const box = JSON.parse(
    await until(
      `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) return null;
        e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect();
        return JSON.stringify({x: r.x + r.width / 2, y: r.y + r.height / 2}); })()`,
      `click ${selector}`,
    ),
  );
  const mouse = { x: box.x, y: box.y, button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...mouse });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse });
}
async function type(selector, text) {
  await click(selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
  await send("Input.insertText", { text });
}
async function step(name, action) {
  try {
    await action();
    results[name] = 1;
    console.log(`STEP ${name}=1`);
  } catch (error) {
    results[name] = 0;
    console.log(`STEP ${name}=0 ${error.message}`);
    throw error;
  }
}

// The accessibility audit of whatever is on screen now.
async function audit(screen) {
  await sleep(400);
  const { result } = await send("Accessibility.getFullAXTree");
  const lang = await evaluate("document.documentElement.lang");
  const found = auditTree(result.nodes, { lang });
  findings[screen] = found;
  console.log(`AUDIT ${screen} findings=${found.length} ${found.join(",")}`);
  if (process.env.VERBOSE === "1") console.log(`  ${summarize(result.nodes).join(" | ")}`);
}

// English left on a Japanese screen. Product and standard names stay in English on purpose.
const NAMES = [
  "Itonami", "Manimani", "Zenoh", "Matter", "Human Passport", "World ID", "Web3", "Optimism", "personal_sign",
  "Wi-Fi", "Bluetooth", "Web", "English", "Kotoba Browser", "AT Protocol", "PDS", "HOGP", "HID", "TSC", "PIT", "CIDv1",
  "Goal", "bigram", "devnet", "torihiki", "cid-v1-admit", "VM", "OS", "Awai Otehon",
  ...catalog.dapps.map((dapp) => dapp.title),
  ...catalog.dapps.flatMap((dapp) => dapp.remoteOperations.map((operation) => operation.operation)),
  ...ZONES,
];
const englishPhrases = [
  ...Object.keys(TEXT.en)
    .filter((key) => TEXT.en[key] !== TEXT.ja[key])
    .flatMap((key) => TEXT.en[key].split(/\{\w+\}/))
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= 6),
  ...catalog.dapps.map((dapp) => dapp.summary),
];
async function scanEnglish(screen) {
  await sleep(300);
  const text = await evaluate(`(() => {
    const consent = document.querySelector('dialog.kotoba-client-consent');
    if (consent?.open) return 'CONSENT_DIALOG_OPEN';
    const parts = [document.body.innerText];
    for (const element of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
      // The consent dialog belongs to the pinned shared runtime and is English only. Reported apart.
      if (element.closest('dialog.kotoba-client-consent')) continue;
      for (const name of ['aria-label', 'placeholder', 'title']) if (element.getAttribute(name)) parts.push(element.getAttribute(name));
    }
    return parts.join('\\n');
  })()`);
  let rest = text;
  for (const name of NAMES.sort((a, b) => b.length - a.length)) rest = rest.split(name).join(" ");
  const phrases = englishPhrases.filter((phrase) => text.includes(phrase));
  // Any two English words in a row that are not names, such as text a screen never translated.
  const words = [...new Set(rest.match(/[A-Za-z]{2,}(?:[ '][A-Za-z]{2,})+/g) ?? [])]
    .filter((match) => !/^(did|pkh|eip|0x)/.test(match));
  const hits = [...new Set([...phrases, ...words])];
  console.log(`ENGLISH ${screen} hits=${hits.length}${hits.length ? ` ${JSON.stringify(hits.slice(0, 8))}` : ""}`);
  return hits;
}

const dappCount = "document.querySelectorAll('.dapp').length";
const owner = randomWallet();

async function signIn(japanese) {
  await until("document.querySelector('[data-step=hello]')", "hello");
  await audit("setup-hello");
  await click("[data-next]");
  await until("document.querySelector('[data-step=language]')", "language");
  if (japanese) {
    await click("[data-language=ja]");
    await until("document.documentElement.lang === 'ja'", "lang ja");
  }
  await audit("setup-language");
  await click("[data-next]");
  await until("document.querySelector('[data-step=network]')", "network");
  await audit("setup-network");
  await click("[data-next]");
  await until("document.querySelector('[data-step=signin]')", "signin");
  await audit("setup-signin");
  await click("#local-start");
  await type("#local-address", owner.address);
  const message = await until("document.querySelector('#local-message')?.value", "message");
  await audit("setup-wallet");
  await type("#local-signature", signPersonal(owner, message));
  await click("#local-verify");
  await until("document.querySelector('[data-step=trust]')", "trust");
  await audit("setup-trust");
  await click("[data-next]");
  await until("document.querySelector('[data-step=done]')", "done");
  await audit("setup-done");
  await click("[data-finish]");
  await until(`${dappCount} > 0`, "apps");
}

const english = {};
async function screens(scan) {
  const visit = async (name, selector, ready) => {
    if (selector) await click(selector);
    await until(ready, name);
    await audit(name);
    if (scan) english[name] = await scanEnglish(name);
  };
  await visit("home", null, "document.querySelector('.composer')");
  await visit("dapp", "[data-dapp=aozora]", "document.querySelector('aside.panel')");
  await visit("dapp-locked", "[data-dapp=torihiki]", "document.querySelector('aside.panel')");
  await visit("account", "[data-account]", "document.querySelector('[data-sign-out]')");
  await visit("manimani", "[data-manimani-link]", "document.querySelector('[data-manimani]')");
  if (!BASELINE) {
    await visit("settei", "[data-dapp=settei]", "document.querySelector('#settei-zone')");
    await visit("web", "[data-dapp=browser]", "document.querySelector('#web-open')");
  }
}

async function lockAndUnlock(scan) {
  await click("[data-lock-now]");
  await until("document.querySelector('[data-lock-screen]')", "lock screen");
  await audit("lock");
  if (scan) english.lock = await scanEnglish("lock");
  const message = await until("document.querySelector('#unlock-message')?.value", "unlock message");
  await type("#unlock-signature", signPersonal(owner, message));
  await click("#unlock-verify");
  await until(`${dappCount} > 0`, "apps after unlock");
}

console.log("KNOWN the shared consent dialog (vendor/kotoba-client-runtime.js) is English only and is not scanned");
rmSync(PROFILE, { recursive: true, force: true });
let ran = false;
try {
  await start();
  ran = true;
  if (BASELINE) {
    await step("signin", () => signIn(false));
    await step("screens", () => screens(false));
    await step("lock", () => lockAndUnlock(false));
  } else {
    await step("signin_in_japanese", () => signIn(true));
    await step("japanese_screens", async () => {
      await screens(true);
      await lockAndUnlock(true);
      const left = Object.entries(english).filter(([, hits]) => hits.length);
      if (left.length) throw new Error(`english-left ${left.map(([name]) => name).join(",")}`);
    });
    await step("language_survives_reload", async () => {
      await send("Page.reload");
      await until("document.documentElement.lang === 'ja'", "lang after reload");
      await until(`${dappCount} > 0`, "apps after reload");
      const label = await evaluate("document.querySelector('[data-lock-now]').textContent");
      if (label !== TEXT.ja["lock.now"]) throw new Error(`lock label ${label}`);
    });
    await step("time_zone", async () => {
      await click("[data-dapp=settei]");
      await until("document.querySelector('[data-settei-zone=UTC]')", "current zone shown");
      const disabled = await evaluate("document.querySelector('#settei-apply').disabled");
      if (!disabled) throw new Error("apply-enabled-for-the-current-zone");
      // A <select> is set the way a keyboard user sets it: focus, then choose. React sees a change event.
      await evaluate(`(() => { const s = document.querySelector('#settei-zone'); s.focus();
        const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'Asia/Tokyo');
        s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await click("#settei-apply");
      await until("document.querySelector('[data-settei-applied=\"Asia/Tokyo\"]')", "applied");
      await until("document.querySelector('[data-settei-zone=\"Asia/Tokyo\"]')", "zone shown");
      if (standIn.zone !== "Asia/Tokyo" || standIn.posts.length !== 1) throw new Error(`stand-in ${JSON.stringify(standIn)}`);
    });
    await step("time_zone_refusal_shown", async () => {
      await evaluate(`(() => { const s = document.querySelector('#settei-zone');
        const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'Europe/Berlin');
        s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await click("#settei-apply");
      await until("document.querySelector('[data-settei-refused=unknown-zone]')", "refusal shown");
      if (standIn.zone !== "Asia/Tokyo") throw new Error("zone changed after a refusal");
    });
    await step("web_open", async () => {
      await click("[data-dapp=browser]");
      await click("#web-open");
      await until("document.querySelector('[data-web-state=opened]')", "opened");
      if (standIn.opens !== 1) throw new Error(`opens ${standIn.opens}`);
    });
    // The positive control for the English scan: in English the same screens must show English.
    await step("english_scan_finds_english", async () => {
      await click("[data-dapp=settei]");
      await click("[data-language=en]");
      await until("document.documentElement.lang === 'en'", "lang en");
      const hits = [];
      for (const [name, selector, ready] of [
        ["settei-en", null, "document.querySelector('#settei-zone')"],
        ["home-en", "button.new-chat", "document.querySelector('.composer')"],
        ["dapp-en", "[data-dapp=aozora]", "document.querySelector('aside.panel')"],
      ]) {
        if (selector) await click(selector);
        await until(ready, name);
        hits.push(...(await scanEnglish(name)));
      }
      if (hits.length < 10) throw new Error(`scan found only ${hits.length} English phrases in English`);
    });
  }
} catch {
  // The failed step is already reported.
} finally {
  try {
    await stop();
  } catch {
    // Chrome already exited.
  }
  for (const server of servers) server.close();
}
if (!ran) {
  console.log("NOT_RUN chrome did not start");
  process.exit(3);
}
const auditFindings = Object.values(findings).flat().length;
const steps = Object.values(results);
const pass = steps.length > 0 && steps.every((value) => value === 1) && auditFindings === 0;
console.log(
  `RESULT ${pass ? "pass" : "fail"} screens_audited=${Object.keys(findings).length} audit_findings=${auditFindings} ${Object.entries(results)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ")}`,
);
rmSync(PROFILE, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
