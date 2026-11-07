// relay.awai.network: carries sealed link answers between a phone and a device.
// It speaks the two routes of ntfy that awai.link.v1 uses, so Otehon and its test relay stay
// interchangeable. Only ciphertext passes through, under a random topic, and it expires with the
// link request. Nothing is logged, and it stores nothing else.

const TOPIC = /^\/([0-9a-f]{32})(\/json)?$/;
const MAX_BODY = 4096;
const MAX_MESSAGES = 8;
const TTL_MS = 10 * 60 * 1000;
const KEEPALIVE_MS = 30 * 1000;

const CORS = {
  // Any origin may use it: a request carries no credentials, and an answer opens only for the device.
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const reply = (status, body = null, headers = {}) => new Response(body, { status, headers: { ...CORS, ...headers } });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return reply(204);
    const match = TOPIC.exec(new URL(request.url).pathname);
    if (!match) return reply(404);
    const stream = Boolean(match[2]);
    if (stream ? request.method !== "GET" : request.method !== "POST") return reply(405);
    return env.TOPIC.get(env.TOPIC.idFromName(match[1])).fetch(request);
  },
};

const line = (event) => new TextEncoder().encode(`${JSON.stringify(event)}\n`);

export class Topic {
  constructor(state) {
    this.state = state;
    this.listeners = new Set();
  }

  async fetch(request) {
    return request.method === "POST" ? this.publish(request) : this.subscribe();
  }

  async publish(request) {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY) return reply(413);
    const message = await request.text();
    if (message.length === 0) return reply(400);
    if (new TextEncoder().encode(message).length > MAX_BODY) return reply(413);
    const messages = (await this.state.storage.get("messages")) ?? [];
    if (messages.length >= MAX_MESSAGES) return reply(429);
    messages.push(message);
    await this.state.storage.put("messages", messages);
    await this.state.storage.setAlarm(Date.now() + TTL_MS);
    for (const listener of this.listeners) listener({ event: "message", message });
    return reply(200, JSON.stringify({ event: "message" }), { "content-type": "application/json" });
  }

  async subscribe() {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const send = (event) => writer.write(line(event)).catch(close);
    const keepalive = setInterval(() => send({ event: "keepalive" }), KEEPALIVE_MS);
    const limit = setTimeout(() => close(), TTL_MS);
    const close = () => {
      clearInterval(keepalive);
      clearTimeout(limit);
      this.listeners.delete(send);
      writer.close().catch(() => {});
    };
    this.listeners.add(send);
    send({ event: "open" });
    for (const message of (await this.state.storage.get("messages")) ?? []) send({ event: "message", message });
    return reply(200, readable, { "content-type": "application/x-ndjson; charset=utf-8" });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}
