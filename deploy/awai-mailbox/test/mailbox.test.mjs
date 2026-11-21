// Runs the mailbox Worker in Node with an in-memory Durable Object. usage: node --test test/mailbox.test.mjs
// MAILBOX_WORKER names another worker file, for the negative controls in the README.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workerPath = resolve(process.env.MAILBOX_WORKER ?? new URL("../worker.js", import.meta.url).pathname);
const { default: worker, Topic } = await import(pathToFileURL(workerPath).href);

// The intervals and timeouts of open streams would keep Node running; nothing here needs them to fire.
mock.timers.enable({ apis: ["setInterval", "setTimeout"] });

let now = 1_800_000_000_000;
Date.now = () => now;

class Storage {
  constructor() { this.data = new Map(); this.alarm = null; }
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { this.data.set(key, structuredClone(value)); }
  async deleteAll() { this.data.clear(); this.alarm = null; }
  async setAlarm(at) { this.alarm = at; }
}

function mailbox() {
  const objects = new Map();
  const object = (name) => {
    if (!objects.has(name)) {
      const storage = new Storage();
      objects.set(name, { storage, topic: new Topic({ storage }) });
    }
    return objects.get(name);
  };
  const env = { TOPIC: { idFromName: (name) => name, get: (id) => ({ fetch: (r) => object(id).topic.fetch(r) }) } };
  const call = (method, path, body, headers = {}) =>
    worker.fetch(new Request(`https://mailbox.awai.network${path}`, { method, body, headers }), env);
  return { call, object };
}

const topic = () => randomBytes(16).toString("hex");
const sealed = (size = 96) => randomBytes(size).toString("base64url");

async function events(response, count) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const seen = [];
  let buffer = "";
  while (seen.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    seen.push(...lines.map((text) => JSON.parse(text)));
  }
  await reader.cancel();
  return seen;
}

test("a stored message reaches a later subscriber", async () => {
  const { call } = mailbox();
  const t = topic();
  const body = sealed();
  assert.equal((await call("POST", `/${t}`, body)).status, 200);
  const response = await call("GET", `/${t}/json`);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.deepEqual(await events(response, 2), [{ event: "open" }, { event: "message", message: body }]);
});

test("a message published after subscribing reaches the open stream", async () => {
  const { call } = mailbox();
  const t = topic();
  const response = await call("GET", `/${t}/json`);
  const body = sealed();
  await call("POST", `/${t}`, body);
  assert.deepEqual(await events(response, 2), [{ event: "open" }, { event: "message", message: body }]);
});

test("topics are apart", async () => {
  const { call } = mailbox();
  const [a, b] = [topic(), topic()];
  await call("POST", `/${a}`, sealed());
  const got = await events(await call("GET", `/${b}/json`), 1);
  assert.deepEqual(got, [{ event: "open" }]);
});

test("only a 32-hex topic and the two routes exist", async () => {
  const { call } = mailbox();
  const t = topic();
  for (const path of ["/", `/${t.slice(1)}`, `/${t}0`, `/${t.toUpperCase()}`, `/${t}/json/x`, `/${t}/raw`, `/x/${t}`]) {
    assert.equal((await call("POST", path, sealed())).status, 404, path);
  }
  assert.equal((await call("GET", `/${t}`)).status, 405);
  assert.equal((await call("POST", `/${t}/json`, sealed())).status, 405);
  assert.equal((await call("PUT", `/${t}`, sealed())).status, 405);
  assert.equal((await call("OPTIONS", `/${t}`)).status, 405);
});

test("no CORS header is sent", async () => {
  const { call } = mailbox();
  const response = await call("POST", `/${topic()}`, sealed());
  for (const name of response.headers.keys()) assert.ok(!name.startsWith("access-control-"), name);
});

