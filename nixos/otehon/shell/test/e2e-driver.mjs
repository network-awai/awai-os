// Drives the real shell in Chromium through DevTools, with trusted input, against a
// real relay on loopback. A wallet and a passkey are simulated with random keys.
// Built only for the desktop-login check image.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect as rawConnect } from "node:net";
import { p256 } from "@noble/curves/nist.js";
import { p256Did, parseLinkFragment, sealResponse } from "../src/identity/link.js";
import { passkeyResponse, randomWallet, signPersonal, walletFromSecret, walletResponse } from "./signers.js";

const RELAY = process.env.RELAY_ORIGIN;
const EXPECTED_DAPPS = Number(process.env.EXPECTED_DAPPS);
const IDLE_MS = Number(process.env.IDLE_LOCK_MS ?? 300000);
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

// Data protection (docs/otehon/protection-0.1.0.md), over two boots of one disk. The canaries
// are joined at run time, so the image itself never holds them and a disk search finds only
// what was written.
const STATE = "/var/lib/otehon";
const PROTECT = `${STATE}/protect-check`;
const canary = (kind) => ["OTEHON", kind, "CANARY"].join("_");
const sh = (command) => execSync(command, { shell: "/bin/sh" }).toString().trim();
const fact = (line) => console.log(`OTEHON_PROTECT_FACT ${line}`);
const lockScreen = "document.querySelector('[data-lock-screen]')";
const nothingShown = `document.querySelectorAll('.dapp, .messages, .thread, [data-account]').length === 0`;

// Trusted input, which resets the idle timer like a person would.
const nudge = () => send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4 + Math.random(), y: 4 });

async function signLocked(signer) {
  const message = await until("document.querySelector('#unlock-message')?.value", "unlock message");
  await type("#unlock-signature", signPersonal(signer, message));
  await click("#unlock-verify");
}

async function lockedWithoutApps(text) {
  await until(lockScreen, "lock screen");
  await until(nothingShown, "no app, thread or account rendered");
  await until("document.title.includes('locked=1 gate=1 dapps=0')", "title says locked");
  if (await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)) throw new Error("canary-on-lock-screen");
}

async function protectFirstBoot(text) {
  const owner = randomWallet();
  // A test key, kept on the encrypted volume for the second boot only.
  writeFileSync(`${PROTECT}/test-wallet.key`, Buffer.from(owner.secret).toString("hex"), { mode: 0o600 });
  await step("signin", async () => {
    await until("document.querySelector('[data-step=hello]')", "first step");
    for (const name of ["language", "network", "signin"]) {
      await click("[data-next]");
      await until(`document.querySelector('[data-step=${name}]')`, `${name} step`);
    }
    await click("#local-start");
    await type("#local-address", owner.address);
    const message = await until("document.querySelector('#local-message')?.value", "message to sign");
    await type("#local-signature", signPersonal(owner, message));
    await click("#local-verify");
    await until("document.querySelector('[data-step=trust]')", "trust step");
    await click("[data-next]");
    await click("[data-finish]");
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps");
  });
  await step("canary_in_profile", async () => {
    await type(".composer textarea", text);
    await click(".composer button[type=submit]");
    await until(`document.querySelector('.messages')?.innerText.includes(${JSON.stringify(text)})`, "message shown");
    // Chromium writes localStorage to disk a little later. Look for it in the profile files.
    const profile = `${STATE}/users/otehon/chromium`;
    const end = Date.now() + 120000;
    let files = "";
    while (!files && Date.now() < end) {
      files = sh(`grep -rlaF ${JSON.stringify(text)} ${profile} || true`);
      if (!files) {
        await nudge();
        await sleep(2000);
      }
    }
    if (!files) throw new Error("canary-not-in-profile");
    fact(`profile_files=${files.split("\n").length} first=${files.split("\n")[0]}`);
    const source = sh(`findmnt -n -o SOURCE --target ${profile}`);
    fact(`profile_source=${source}`);
    if (!source.includes("otehon-state")) throw new Error(`profile-not-on-volume ${source}`);
  });
  await step("log_canary", async () => {
    sh(`logger -t otehon-protect ${canary("LOG")}_${text.slice(-12)}`);
    sh("journalctl --sync");
    const journal = sh("findmnt -n -o SOURCE --target /var/log/journal");
    const files = sh("ls /var/log/journal/*/system.journal 2>/dev/null | wc -l");
    fact(`journal_source=${journal} persistent_files=${files}`);
    if (!journal.includes("otehon-state") || files === "0") throw new Error("journal-not-on-volume");
    if (!sh(`journalctl -t otehon-protect -o cat | grep -c ${canary("LOG")} || true`).startsWith("1")) {
      throw new Error("log-canary-not-logged");
    }
    // The positive control for the disk search: the same kind of string on the plain root partition.
    writeFileSync("/var/lib/otehon-plain-canary", `${canary("PLAIN")}\n`);
    sh("sync");
  });
  let lastInput;
  await step("idle_not_yet", async () => {
    await nudge();
    lastInput = Date.now();
    await sleep(Math.min(10000, IDLE_MS / 4));
    if (await evaluate(lockScreen)) throw new Error("locked-too-early");
    if ((await evaluate(dappCount)) !== EXPECTED_DAPPS) throw new Error("apps-gone-early");
  });
  await step("idle_lock", async () => {
    await until(lockScreen, "idle lock", IDLE_MS + 15000);
    const after = Date.now() - lastInput;
    fact(`idle_lock_after_ms=${after} idle_ms=${IDLE_MS}`);
    if (after < IDLE_MS - 1000) throw new Error(`locked-before-idle ${after}`);
    await lockedWithoutApps(text);
  });
  await step("reload_stays_locked", async () => {
    await send("Page.reload");
    await sleep(1500);
    await lockedWithoutApps(text);
  });
  await step("forged_unlock", async () => {
    await signLocked(randomWallet());
    await until("document.querySelector('[data-unlock-error=wrong-signer]')", "refusal");
    await lockedWithoutApps(text);
  });
  await step("unlock", async () => {
    await signLocked(owner);
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps after unlock");
    await until(`document.querySelector('.messages')?.innerText.includes(${JSON.stringify(text)})`, "thread after unlock");
  });
  await step("lock_button", async () => {
    await click("[data-lock-now]");
    await lockedWithoutApps(text);
    await signLocked(owner);
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps after the second unlock");
  });
}

