import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationFor, requestMuseChat } from "../src/muse-chat.js";
import { parseMuse, museArgs, chatHandler } from "../../muse-chat/bridge.mjs";
import { EventEmitter } from "node:events";

test("Muse always uses the fixed broker POST and forwards only conversation data", async () => {
  let call;
  const reply = await requestMuseChat({ invoke: async (...args) => { call = args; return { ok: true, json: async () => ({ text: "返答", provider: "Muse", model: "muse-spark-1.3" }) }; } }, [{ role: "user", content: "質問" }]);
  assert.equal(call[1].input, "https://127.0.0.1:8778/v1/chat/muse");
  assert.equal(call[1].init.method, "POST");
  assert.deepEqual(JSON.parse(call[1].init.body), { messages: [{ role: "user", content: "質問" }] });
  assert.equal(reply.text, "返答");
  await assert.rejects(requestMuseChat({ invoke: async () => { throw Error("denied"); } }, []), /denied/);
});
test("bounded recent history preserves user/assistant pairs and the final input", () => {
  const history = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "古い内容".repeat(1000) }));
  const payload = conversationFor(history, "次の質問");
  assert(payload.length <= 39);
  assert.equal(payload[0].role, "user");
  assert.equal(payload.at(-1).content, "次の質問");
  assert(payload.reduce((sum, m) => sum + m.content.length, 0) <= 32000);
});
test("Muse CLI parsing requires real meta completion and keeps tools disabled", () => {
  const lines = [{ payload_type: "run.model.configured", payload: { provider_id: "meta", model_id: "muse-spark-1.3" } },
    { payload_type: "run.terminal.completed", payload: { terminal: "completed", text: "実応答" } }];
  assert.equal(parseMuse(lines.map(JSON.stringify).join("\n")).text, "実応答");
  lines[0].payload.provider_id = "echo";
  assert.throws(() => parseMuse(lines.map(JSON.stringify).join("\n")), /incomplete/);
  for (const flag of ["--disable-shell", "--disable-write", "--disable-web-tools", "--no-session-log"]) assert(museArgs.includes(flag));
  assert(!museArgs.includes("--yolo"));
});
test("Muse host refuses undeclared origin/path/method without a model call", async () => {
  let calls = 0;
  const handler = chatHandler(async () => { calls++; });
  for (const [origin, method, url] of [["null", "POST", "/v1/chat/muse"], ["https://evil.invalid", "POST", "/v1/chat/muse"], ["null", "GET", "/v1/chat/muse"], ["null", "POST", "/v1/chat/muse?provider=other"]]) {
    const response = new EventEmitter();response.writeHead = status => assert([403, 404].includes(status));response.end = () => {};
    await handler({ headers: { origin }, method, url }, response);
  }
  assert.equal(calls, 0);
});

test("Muse receives a private regular prompt file, removed after success and failure", async () => {
  const { mkdtemp, mkdir, writeFile, readdir, rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const { runMuse } = await import("../../muse-chat/bridge.mjs");
  const base = path.resolve(".agent-output/muse-transport-tests");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "case-"));
  const bb = path.join(root, "fake-bb.cjs");
  const muse = path.join(root, "fake-muse.cjs");
  const workspace = path.join(root, "workspace");
  try {
    await writeFile(bb, '#!/usr/bin/env node\nlet s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.stringify({prompt:JSON.stringify(JSON.parse(s))})));\n', { mode: 0o700 });
    await writeFile(muse, `#!/usr/bin/env node
const fs=require('node:fs');const a=process.argv;const file=a[a.indexOf('--prompt-file')+1];
if(!fs.statSync(file).isFile()||(fs.statSync(file).mode&0o777)!==0o600)process.exit(2);
if(!fs.readFileSync(file,'utf8').includes('transport-check'))process.exit(3);
if(process.env.FAIL_MUSE==='1')process.exit(9);
console.log(JSON.stringify({payload_type:'run.model.configured',payload:{provider_id:'meta',model_id:'fixture'}}));
console.log(JSON.stringify({payload_type:'run.terminal.completed',payload:{terminal:'completed',text:'fixture response'}}));
`, { mode: 0o700 });
    const env = { ...process.env, BB_COMMAND: bb, MUSE_COMMAND: muse, MUSE_CHAT_WORKSPACE: workspace };
    const body = JSON.stringify({ messages: [{ role: "user", content: "transport-check" }] });
    assert.equal((await runMuse(body, undefined, env)).text, "fixture response");
    assert.deepEqual(await readdir(workspace), []);
    await assert.rejects(runMuse(body, undefined, { ...env, FAIL_MUSE: "1" }));
    assert.deepEqual(await readdir(workspace), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("Muse host accepts the named loopback preview origin", async () => {
  const { Readable } = await import("node:stream");
  const request = Readable.from([Buffer.from(JSON.stringify({ messages: [{ role: "user", content: "日本語" }] }))]);
  request.headers = { origin: "http://127.0.0.1:8901" };request.method = "POST";request.url = "/v1/chat/muse";
  const response = new EventEmitter();response.writeHead = status => assert.equal(status, 200);
  response.end = text => { assert.equal(JSON.parse(text).text, "fixture");response.writableEnded = true; };
  let calls = 0;
  await chatHandler(async body => { calls++;assert.equal(JSON.parse(body).messages[0].content, "日本語");return { text: "fixture" }; })(request, response);
  assert.equal(calls, 1);
});
