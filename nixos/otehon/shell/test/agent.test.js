import assert from "node:assert/strict";
import test from "node:test";
import { chatBody, contextMessage, conversation, readAnswer } from "../src/agent.js";

const stream = (...chunks) =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });

const delta = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`;
const finish = (reason) => `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;

test("an answer split across chunks is put back together", async () => {
  const whole = delta("Hel") + delta("lo") + finish("stop") + "data: [DONE]\n\n";
  const seen = [];
  const answer = await readAnswer(stream(whole.slice(0, 10), whole.slice(10)), (text) => seen.push(text));
  assert.equal(answer, "Hello");
  assert.deepEqual(seen, ["Hel", "Hello"]);
});

test("tool progress events are not part of the answer", async () => {
  const progress = 'event: hermes.tool.progress\ndata: {"tool":"x","choices":[{"delta":{"content":"no"}}]}\n\n';
  assert.equal(await readAnswer(stream(progress + delta("yes") + finish("stop")), () => {}), "yes");
});

test("a failed turn, an empty answer and a cut stream all reject", async () => {
  await assert.rejects(readAnswer(stream(delta("part") + finish("error")), () => {}), /stopped early \(error\): part/);
  await assert.rejects(readAnswer(stream(finish("stop")), () => {}), /no text/);
  await assert.rejects(readAnswer(stream(delta("part")), () => {}), /before it finished/);
});

test("the request carries the app as a system message, and only real turns as history", () => {
  const items = ["first", { kind: "agent", state: "done", text: "reply" }, { kind: "agent", state: "failed", reason: "x" }, { kind: "speech", state: "done", text: "said" }];
  assert.deepEqual(conversation(items), [
    { role: "user", content: "first" },
    { role: "assistant", content: "reply" },
  ]);
  const body = chatBody({ title: "Saifu", summary: "A wallet" }, items, "next");
  assert.equal(body.stream, true);
  assert.match(body.messages[0].content, /"Saifu".*A wallet/);
  assert.equal(body.messages[0].role, "system");
  assert.deepEqual(body.messages.at(-1), { role: "user", content: "next" });
  assert.match(contextMessage(null), /no app selected/);
});
