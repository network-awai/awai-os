// mailbox.awai.network: carries sealed compute orders to an Android provider, and sealed results back
// to the buyer (ADR 0051 D2, AWAI-3766). The phone and the buyer only ever connect out to it.
//
// It speaks the two ntfy routes the link relay uses: POST /<topic> and GET /<topic>/json. A topic is
// 128 random bits as 32 lowercase hex digits. A body must be base64url text, the form the host gives
// an HPKE ciphertext; anything else, a JSON prompt for one, is refused before it is stored. A message
// lasts until the sender's `x-expires` (unix seconds), and never longer than one hour.
//
// It keeps the ciphertext and its expiry, and nothing else: no log, no account, no address, no
// header. It sends no CORS headers, because no browser page is a client of it.

const TOPIC = /^\/([0-9a-f]{32})(\/json)?$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_BODY = 64 * 1024;
// An HPKE X25519 encapsulated key (32 bytes) and a ChaCha20-Poly1305 tag (16 bytes), as base64url.
const MIN_BODY = 64;
const MAX_MESSAGES = 16;
const MAX_TTL_MS = 60 * 60 * 1000;
const STREAM_MS = 15 * 60 * 1000;
const KEEPALIVE_MS = 30 * 1000;

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

const reply = (status, body = null, headers = {}) => new Response(body, { status, headers: { ...HEADERS, ...headers } });

export default {
  async fetch(request, env) {
    const match = TOPIC.exec(new URL(request.url).pathname);
    if (!match) return reply(404);
    const stream = Boolean(match[2]);
    if (stream ? request.method !== "GET" : request.method !== "POST") return reply(405);
    return env.TOPIC.get(env.TOPIC.idFromName(match[1])).fetch(request);
  },
};

const line = (event) => new TextEncoder().encode(`${JSON.stringify(event)}\n`);

// The expiry of a new message in milliseconds, or null when the sender's header is not a whole
// number of seconds in the future.
export function expiryOf(header, now) {
  const latest = now + MAX_TTL_MS;
  if (header === null) return latest;
  if (!/^[0-9]{1,12}$/.test(header)) return null;
  const asked = Number(header) * 1000;
  if (asked <= now) return null;
  return Math.min(asked, latest);
}

const live = (messages, now) => messages.filter((m) => m.expires > now);

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
    const now = Date.now();
    const expires = expiryOf(request.headers.get("x-expires"), now);
    if (expires === null) return reply(400);
    const message = await request.text();
    if (message.length > MAX_BODY) return reply(413);
    if (message.length < MIN_BODY || !BASE64URL.test(message)) return reply(400);
    const messages = live((await this.state.storage.get("messages")) ?? [], now);
    if (messages.length >= MAX_MESSAGES) return reply(429);
    messages.push({ message, expires });
    await this.state.storage.put("messages", messages);
    await this.rearm(messages);
    for (const listener of this.listeners) listener({ event: "message", message });
    return reply(200, JSON.stringify({ event: "message" }), { "content-type": "application/json" });
  }

  async subscribe() {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const send = (event) => writer.write(line(event)).catch(close);
    const keepalive = setInterval(() => send({ event: "keepalive" }), KEEPALIVE_MS);
    const limit = setTimeout(() => close(), STREAM_MS);
    const close = () => {
      clearInterval(keepalive);
      clearTimeout(limit);
      this.listeners.delete(send);
      writer.close().catch(() => {});
    };
    this.listeners.add(send);
    send({ event: "open" });
    for (const { message } of live((await this.state.storage.get("messages")) ?? [], Date.now())) {
      send({ event: "message", message });
    }
    return reply(200, readable, { "content-type": "application/x-ndjson; charset=utf-8" });
  }

  // The alarm fires at the earliest expiry and keeps only the messages still alive.
  async rearm(messages) {
    if (messages.length === 0) return this.state.storage.deleteAll();
    return this.state.storage.setAlarm(Math.min(...messages.map((m) => m.expires)));
  }

  async alarm() {
    const messages = live((await this.state.storage.get("messages")) ?? [], Date.now());
    if (messages.length === 0) return this.state.storage.deleteAll();
    await this.state.storage.put("messages", messages);
    return this.rearm(messages);
  }
}
