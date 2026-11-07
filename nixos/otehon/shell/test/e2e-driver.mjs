// Drives the real shell in Chromium through DevTools, with trusted input, against a
// real relay on loopback. A wallet and a passkey are simulated with random keys.
// Built only for the desktop-login check image.
import { p256 } from "@noble/curves/nist.js";
import { execSync } from "node:child_process";
import { p256Did, parseLinkFragment, sealResponse } from "../src/identity/link.js";
import { passkeyResponse, randomWallet, signPersonal, walletResponse } from "./signers.js";

const RELAY = process.env.RELAY_ORIGIN;
const EXPECTED_DAPPS = Number(process.env.EXPECTED_DAPPS);
const results = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
      const page = targets.find((target) => target.type === "page" && target.url.startsWith("file:"));
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = reject;
        });
        return socket;
      }
    } catch {
      // Chromium is still starting.
    }
    await sleep(1000);
  }
  throw new Error("no-devtools-target");
}

const socket = await connect();
let nextId = 0;
const waiting = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
};

function send(method, params = {}) {
  nextId += 1;
  socket.send(JSON.stringify({ id: nextId, method, params }));
  return new Promise((resolve) => waiting.set(nextId, resolve));
}

async function evaluate(expression) {
  const { result } = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (result?.exceptionDetails) throw new Error(`page-error: ${expression}`);
  return result?.result?.value;
}

async function until(expression, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    // A DOM node cannot be returned by value, so report it as true.
    const value = await evaluate(`(() => { const v = (${expression}); return v instanceof Node ? true : v; })()`).catch(
      () => null,
    );
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`timeout: ${label}`);
}

// Input.dispatchMouseEvent produces isTrusted events, which the consent host requires.
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
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...mouse });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse });
}

