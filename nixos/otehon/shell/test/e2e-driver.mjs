// Drives the real shell in Chromium through DevTools, with trusted input, against a
// real relay on loopback. A wallet and a passkey are simulated with random keys.
// Built only for the desktop-login check image.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { connect as rawConnect } from "node:net";
import { p256 } from "@noble/curves/nist.js";
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

// Report a browser that never came up, rather than leave the host waiting for a result.
const socket = await connect().catch((error) => {
  console.log(`OTEHON_LOGIN_E2E result=fail browser=0 ${error.message}`);
  process.exit(0);
});
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

const MEDIA = "http://127.0.0.1:8770";
const RESULTS = "/var/lib/otehon-results";

function saveResult(name, data) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(`${RESULTS}/${name}`, data);
}

async function screenshot(name) {
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  saveResult(`${name}.png`, Buffer.from(result.data, "base64"));
}

async function refused(path, init, status, reason) {
  const response = await fetch(`${MEDIA}${path}`, init);
  const body = await response.json();
  if (response.status !== status || body.error !== reason) {
    throw new Error(`expected ${status} ${reason} on ${path}, got ${response.status} ${body.error}`);
  }
}

// fetch normalizes "../" and will not send another Host, so these use a plain socket.
function rawGet(path, host = "127.0.0.1:8770") {
  return new Promise((resolve, reject) => {
    let text = "";
    const client = rawConnect(8770, "127.0.0.1", () =>
      client.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`),
    );
    client.on("data", (data) => (text += data.toString("latin1")));
    client.on("end", () => resolve(text));
    client.on("error", reject);
  });
}

async function rawRefused(path, host, status, reason) {
  const text = await rawGet(path, host);
  if (!text.startsWith(`HTTP/1.1 ${status} `) || !text.includes(`"${reason}"`) || text.includes("root:")) {
    throw new Error(`expected ${status} ${reason} on ${path}, got ${text.slice(0, 80)}`);
  }
}

const post = (body, origin) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
  body: JSON.stringify(body),
});

async function sendFromComposer(text, kind) {
  await type(".composer textarea", text);
  await click(`[data-generate=${kind}]`);
}

// A silent or empty file must not pass. Piper writes a 44-byte header and 16-bit samples.
function checkSpeech(wav, label) {
  if (wav.subarray(0, 4).toString() !== "RIFF" || wav.subarray(8, 12).toString() !== "WAVE") throw new Error("not-wav");
  const samples = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length - (wav.length % 2)));
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (samples.length < 4000 || peak < 500) throw new Error(`silent samples=${samples.length} peak=${peak}`);
  console.log(`OTEHON_MEDIA speech ${label} samples=${samples.length} peak=${peak}`);
}

// llvmpipe never opens the render node, so an open one means the job is on the GPU.
function jobHoldsRenderNode() {
  const scan = `for d in /proc/[0-9]*; do case "$(cat $d/comm 2>/dev/null)" in *sd-cli*) ls -l $d/fd 2>/dev/null ;; esac; done | grep -c renderD128 || true`;
  return Number(execSync(scan, { shell: "/bin/sh" }).toString().trim()) > 0;
}

async function imageFile(url, name) {
  const png = Buffer.from(await (await fetch(`${MEDIA}${url}`)).arrayBuffer());
  if (png.subarray(1, 4).toString() !== "PNG") throw new Error("not-png");
  saveResult(name, png);
  return png.length;
}

async function mediaSteps() {
  const wantImage = process.env.OTEHON_MEDIA_IMAGE === "1";
  await step("media_refusals", async () => {
    await refused("/v1/audio/speech", post({ input: "", voice: "en" }), 400, "empty-text");
    await refused("/v1/audio/speech", post({ input: "   ", voice: "en" }), 400, "empty-text");
    await refused("/v1/audio/speech", post({ input: "x".repeat(2001), voice: "en" }), 413, "text-too-long");
    await refused("/v1/audio/speech", post({ input: "hello", voice: "../../etc" }), 400, "unknown-voice");
    await refused("/v1/audio/speech", post({ input: "hello", voice: "de" }), 400, "unknown-voice");
    await refused("/v1/audio/speech", post({ input: "こんにちは", voice: "ja" }), 400, "unknown-voice");
    await refused("/v1/audio/speech", post({ input: "hello", voice: "en" }, "https://evil.example"), 403, "bad-origin");
    await rawRefused("/v1/capabilities", "evil.example", 403, "bad-host");
    await rawRefused("/files/../../etc/passwd", undefined, 404, "not-found");
    await rawRefused("/files/..%2f..%2fetc%2fpasswd", undefined, 404, "not-found");
    await rawRefused(`/files/${"0".repeat(32)}.wav`, undefined, 404, "not-found");
    await rawRefused("/v1/jobs/nope", undefined, 404, "unknown-job");
    if (wantImage) {
      await refused("/v1/images/generations", post({ prompt: "" }), 400, "empty-text");
      await refused("/v1/images/generations", post({ prompt: "cat", size: 9999 }), 400, "bad-size");
      await refused("/v1/images/generations", post({ prompt: "cat", size: 384 }), 400, "bad-size");
      await refused("/v1/images/generations", post({ prompt: "cat", steps: 9999 }), 400, "bad-steps");
      await refused("/v1/images/generations", post({ prompt: "cat", steps: 0 }), 400, "bad-steps");
      await refused("/v1/images/generations", post({ prompt: "cat", seed: -1 }), 400, "bad-seed");
      await refused("/v1/images/generations", post({ prompt: "cat", size: 256 }, "https://evil.example"), 403, "bad-origin");
    } else {
      // No model share: a good request is refused because the model is missing.
      await refused("/v1/images/generations", post({ prompt: "cat" }), 503, "image-model-missing");
    }
  });
  // The origin "null" is what the shell's file:// page sends: the service must accept it.
  for (const [voice, input] of [["en", "Hello from Itonami."]]) {
    await step(`speech_${voice}`, async () => {
      const made = await fetch(`${MEDIA}/v1/audio/speech`, post({ input, voice }, "null"));
      const body = await made.json();
      if (!made.ok) throw new Error(`speech ${made.status} ${body.error}`);
      const wav = Buffer.from(await (await fetch(`${MEDIA}${body.url}`)).arrayBuffer());
      checkSpeech(wav, `voice=${voice} seconds=${body.seconds}`);
      saveResult(`speech-${voice}.wav`, wav);
    });
  }
  await step("speech_in_shell", async () => {
    await click("[data-dapp=itonami]");
    await sendFromComposer("Hello from the Itonami shell.", "speech");
    await until("document.querySelector('[data-media=speech][data-state=done] audio')", "audio player", 120000);
    await until("document.querySelector('[data-media=speech] audio').duration > 0", "audio loads", 30000);
    const src = await evaluate("document.querySelector('[data-media=speech] audio').getAttribute('src')");
    checkSpeech(Buffer.from(await (await fetch(src)).arrayBuffer()), "voice=shell");
    await screenshot("shell-speech");
  });
  await step("speech_no_japanese_voice", async () => {
    await sendFromComposer("こんにちは", "speech");
    await until("document.querySelector('[data-media=speech][data-state=failed] .problem')?.textContent.includes('no voice for this language')", "refusal", 30000);
  });
  if (!wantImage) {
    await step("image_button_off", async () => {
      await type(".composer textarea", "A red torii gate");
      await until("document.querySelector('[data-generate=image]').disabled === true", "image button off");
      await until("document.querySelector('[data-generate=speech]').disabled === false", "speech button on");
    });
    return;
  }
  await step("image_in_shell", async () => {
    await until("!document.querySelector('[data-generate=image]').title", "image model available", 30000);
    await sendFromComposer("A red torii gate on a green hill, simple illustration", "image");
    await until("document.querySelector('[data-media=image]')", "image job");
    const end = Date.now() + 60 * 60 * 1000;
    let renderNode = false;
    for (;;) {
      renderNode ||= jobHoldsRenderNode();
      const state = await evaluate("document.querySelector('[data-media=image]').dataset.state");
      if (state === "done") break;
      if (state === "failed") throw new Error(await evaluate("document.querySelector('[data-media=image] .problem').textContent"));
      if (Date.now() > end) throw new Error("image-timeout");
      await sleep(2000);
    }
    await until("document.querySelector('[data-media=image] img')?.naturalWidth > 0", "image decodes", 30000);
    const size = await evaluate("document.querySelector('[data-media=image] img').naturalWidth");
    const took = await evaluate("document.querySelector('[data-media=image] .muted')?.textContent");
    const src = await evaluate("document.querySelector('[data-media=image] img').getAttribute('src')");
    const bytes = await imageFile(src.replace(MEDIA, ""), "image-shell-256.png");
    console.log(`OTEHON_MEDIA image shell width=${size} bytes=${bytes} render_node=${renderNode ? 1 : 0} ${took}`);
    if (!renderNode) throw new Error("image-not-on-gpu");
    await evaluate("document.querySelector('[data-media=image]').scrollIntoView()");
    await sleep(500);
    await screenshot("shell-image");
  });
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
  await step("net_setup", async () => {
    for (const unit of ["otehon-net", "NetworkManager", "polkit"]) {
      const active = execSync(`systemctl is-active ${unit}`).toString().trim();
      console.log(`OTEHON_NET_UNIT ${unit}=${active}`);
      if (active !== "active") {
        for (const line of execSync(`journalctl -u ${unit} --no-pager -n 10 -o cat`).toString().split("\n")) {
          if (line.trim()) console.log(`OTEHON_NET_JOURNAL ${unit} ${line.trim().slice(0, 200)}`);
        }
        throw new Error(`${unit} ${active}`);
      }
    }
    // bluetooth.service carries ConditionPathIsDirectory=/sys/class/bluetooth, so it stays
    // inactive without an adapter. Loaded proves BlueZ ships; ActiveState tells the rest.
    const bt = execSync("systemctl show bluetooth -p LoadState,ActiveState --value").toString().trim().split("\n");
    console.log(`OTEHON_NET_BT load=${bt[0]} active=${bt[1]}`);
    if (bt[0] !== "loaded") throw new Error(`bluetooth ${bt[0]}`);
    // nmcli lives in the otehon-net service, not in this driver: prove liveness on the bus instead.
    const bus = execSync("busctl --timeout=8 --no-pager --list").toString();
    console.log(`OTEHON_NET_BUS names=${bus.trim().split("\n").length}`);
    if (!bus.includes("org.freedesktop.NetworkManager")) throw new Error("nm-not-on-bus");
    if (!bus.includes("org.bluez")) console.log("OTEHON_NET_BUS no-bluez (no adapter, expected)");
    for (const unit of ["polkit", "dbus"]) {
      try {
        console.log(`OTEHON_NET_UNIT ${unit}=${execSync(`systemctl is-active ${unit}`).toString().trim()}`);
      } catch (error) {
        console.log(`OTEHON_NET_UNIT ${unit} FAIL rc=${error.status}`);
      }
    }
    const state = await (await fetch("http://127.0.0.1:8773/v1/status")).json();
    if (state.link !== "down" || state.wifi.available !== false || state.bluetooth.available !== false) {
      throw new Error(`net-unexpected ${JSON.stringify(state)}`);
    }
    const noWifi = await fetch("http://127.0.0.1:8773/v1/wifi/networks");
    if (noWifi.status !== 503 || (await noWifi.json()).error !== "no-adapter") throw new Error("wifi-no-adapter");
    const noBt = await fetch("http://127.0.0.1:8773/v1/bluetooth/devices");
    if (noBt.status !== 503 || (await noBt.json()).error !== "no-adapter") throw new Error("bt-no-adapter");
    const badJoin = await (
      await fetch("http://127.0.0.1:8773/v1/wifi/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ssid: "" }),
      })
    ).json();
    if (badJoin.error !== "bad-ssid") throw new Error("ssid-validation");
    const badPair = await (
      await fetch("http://127.0.0.1:8773/v1/bluetooth/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mac: "nope" }),
      })
    ).json();
    if (badPair.error !== "bad-mac") throw new Error("mac-validation");
    const badHost = await new Promise((resolve, reject) => {
      let text = "";
      const client = rawConnect(8773, "127.0.0.1", () =>
        client.write("GET /v1/status HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n"),
      );
      client.on("data", (data) => (text += data.toString("latin1")));
      client.on("end", () => resolve(text));
      client.on("error", reject);
    });
    if (!badHost.startsWith("HTTP/1.1 403 ") || !badHost.includes('"bad-host"')) {
      throw new Error(`net-bad-host ${badHost.slice(0, 60)}`);
    }
    await click("[data-dapp=wifi]");
    await until("document.querySelector('[data-net=wifi]')", "wifi screen");
    await until(
      "document.querySelector('[data-net=wifi]').textContent.includes('no Wi-Fi adapter')",
      "wifi empty state",
    );
    await click("[data-dapp=bluetooth]");
    await until("document.querySelector('[data-net=bluetooth]')", "bluetooth screen");
    await until(
      "document.querySelector('[data-net=bluetooth]').textContent.includes('no Bluetooth adapter')",
      "bluetooth empty state",
    );
  });
  await step("sound_setup", async () => {
    const active = execSync("systemctl is-active otehon-sound").toString().trim();
    console.log(`OTEHON_SOUND_UNIT otehon-sound=${active}`);
    if (active !== "active") {
      for (const line of execSync("journalctl -u otehon-sound --no-pager -n 10 -o cat").toString().split("\n")) {
        if (line.trim()) console.log(`OTEHON_SOUND_JOURNAL ${line.trim().slice(0, 200)}`);
      }
      throw new Error(`otehon-sound ${active}`);
    }
    // The check VM has no output device: the service stays honest about that.
    const state = await (await fetch("http://127.0.0.1:8775/v1/status")).json();
    if (state.available !== false || state.volume !== null || state.muted !== null) {
      throw new Error(`sound-unexpected ${JSON.stringify(state)}`);
    }
    const badVolume = await (
      await fetch("http://127.0.0.1:8775/v1/volume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ volume: 101 }),
      })
    ).json();
    if (badVolume.error !== "bad-volume") throw new Error("volume-validation");
    const noSink = await (
      await fetch("http://127.0.0.1:8775/v1/volume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ volume: 50 }),
      })
    ).json();
    if (noSink.error !== "no-adapter") throw new Error("volume-no-adapter");
    const badMute = await (
      await fetch("http://127.0.0.1:8775/v1/mute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: "yes" }),
      })
    ).json();
    if (badMute.error !== "bad-mute") throw new Error("mute-validation");
    const badHost = await new Promise((resolve, reject) => {
      let text = "";
      const client = rawConnect(8775, "127.0.0.1", () =>
        client.write("GET /v1/status HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n"),
      );
      client.on("data", (data) => (text += data.toString("latin1")));
      client.on("end", () => resolve(text));
      client.on("error", reject);
    });
    if (!badHost.startsWith("HTTP/1.1 403 ") || !badHost.includes('"bad-host"')) {
      throw new Error(`sound-bad-host ${badHost.slice(0, 60)}`);
    }
    await click("[data-dapp=sound]");
    await until("document.querySelector('[data-net=sound]')", "sound screen");
    await until(
      "document.querySelector('[data-net=sound]').textContent.includes('no sound output')",
      "sound empty state",
    );
  });
  await step("status_docks", async () => {
    // The check image has no curl: the driver itself runs in the VM, so use fetch.
    // Port 8774: 8772 already serves the Manimani LLM in this image.
    const active = execSync("systemctl is-active otehon-status").toString().trim();
    if (active !== "active") throw new Error(`otehon-status ${active}`);
    const system = await (await fetch("http://127.0.0.1:8774/v1/system")).json();
    if (!Number.isFinite(system.cpu_percent) || !Number.isFinite(system.mem_total_kb)) {
      throw new Error("status-without-readings");
    }
    const dockBadHost = await new Promise((resolve, reject) => {
      let text = "";
      const client = rawConnect(8774, "127.0.0.1", () =>
        client.write("GET /v1/system HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n"),
      );
      client.on("data", (data) => (text += data.toString("latin1")));
      client.on("end", () => resolve(text));
      client.on("error", reject);
    });
    if (!dockBadHost.startsWith("HTTP/1.1 403 ") || !dockBadHost.includes('"bad-host"')) {
      throw new Error(`status-bad-host ${dockBadHost.slice(0, 60)}`);
    }
    const missing = await fetch("http://127.0.0.1:8774/nope");
    if (missing.status !== 404) throw new Error(`status-unknown-path ${missing.status}`);
    const endState = execSync("systemctl is-active otehon-status").toString().trim();
    console.log(`OTEHON_STATUS_END active=${endState}`);
    if (endState !== "active") {
      for (const line of execSync("journalctl -u otehon-status --no-pager -n 20 -o cat").toString().split("\n")) {
        if (line.trim()) console.log(`OTEHON_STATUS_JOURNAL ${line.trim().slice(0, 200)}`);
      }
      throw new Error(`otehon-status ${endState} at end`);
    }
    await until("document.querySelector('[data-dock-left]')", "device dock");
    await until("document.querySelector('[data-dock-right]')", "node dock");
    const wallet = await until(
      "document.querySelector('[data-dock-toggle=wallet]')?.textContent",
      "wallet button",
    );
    if (!wallet.includes("Trust 10")) throw new Error("wallet without trust");
    await click("[data-dock-toggle=hosts]");
    await until("document.querySelector('[data-dock-panel=hosts]')", "hosts panel");
    const device = await until("document.querySelector('[data-dock-device]')?.dataset.dockDevice", "this device");
    if (!device.startsWith("did:key:")) throw new Error("device without did");
    await click("[data-dock-toggle=ports]");
    await until('document.querySelector("[data-dock-panel=ports] [data-dock-port=\'8770\']")', "ports panel");
    await click("[data-dock-toggle=ports]");
  });
  await step("ime_setup", async () => {
    // Installation-level only: the check VM has no user session, so no
    // daemon runs here. Conversion itself needs real key input.
    // fcitx5 refuses to start without HOME, which this driver does not have.
    const version = execSync("HOME=/tmp fcitx5 --version").toString().trim().split("\n")[0];
    console.log(`OTEHON_IME_VERSION ${version}`);
    if (!/^\d+\.\d+/.test(version)) throw new Error("fcitx5-missing");
    const profile = execSync("cat /etc/xdg/fcitx5/profile").toString();
    if (!profile.includes("Name=mozc")) throw new Error("mozc-not-in-group");
    if (!profile.includes("DefaultIM=keyboard-us")) throw new Error("ime-default-changed");
    execSync("test -f /etc/systemd/user/fcitx5-daemon.service");
    console.log("OTEHON_IME_UNIT fcitx5-daemon=defined");
    // The driver PATH carries bare fcitx5 as a probe tool; the desktop
    // session runs the wrapped build. Assert on the system binary.
    const sysBin = execSync("readlink -f /run/current-system/sw/bin/fcitx5").toString().trim();
    console.log(`OTEHON_IME_SYSBIN ${sysBin}`);
    if (!sysBin.includes("with-addons")) throw new Error("fcitx5-not-wrapped");
    const addonDir = sysBin.replace(/\/bin\/fcitx5$/, "/share/fcitx5/addon");
    const addons = execSync(`ls ${addonDir} 2>/dev/null || echo MISSING-DIR`).toString();
    console.log(`OTEHON_IME_ADDONS ${addons.trim().split("\n").slice(0, 20).join(",")}`);
    if (!addons.includes("mozc.conf")) throw new Error("mozc-addon-missing");
  });
  if (process.env.OTEHON_MEDIA === "1") await mediaSteps();
  if (process.env.OTEHON_MANIMANI === "1") await checkManimani();
} catch {
  outcome = "fail";
}

if (process.env.OTEHON_MEDIA === "1") {
  const facts = `journalctl -u otehon-media --no-pager -o cat | grep 'image job' || true
    systemctl show otehon-media -p IPAddressDeny -p IPAddressAllow -p User -p DynamicUser
    grep -i ':2242 00000000:0000 ' /proc/net/tcp | cut -c1-40 || true`;
  try {
    for (const line of execSync(facts, { shell: "/bin/sh" }).toString().split("\n")) {
      if (line) console.log(`OTEHON_MEDIA fact ${line}`);
    }
  } catch (error) {
    console.log(`OTEHON_MEDIA fact-error ${error.message}`);
  }
}

const summary = Object.entries(results).map(([name, value]) => `${name}=${value}`).join(" ");
console.log(`OTEHON_LOGIN_E2E result=${outcome} ${summary}`);
process.exit(0);
