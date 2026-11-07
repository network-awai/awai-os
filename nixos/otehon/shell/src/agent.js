// The conversation with Hermes on this device (hermes.nix). Like media.js it does not use the
// shared broker, because nothing leaves the machine. The key comes from a file that the OS makes
// at boot; an image with no agent has no such file, so messages only stay on this device.

export const AGENT_ORIGIN = "http://127.0.0.1:8642";
export const MODEL_ORIGIN = "http://127.0.0.1:8773";

export const agentKey = () => globalThis.__OTEHON_AGENT_KEY ?? "";
export const hasAgent = () => agentKey() !== "";

export function contextMessage(dapp) {
  if (!dapp) return "You are the agent of this Awai Otehon device. The person is on the home screen, with no app selected.";
  return `You are the agent of this Awai Otehon device. The person is working in the app "${dapp.title}". About this app: ${dapp.summary}`;
}

// Threads hold the person's words as strings. Speech, images and failed answers are not part of
// the conversation.
export function conversation(items) {
  const messages = [];
  for (const item of items) {
    if (typeof item === "string") messages.push({ role: "user", content: item });
    else if (item?.kind === "agent" && item.state === "done") messages.push({ role: "assistant", content: item.text });
  }
  return messages;
}

export function chatBody(dapp, items, text) {
  return {
    model: "hermes-agent",
    stream: true,
    messages: [{ role: "system", content: contextMessage(dapp) }, ...conversation(items), { role: "user", content: text }],
  };
}

// Reads one chat completion stream. The promise rejects on a finish that is not a success:
// Hermes reports a failed turn as finish_reason "error" with whatever text it has.
export async function readAnswer(stream, onText) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  let event = "";
  let finish = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line === "") event = "";
      if (!line.startsWith("data:") || event) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      const choice = JSON.parse(data).choices?.[0];
      if (choice?.delta?.content) {
        text += choice.delta.content;
        onText(text);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  }
  if (finish === null) throw new Error("the answer stopped before it finished");
  if (finish !== "stop") throw new Error(text ? `the agent stopped early (${finish}): ${text}` : `the agent stopped early (${finish})`);
  if (!text.trim()) throw new Error("the agent returned no text");
  return text;
}

function explain(error, status) {
  if (status === 401) return "the agent refused the key";
  if (status === 403) return "the agent refused this page's origin";
  if (status) return `the agent answered with status ${status}`;
  return error instanceof TypeError ? "the agent cannot be reached" : error.message;
}

export async function askAgent({ dapp, context, items, text, add, update }) {
  const id = crypto.randomUUID();
  add(context, { id, kind: "agent", state: "working", text: "" });
  let status = 0;
  try {
    const response = await fetch(`${AGENT_ORIGIN}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${agentKey()}` },
      body: JSON.stringify(chatBody(dapp, items, text)),
    });
    if (!response.ok) {
      status = response.status;
      throw new Error("refused");
    }
    const answer = await readAnswer(response.body, (partial) => update(context, id, { text: partial }));
    update(context, id, { state: "done", text: answer });
  } catch (error) {
    update(context, id, { state: "failed", reason: explain(error, status) });
  }
}