// Replaces the field's text. Clicking collapses a selection, so select after the click.
async function type(selector, text) {
  await click(selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
  await send("Input.insertText", { text });
}

const ALLOW = "dialog.kotoba-client-consent button:last-of-type";
const DENY = "dialog.kotoba-client-consent button:first-of-type";

async function publish(topic, sealed) {
  const response = await fetch(`${RELAY}/${topic}`, { method: "POST", body: sealed });
  if (!response.ok) throw new Error(`relay-post-${response.status}`);
}

async function allowLink() {
  await click("#link-start");
  await until("document.querySelector('dialog.kotoba-client-consent')?.open", "consent dialog");
  // Allow only counts after the dialog has been open for 600 ms.
  await sleep(900);
  await click(ALLOW);
  const url = await until("document.querySelector('[data-link-url]')?.dataset.linkUrl", "QR code");
  return parseLinkFragment(url.split("#")[1]);
}

async function step(name, action) {
  try {
    await action();
    results[name] = 1;
    console.log(`OTEHON_LOGIN_STEP ${name}=1`);
  } catch (error) {
    results[name] = 0;
    console.log(`OTEHON_LOGIN_STEP ${name}=0 ${error.message}`);
    throw error;
  }
}

// Manimani through the real shell, service and local model. Stopping the model is the negative
// control: the shell must say so, and no answer may appear.
async function checkManimani() {
  const status = (value) => `document.querySelector('[data-manimani-status=${JSON.stringify(value)}]')`;
  const answers = "document.querySelectorAll('.manimani-message[data-role=assistant]').length";
  const say = async (text) => {
    await type("input[aria-label='Message Manimani']", text);
    await click(".manimani-composer button");
  };
  await step("manimani_under_new_chat", async () => {
    await until("document.querySelector('.new-chat + [data-manimani-link]')", "Manimani under New chat");
    await click("[data-manimani-link]");
    await until("document.querySelector('[data-manimani]')", "Manimani screen");
  });
  await step("manimani_ready", async () => {
    await until(status("ready"), "service and model", 600000);
  });
  await step("manimani_answers", async () => {
    await say("Say hello in one short sentence.");
    await until(`${answers} >= 1`, "an answer from the local model", 900000);
    const text = await evaluate("document.querySelector('.manimani-message[data-role=assistant]').textContent");
    console.log(`OTEHON_MANIMANI_ANSWER ${JSON.stringify(text.slice(0, 200))}`);
  });
  await step("manimani_confined", async () => {
    const shown = execSync("systemctl show otehon-manimani -p IPAddressDeny -p IPAddressAllow").toString();
    console.log(`OTEHON_MANIMANI_CONFINED ${JSON.stringify(shown)}`);
    if (!/IPAddressDeny=\S/.test(shown)) throw new Error("not-confined");
    if (execSync("systemctl is-enabled otehon-manimani").toString().trim() !== "enabled") throw new Error("not-enabled");
  });
  await step("manimani_survives_a_kill", async () => {
    const before = await evaluate(answers);
    execSync("systemctl kill -s SIGKILL otehon-manimani");
    await until(status("stopped"), "the shell sees it stop", 30000);
    await until(status("ready"), "systemd restarts it", 120000);
    if ((await evaluate(answers)) !== before) throw new Error("lost-messages");
  });
  await step("manimani_no_model_no_answer", async () => {
    const before = await evaluate(answers);
    execSync("systemctl stop otehon-manimani-llm");
    await until(status("model-unavailable"), "the shell sees the model stop", 120000);
    await say("Are you there?");
    await until("document.querySelector('.manimani-message[data-role=notice]')", "a notice", 60000);
    if ((await evaluate(answers)) !== before) throw new Error("made-up-answer");
    execSync("systemctl start otehon-manimani-llm");
    await until(status("ready"), "the model returns", 600000);
  });
}

const dappCount = "document.querySelectorAll('.dapp').length";
const wallet = randomWallet();
const passkey = p256.utils.randomSecretKey();
let outcome = "pass";

try {
  await step("gate", async () => {
    await until("document.querySelector('[data-step=hello]')", "first step");
    if ((await evaluate(dappCount)) !== 0) throw new Error("apps-visible-before-login");
  });
  await step("setup_steps", async () => {
    await click("[data-next]");
    await until("document.querySelector('[data-step=language]')", "language step");
    await click("[data-language=ja]");
    await until("document.documentElement.lang === 'ja'", "language applied");
    await click("[data-next]");
    await until("document.querySelector('[data-step=network]')", "network step");
    await click("[data-next]");
    await until("document.querySelector('[data-step=signin]')", "sign-in step");
    const next = await evaluate("document.querySelector('[data-next]') === null");
    if (!next) throw new Error("sign-in-can-be-skipped");
  });
  await step("consent_deny", async () => {
    await click("#link-start");
    await until("document.querySelector('dialog.kotoba-client-consent')?.open", "consent dialog");
    await click(DENY);
    await until("document.querySelector('[data-link-state=denied]')", "denied state");
    if (await evaluate("document.querySelector('[data-link-url]') !== null")) throw new Error("qr-after-deny");
  });

  const request = await allowLink();
  results.consent_allow = 1;
  console.log("OTEHON_LOGIN_STEP consent_allow=1");

  await step("wrong_signer", async () => {
    const forged = { ...walletResponse(wallet, request, Date.now()), address: randomWallet().address };
    await publish(request.topic, await sealResponse(request, forged));
    await until("document.querySelector('[data-link-error=wrong-signer]')", "refusal");
    if ((await evaluate(dappCount)) !== 0) throw new Error("apps-visible-after-forgery");
  });
  await step("wrong_key", async () => {
    await publish(request.topic, "bm90LWVuY3J5cHRlZA");
    await until("document.querySelector('[data-link-error=cannot-decrypt]')", "refusal");
  });
  await step("wallet", async () => {
    await publish(request.topic, await sealResponse(request, walletResponse(wallet, request, Date.now())));
    await until("document.querySelector('[data-step=trust]')", "trust step");
    if ((await evaluate("document.querySelector('[data-score]').dataset.score")) !== "10") throw new Error("score");
    await click("[data-next]");
    await click("[data-finish]");
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps");
    const account = await evaluate("document.querySelector('[data-account]').dataset.account");
    if (account !== `did:pkh:eip155:1:${wallet.address}`) throw new Error("wrong-account");
    await until("document.title.includes('gate=0')", "title");
  });
  await step("trust_lock", async () => {
    await click("[data-dapp=torihiki]");
    await until("document.querySelector('[data-operation=submit-order][data-locked=true]')", "locked operation");
    await until("document.querySelector('[data-operation=read-quotes][data-locked=false]')", "open operation");
  });
  await step("reload_keeps_login", async () => {
    await send("Page.reload");
    await sleep(1500);
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps after reload");
  });
  await step("tamper_returns_to_login", async () => {
    await evaluate(`(() => {
      const saved = JSON.parse(localStorage.getItem('otehon.account.v1'));
      saved.response.address = ${JSON.stringify(randomWallet().address)};
      localStorage.setItem('otehon.account.v1', JSON.stringify(saved));
    })()`);
    await send("Page.reload");
    await sleep(1500);
    await until("document.querySelector('[data-step=signin]')", "sign-in after tampering");
    if ((await evaluate(dappCount)) !== 0) throw new Error("apps-visible-after-tamper");
  });
  await step("passkey", async () => {
    const second = await allowLink();
    await publish(second.topic, await sealResponse(second, passkeyResponse(passkey, second, Date.now())));
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps with passkey");
    const account = await evaluate("document.querySelector('[data-account]').dataset.account");
    if (account !== p256Did(p256.getPublicKey(passkey))) throw new Error("wrong-account");
  });
  await step("sign_out", async () => {
    await click("[data-account]");
    await click("[data-sign-out]");
    await until("document.querySelector('[data-step=signin]')", "sign-in after sign-out");
  });
  await step("local_wrong_signer", async () => {
    await click("#local-start");
    await type("#local-address", wallet.address);
    const message = await until("document.querySelector('#local-message')?.value", "message to sign");
    await type("#local-signature", signPersonal(randomWallet(), message));
    await click("#local-verify");
    await until("document.querySelector('[data-link-error=wrong-signer]')", "refusal");
    if ((await evaluate(dappCount)) !== 0) throw new Error("apps-visible-after-forgery");
  });
  await step("local_wallet", async () => {
    const message = await until("document.querySelector('#local-message')?.value", "message to sign");
    await type("#local-signature", signPersonal(wallet, message));
    await click("#local-verify");
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps with a local signature");
    const account = await evaluate("document.querySelector('[data-account]').dataset.account");
    if (account !== `did:pkh:eip155:1:${wallet.address}`) throw new Error("wrong-account");
    if (await evaluate("document.querySelector('dialog.kotoba-client-consent')?.open === true")) throw new Error("consent-for-local");
  });
  if (process.env.OTEHON_MANIMANI === "1") await checkManimani();
} catch {
  outcome = "fail";
}

const summary = Object.entries(results).map(([name, value]) => `${name}=${value}`).join(" ");
console.log(`OTEHON_LOGIN_E2E result=${outcome} ${summary}`);
process.exit(0);