test("only base64url ciphertext is stored: a plaintext prompt is refused", async () => {
  const { call, object } = mailbox();
  const t = topic();
  const prompt = JSON.stringify({ kind: "awai.compute-order/1", prompt: "Summarise the week. ".repeat(4) });
  assert.equal((await call("POST", `/${t}`, prompt)).status, 400);
  assert.equal((await call("POST", `/${t}`, `${sealed()}=`)).status, 400);
  assert.equal((await call("POST", `/${t}`, sealed(32))).status, 400, "shorter than an HPKE key and tag");
  assert.equal((await call("POST", `/${t}`, "")).status, 400);
  assert.equal(object(t).storage.data.size, 0);
});

test("the store holds the ciphertext and its expiry, and nothing else", async () => {
  const { call, object } = mailbox();
  const t = topic();
  const body = sealed();
  await call("POST", `/${t}`, body, { "x-forwarded-for": "203.0.113.7", "user-agent": "buyer-bot" });
  const { storage } = object(t);
  assert.deepEqual([...storage.data.keys()], ["messages"]);
  assert.deepEqual(storage.data.get("messages"), [{ message: body, expires: now + 3600_000 }]);
  assert.ok(!JSON.stringify([...storage.data]).includes("203.0.113.7"));
});

test("a body over 64 KiB is refused, declared or not", async () => {
  const { call } = mailbox();
  const t = topic();
  const big = "A".repeat(64 * 1024 + 1);
  assert.equal((await call("POST", `/${t}`, big)).status, 413);
  assert.equal((await call("POST", `/${t}`, sealed(), { "content-length": String(64 * 1024 + 1) })).status, 413);
  assert.equal((await call("POST", `/${t}`, "A".repeat(64 * 1024))).status, 200);
});

test("a topic holds at most 16 live messages", async () => {
  const { call } = mailbox();
  const t = topic();
  for (let i = 0; i < 16; i += 1) assert.equal((await call("POST", `/${t}`, sealed())).status, 200);
  assert.equal((await call("POST", `/${t}`, sealed())).status, 429);
});

test("the sender's expiry is kept, clamped to one hour, and must be in the future", async () => {
  const { call, object } = mailbox();
  const t = topic();
  const seconds = (ms) => String(Math.floor(ms / 1000));
  assert.equal((await call("POST", `/${t}`, sealed(), { "x-expires": seconds(now + 600_000) })).status, 200);
  assert.equal((await call("POST", `/${t}`, sealed(), { "x-expires": seconds(now + 86_400_000) })).status, 200);
  for (const bad of [seconds(now), seconds(now - 1000), "soon", "1.5", "-1", ""]) {
    assert.equal((await call("POST", `/${t}`, sealed(), { "x-expires": bad })).status, 400, bad);
  }
  const stored = object(t).storage.data.get("messages").map((m) => m.expires);
  assert.deepEqual(stored, [now + 600_000, now + 3600_000]);
  assert.equal(object(t).storage.alarm, now + 600_000);
});

test("an expired message is not delivered, does not count, and the alarm removes it", async () => {
  const { call, object } = mailbox();
  const t = topic();
  const start = now;
  const early = sealed();
  const late = sealed();
  await call("POST", `/${t}`, early, { "x-expires": String(Math.floor((start + 60_000) / 1000)) });
  await call("POST", `/${t}`, late);
  now = start + 120_000;
  try {
    assert.deepEqual(await events(await call("GET", `/${t}/json`), 2), [{ event: "open" }, { event: "message", message: late }]);
    const { storage, topic: box } = object(t);
    await box.alarm();
    assert.deepEqual(storage.data.get("messages").map((m) => m.message), [late]);
    assert.equal(storage.alarm, start + 3600_000);
    now = start + 3600_001;
    await box.alarm();
    assert.equal(storage.data.size, 0);
    for (let i = 0; i < 16; i += 1) assert.equal((await call("POST", `/${t}`, sealed())).status, 200);
  } finally {
    now = start;
  }
});