async function protectSecondBoot(text) {
  const owner = walletFromSecret(Buffer.from(readFileSync(`${PROTECT}/test-wallet.key`, "utf8"), "hex"));
  // The first boot ended unlocked, so this lock comes from the new browser alone.
  await step("starts_locked", async () => {
    await lockedWithoutApps(text);
  });
  await step("survives_reboot", async () => {
    await signLocked(owner);
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps after reboot");
    await until(`document.querySelector('.messages')?.innerText.includes(${JSON.stringify(text)})`, "thread after reboot");
  });
}

async function protectCheck() {
  let outcome = "pass";
  let stage = "none";
  try {
    if (sh(`mountpoint -q ${STATE} && echo 1 || echo 0`) !== "1") throw new Error("state-volume-closed");
    mkdirSync(PROTECT, { recursive: true, mode: 0o700 });
    stage = existsSync(`${PROTECT}/stage`) ? readFileSync(`${PROTECT}/stage`, "utf8").trim() : "0";
    if (stage === "0") {
      const text = `${canary("SHELL")}_${Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex")}`;
      writeFileSync(`${PROTECT}/canary`, text, { mode: 0o600 });
      await protectFirstBoot(text);
    } else if (/^[1-9]$/.test(stage)) {
      await protectSecondBoot(readFileSync(`${PROTECT}/canary`, "utf8"));
    } else {
      throw new Error(`stage-${stage}`);
    }
  } catch (error) {
    outcome = "fail";
    fact(`error=${JSON.stringify(error.message)}`);
  }
  const summary = Object.entries(results).map(([name, value]) => `${name}=${value}`).join(" ");
  console.log(`OTEHON_PROTECT stage=${stage} result=${outcome} ${summary}`);
  if (outcome === "pass" && stage === "0") {
    writeFileSync(`${PROTECT}/stage`, "1");
    sh("sync");
    sh("systemctl reboot --no-block");
  } else {
    if (outcome === "pass") writeFileSync(`${PROTECT}/stage`, String(Number(stage) + 1));
    sh("sync");
    sh("systemctl poweroff --no-block");
  }
  process.exit(0);
}

if (process.env.OTEHON_PROTECT === "1") await protectCheck();

// Daily features (docs/otehon/daily-0.1.0.md), over two boots of one disk: the time zone set from
// the Settei screen through the real helper, polkit and timedated, and still set after a reboot.
const DAILY = `${STATE}/daily-check`;
const dailyFact = (line) => console.log(`OTEHON_DAILY_FACT ${line}`);
const zoneNow = () => sh("timedatectl show --property=Timezone --value");
const SETTEI = "http://127.0.0.1:8774/v1/timezone";

