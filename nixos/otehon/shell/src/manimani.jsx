// Manimani, the resident bot under New chat. The service in manimani/manimani.nix runs it on this
// device. Nothing goes through the shared broker, because nothing leaves the machine.
import { useCallback, useEffect, useRef, useState } from "react";

export const MANIMANI = "manimani";
export const MANIMANI_ORIGIN = "http://127.0.0.1:8771";
const POLL_MS = 2000;

const post = (path, body = {}) =>
  fetch(`${MANIMANI_ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export function useManimani() {
  const [state, setState] = useState(null);
  const read = useCallback(
    () =>
      fetch(`${MANIMANI_ORIGIN}/v1/state`)
        .then((response) => response.json())
        .then(setState)
        .catch(() => setState(null)),
    [],
  );
  useEffect(() => {
    read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, [read]);
  return [state, read];
}

function statusOf(state) {
  if (!state) return "stopped";
  return state.paused ? "paused" : state.status;
}

export const STATUS_TEXT = {
  stopped: "The Manimani service is not running.",
  paused: "Paused. Scheduled work and tools are stopped.",
  ready: "Running on this device.",
  "model-unavailable": "The local model is not available. Nothing is sent elsewhere.",
};

export function ManimaniLink({ active, onSelect }) {
  const [state] = useManimani();
  return (
    <button
      type="button"
      className={active ? "new-chat manimani-link active" : "new-chat manimani-link"}
      aria-current={active ? "page" : undefined}
      data-manimani-link
      onClick={onSelect}
    >
      <span className="dot" data-status={statusOf(state)} aria-hidden="true" />
      Manimani
    </button>
  );
}

export function Manimani() {
  const [state, read] = useManimani();
  const [text, setText] = useState("");
  const bottom = useRef(null);
  const count = state?.messages.length ?? 0;

  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [count]);

  const act = (promise) => promise.then(read).catch(read);
  const send = (event) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    act(post("/v1/messages", { text: value }));
  };

  return (
    <div className="manimani" data-manimani>
      <main className="manimani-chat">
        <div className="manimani-messages" aria-live="polite">
          {count === 0 ? <p>Manimani keeps running on this device, and coordinates your other agents.</p> : null}
          {(state?.messages ?? []).map((message) => (
            <div key={`${message.at}-${message.role}`} className="manimani-message" data-role={message.role}>
              {message.text}
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form className="manimani-composer" onSubmit={send}>
          <input
            aria-label="Message Manimani"
            placeholder="Message Manimani"
            value={text}
            disabled={!state}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" disabled={!state || !text.trim()}>
            Send
          </button>
        </form>
      </main>
      <aside className="manimani-side" aria-label="What Manimani is doing">
        <section>
          <h2>Status</h2>
          <p data-manimani-status={statusOf(state)}>{STATUS_TEXT[statusOf(state)]}</p>
          {state ? (
            <div className="manimani-actions">
              <button type="button" onClick={() => act(post("/v1/pause", { paused: !state.paused }))}>
                {state.paused ? "Resume" : "Pause"}
              </button>
            </div>
          ) : null}
        </section>
        {state?.approvals.length ? (
          <section>
            <h2>Needs your approval</h2>
            <ul>
              {state.approvals.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>: {item.prompt}
                  <div className="manimani-actions">
                    <button type="button" onClick={() => act(post(`/v1/approvals/${item.id}`, { approve: true }))}>
                      Approve
                    </button>
                    <button type="button" onClick={() => act(post(`/v1/approvals/${item.id}`, { approve: false }))}>
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section>
          <h2>Agents</h2>
          {state?.agents.length ? (
            <ul>
              {state.agents.map((agent) => (
                <li key={agent.id}>
                  {agent.name}: {agent.approval === "auto" ? "runs on its own" : "asks you first"}
                </li>
              ))}
            </ul>
          ) : (
            <p>None connected yet.</p>
          )}
        </section>
        <section>
          <h2>Scheduled</h2>
          {state?.tasks.length ? (
            <ul>
              {state.tasks.map((task) => (
                <li key={task.id}>
                  {task.title}, every {task["every-minutes"]} min{" "}
                  <button type="button" onClick={() => act(post(`/v1/tasks/${task.id}/delete`))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nothing scheduled.</p>
          )}
        </section>
        <section>
          <h2>Remembered</h2>
          {state?.memory.length ? (
            <>
              <ul>
                {state.memory.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
              <div className="manimani-actions">
                <button type="button" onClick={() => act(post("/v1/memory/clear"))}>
                  Forget all
                </button>
              </div>
            </>
          ) : (
            <p>Nothing yet.</p>
          )}
        </section>
        <section>
          <h2>Activity</h2>
          <ul>
            {(state?.activity ?? [])
              .slice(-12)
              .reverse()
              .map((item) => (
                <li key={`${item.at}-${item.kind}`}>
                  {new Date(item.at).toLocaleTimeString()} {item.kind}
                  {item.detail ? `: ${item.detail}` : ""}
                </li>
              ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
