export async function requestMuseChat(broker, messages, signal) {
  const response = await broker.invoke(
    { capability: "awai-muse-chat", service: "muse-conversation-host", operation: "send-message" },
    { input: "https://127.0.0.1:8778/v1/chat/muse", init: { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ messages }) } },
    signal ? { signal } : {},
  );
  if (!response.ok) throw Error("muse-chat-unavailable");
  const reply = await response.json();
  if (typeof reply.text !== "string" || !reply.text.trim() || reply.provider !== "Muse" || typeof reply.model !== "string") throw Error("invalid-muse-reply");
  return { text: reply.text, provider: reply.provider, model: reply.model, usage: reply.usage ?? null };
}

export function conversationFor(messages, text) {
  const current = { role: "user", content: text.trim() };
  if (!current.content || current.content.length > 8000) throw Error("invalid-message");
  let history = messages.slice(-38).map(({ role, content }) => ({ role, content: content.slice(0, 8000) }));
  while (history.reduce((sum, m) => sum + m.content.length, current.content.length) > 32000) history = history.slice(2);
  return [...history, current];
}