// A request from the page itself, so it comes from Chromium as the desktop user.
const pagePost = (zone) =>
  evaluate(`fetch(${JSON.stringify(SETTEI)}, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ zone: ${JSON.stringify(zone)} }) }).then(async (r) => r.status + ' ' + (await r.text()))`);

// The same request from another local user, with no browser in between.
const otherUserPost = (user, zone) =>
  sh(
    `setpriv --reuid=${user} --regid=nogroup --clear-groups curl -s -o - -w ' %{http_code}' -H 'content-type: application/json' ` +
      `--data '{"zone":"${zone}"}' ${SETTEI} || true`,
  );

async function chooseZone(zone) {
  await evaluate(`(() => { const s = document.querySelector('#settei-zone');
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(zone)});
    s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click("#settei-apply");
}

async function dailyFirstBoot(owner) {
  await step("signin", async () => {
    await until("document.querySelector('[data-step=hello]')", "first step");
    await click("[data-next]");
    await until("document.querySelector('[data-step=language]')", "language step");
    await click("[data-language=ja]");
    await until("document.documentElement.lang === 'ja'", "japanese");
    for (const name of ["network", "signin"]) {
      await click("[data-next]");
      await until(`document.querySelector('[data-step=${name}]')`, `${name} step`);
    }
    await click("#local-start");
    await type("#local-address", owner.address);
    const message = await until("document.querySelector('#local-message')?.value", "message to sign");
    await type("#local-signature", signPersonal(owner, message));
    await click("#local-verify");
    await until("document.querySelector('[data-step=trust]')", "trust step");
    await click("[data-next]");
    await click("[data-finish]");
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps");
  });
  await step("zone_starts_utc", async () => {
    const zone = zoneNow();
    dailyFact(`zone_before=${zone} localtime=${sh("readlink /etc/localtime || echo none")}`);
    if (zone !== "UTC") throw new Error(`zone-before ${zone}`);
  });
  await step("settei_sets_zone", async () => {
    await click("[data-dapp=settei]");
    await until("document.querySelector('[data-settei-zone=UTC]')", "settei shows UTC");
    await chooseZone("Asia/Tokyo");
    await until("document.querySelector('[data-settei-applied=\"Asia/Tokyo\"]')", "applied", 40000);
    const zone = zoneNow();
    const link = sh("readlink /etc/localtime || echo none");
    dailyFact(`zone_after=${zone} localtime=${link}`);
    if (zone !== "Asia/Tokyo" || !link.endsWith("Asia/Tokyo")) throw new Error(`zone-after ${zone} ${link}`);
    const audit = sh("journalctl -u otehon-settei -o cat --no-pager | grep -c 'action=set-timezone uid=.* after=\"Asia/Tokyo\" result=\"ok\"' || true");
    dailyFact(`audit_ok_lines=${audit}`);
    if (audit === "0") throw new Error("no-audit-line");
    // Chromium watches /etc/localtime. Report what it shows; the second boot requires it.
    await sleep(3000);
    dailyFact(`browser_zone_same_boot=${await evaluate("Intl.DateTimeFormat().resolvedOptions().timeZone")}`);
  });
  await step("invalid_zone_refused", async () => {
    for (const zone of ["Mars/Olympus", "../../etc/passwd", "Asia/Tokyo;reboot"]) {
      const answer = await pagePost(zone);
      dailyFact(`invalid ${JSON.stringify(zone)} -> ${answer}`);
      if (!answer.startsWith("400 ") || !answer.includes("unknown-zone")) throw new Error(`accepted ${zone}`);
    }
    if (zoneNow() !== "Asia/Tokyo") throw new Error("zone-changed-by-invalid-request");
  });
  await step("other_user_refused", async () => {
    for (const user of ["nobody", "root"]) {
      const answer = otherUserPost(user, "Europe/Berlin");
      dailyFact(`other_user ${user} -> ${answer}`);
      if (!answer.includes("not-desktop-user") || !answer.endsWith(" 403")) throw new Error(`accepted from ${user}`);
    }
    if (zoneNow() !== "Asia/Tokyo") throw new Error("zone-changed-by-another-user");
  });
  await step("helper_user_is_narrow", async () => {
    // polkit gives the helper's user the time zone and nothing else.
    const time = sh("setpriv --reuid=otehon-settei --regid=otehon-settei --clear-groups timedatectl set-ntp false 2>&1; echo \" exit=$?\"");
    const host = sh("setpriv --reuid=otehon-settei --regid=otehon-settei --clear-groups hostnamectl set-hostname otehon-x 2>&1; echo \" exit=$?\"");
    dailyFact(`helper_set_ntp=${JSON.stringify(time)} helper_hostname=${JSON.stringify(host)}`);
    if (time.endsWith(" exit=0") || host.endsWith(" exit=0")) throw new Error("helper-user-can-do-more");
  });
  await step("web_window", async () => {
    await click("[data-dapp=browser]");
    await click("#web-open");
    await until("document.querySelector('[data-web-state=opened]')", "opened");
    let line = "";
    for (let attempt = 0; attempt < 30 && !line; attempt += 1) {
      line = sh("pgrep -a -u otehon -f 'user-data-dir=/var/lib/otehon/users/otehon/web/chromium' | head -n 1 || true");
      if (!line) await sleep(1000);
    }
    dailyFact(`web_process=${JSON.stringify(line.slice(0, 300))}`);
    if (!line) throw new Error("no-web-browser-process");
    if (line.includes("remote-debugging")) throw new Error("web-browser-has-devtools");
    const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
    if (targets.some((target) => target.type === "page" && !target.url.startsWith("file:"))) throw new Error("web-page-on-shell-devtools");
    // The check script takes a screenshot now, for a person to see the address bar.
    console.log("OTEHON_DAILY_SCREENSHOT web");
    await sleep(8000);
  });
}

async function dailySecondBoot(owner) {
  await step("starts_locked", async () => {
    await until("document.querySelector('[data-lock-screen]')", "lock screen");
    const message = await until("document.querySelector('#unlock-message')?.value", "unlock message");
    await type("#unlock-signature", signPersonal(owner, message));
    await click("#unlock-verify");
    await until(`${dappCount} === ${EXPECTED_DAPPS}`, "apps");
  });
  await step("zone_survives_reboot", async () => {
    const zone = zoneNow();
    const browser = await evaluate("Intl.DateTimeFormat().resolvedOptions().timeZone");
    const lang = await evaluate("document.documentElement.lang");
    dailyFact(`zone_after_reboot=${zone} browser_zone=${browser} lang=${lang} clock=${JSON.stringify(await evaluate("document.querySelector('[data-clock]')?.textContent"))} date=${JSON.stringify(sh("date"))}`);
    if (zone !== "Asia/Tokyo" || browser !== "Asia/Tokyo") throw new Error(`zone ${zone} browser ${browser}`);
    if (lang !== "ja") throw new Error(`language ${lang}`);
    await click("[data-dapp=settei]");
    await until("document.querySelector('[data-settei-zone=\"Asia/Tokyo\"]')", "settei shows Tokyo");
  });
}

async function dailyCheck() {
  let outcome = "pass";
  let stage = "none";
  try {
    if (sh(`mountpoint -q ${STATE} && echo 1 || echo 0`) !== "1") throw new Error("state-volume-closed");
    mkdirSync(DAILY, { recursive: true, mode: 0o700 });
    stage = existsSync(`${DAILY}/stage`) ? readFileSync(`${DAILY}/stage`, "utf8").trim() : "0";
    if (stage === "0") {
      const owner = randomWallet();
      // A test key, on the encrypted volume, for the second boot only.
      writeFileSync(`${DAILY}/test-wallet.key`, Buffer.from(owner.secret).toString("hex"), { mode: 0o600 });
      await dailyFirstBoot(owner);
    } else if (stage === "1") {
      await dailySecondBoot(walletFromSecret(Buffer.from(readFileSync(`${DAILY}/test-wallet.key`, "utf8"), "hex")));
    } else {
      throw new Error(`stage-${stage}`);
    }
  } catch (error) {
    outcome = "fail";
    dailyFact(`error=${JSON.stringify(error.message)}`);
  }
  const summary = Object.entries(results).map(([name, value]) => `${name}=${value}`).join(" ");
  console.log(`OTEHON_DAILY stage=${stage} result=${outcome} ${summary}`);
  if (outcome === "pass") writeFileSync(`${DAILY}/stage`, String(Number(stage) + 1));
  sh("sync");
  sh(outcome === "pass" && stage === "0" ? "systemctl reboot --no-block" : "systemctl poweroff --no-block");
  process.exit(0);
}

if (process.env.OTEHON_DAILY === "1") await dailyCheck();

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
