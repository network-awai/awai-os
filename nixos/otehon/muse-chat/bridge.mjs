import { createServer } from "node:https";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { allowedOrigins } from "../profiles/bridge.mjs";

const source = fileURLToPath(new URL("src/", import.meta.url));
export const museArgs = ["exec", "--provider", "meta", "--preset", "empty", "--reasoning-effort", "low", "--max-model-steps", "1",
  "--disable-write", "--disable-shell", "--disable-web-tools", "--disable-reminders", "--disable-request-user-input",
  "--no-foreign-personal-context", "--no-session-log", "--json"];
function execute(command, args, input, env, signal, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { env, signal, cwd, timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export function parseMuse(stdout) {
  const events = stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
  const configured = events.find(e => e.payload_type === "run.model.configured")?.payload;
  const final = events.findLast(e => e.payload_type === "run.terminal.completed")?.payload;
  if (!configured || configured.provider_id !== "meta" || final?.terminal !== "completed"
      || typeof final.text !== "string" || !final.text.trim()) throw Error("muse-incomplete");
  const usage = events.findLast(e => e.payload_type === "run.usage")?.payload;
  return { text: final.text, provider: "Muse", model: configured.model_id,
    usage: usage ? { runId: usage.run_stream?.id, models: usage.models, calls: usage.calls, completed_calls: usage.completed_calls,
      failed_calls: usage.failed_calls, cancelled_calls: usage.cancelled_calls } : null };
}
export async function runMuse(body, signal, env = process.env) {
  const normalized = await execute(env.BB_COMMAND || "bb", ["-cp", source, "-m", "muse-chat.core"], body, env, signal)
    .catch(() => { throw Error("invalid-conversation"); });
  const { prompt } = JSON.parse(normalized);
  const workspace = env.MUSE_CHAT_WORKSPACE || fileURLToPath(new URL("../../../.agent-output/muse-chat-workspace/", import.meta.url));
  await mkdir(workspace, { recursive: true });
  const requestDir = await mkdtemp(`${workspace}/request-`);
  const promptPath = `${requestDir}/prompt.txt`;
  try {
    await writeFile(promptPath, prompt, { mode: 0o600 });
    return parseMuse(await execute(env.MUSE_COMMAND || "muse", [...museArgs, "--workspace", workspace, "--prompt-file", promptPath], "", { ...env, MUSE_NO_AUTO_UPDATE: "1" }, signal, workspace));
  } finally { await rm(requestDir, { recursive: true, force: true }); }
}
export function chatHandler(run = runMuse) {
  let busy = false;
  return async (request, response) => {
    const origin = request.headers.origin;
    const headers = { "content-type": "application/json", "cache-control": "no-store", "vary": "Origin", "x-content-type-options": "nosniff" };
    const reply = (status, body) => { response.writeHead(status, headers); response.end(JSON.stringify(body)); };
    if (origin === "null" || !allowedOrigins.has(origin)) { reply(403, { error: "origin-denied" }); return; }
    headers["access-control-allow-origin"] = origin;
    // Simple POST (text/plain) needs no preflight or alternative browser operation.
    if (request.method !== "POST" || request.url !== "/v1/chat/muse") { reply(404, { error: "not-found" }); return; }
    if (busy) { reply(429, { error: "muse-busy" }); return; }
    busy = true;
    const controller = new AbortController();
    response.on("close", () => { if (!response.writableEnded) controller.abort(); });
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 262144) throw Error("invalid-conversation"); chunks.push(chunk); }
      const result = await run(Buffer.concat(chunks).toString("utf8"), controller.signal);
      reply(200, result);
    } catch (error) {
      if (!response.destroyed) reply(error.message === "invalid-conversation" ? 400 : 503, { error: error.message === "invalid-conversation" ? "invalid-conversation" : "muse-unavailable" });
    } finally { busy = false; }
  };
}
export async function startChat(env = process.env) {
  if (!env.MUSE_CHAT_CERT || !env.MUSE_CHAT_KEY) throw Error("muse-chat-tls-required");
  const [cert, key] = await Promise.all([readFile(env.MUSE_CHAT_CERT), readFile(env.MUSE_CHAT_KEY)]);
  const server = createServer({ cert, key }, chatHandler((body, signal) => runMuse(body, signal, env)));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(8778, "127.0.0.1", resolve); });
  console.log("Muse conversation host at https://127.0.0.1:8778 (tools disabled)");
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await startChat();
