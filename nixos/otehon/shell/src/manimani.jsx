// Manimani, the resident bot under New chat. The service in manimani/manimani.nix runs it on this
// device. Nothing goes through the shared broker, because nothing leaves the machine.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage, useText } from "./i18n.js";

export const MANIMANI = "manimani";
export const MANIMANI_ORIGIN = "http://127.0.0.1:8771";
const POLL_MS = 2000;

const post = (path, body = {}) =>
  fetch(`${MANIMANI_ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function useManimani() {
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

const STATUS_TEXT = {
  stopped: "manimani.stopped",
  paused: "manimani.paused",
  ready: "manimani.ready",
  "model-unavailable": "manimani.modelUnavailable",
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
  const t = useText();
  const { language } = useLanguage();
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
          {count === 0 ? <p>{t("manimani.intro")}</p> : null}
          {(state?.messages ?? []).map((message) => (
            <div key={`${message.at}-${message.role}`} className="manimani-message" data-role={message.role}>
              {message.text}
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form className="manimani-composer" aria-label={t("manimani.message")} onSubmit={send}>
          <input
            aria-label={t("manimani.message")}
            placeholder={t("manimani.message")}
            value={text}
            disabled={!state}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" disabled={!state || !text.trim()}>
            {t("manimani.send")}
          </button>
        </form>
      </main>
      <aside className="manimani-side" aria-label={t("manimani.side")}>
        <section>
          <h2>{t("manimani.status")}</h2>
          <p data-manimani-status={statusOf(state)} role="status">
            {STATUS_TEXT[statusOf(state)] ? t(STATUS_TEXT[statusOf(state)]) : statusOf(state)}
          </p>
          {state ? (
            <div className="manimani-actions">
              <button type="button" onClick={() => act(post("/v1/pause", { paused: !state.paused }))}>
                {state.paused ? t("manimani.resume") : t("manimani.pause")}
              </button>
            </div>
          ) : null}
        </section>
        {state?.approvals.length ? (
          <section>
            <h2>{t("manimani.approvals")}</h2>
            <ul>
              {state.approvals.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>: {item.prompt}
                  <div className="manimani-actions">
                    <button type="button" onClick={() => act(post(`/v1/approvals/${item.id}`, { approve: true }))}>
                      {t("manimani.approve")}
                    </button>
                    <button type="button" onClick={() => act(post(`/v1/approvals/${item.id}`, { approve: false }))}>
                      {t("manimani.decline")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section>
          <h2>{t("manimani.agents")}</h2>
          {state?.agents.length ? (
            <ul>
              {state.agents.map((agent) => (
                <li key={agent.id}>
                  {agent.name}: {agent.approval === "auto" ? t("manimani.auto") : t("manimani.asks")}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("manimani.noAgents")}</p>
          )}
        </section>
        <section>
          <h2>{t("manimani.scheduled")}</h2>
          {state?.tasks.length ? (
            <ul>
              {state.tasks.map((task) => (
                <li key={task.id}>
                  {t("manimani.every", { title: task.title, minutes: task["every-minutes"] })}{" "}
                  <button type="button" onClick={() => act(post(`/v1/tasks/${task.id}/delete`))}>
                    {t("manimani.remove")}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("manimani.nothingScheduled")}</p>
          )}
        </section>
        <section>
          <h2>{t("manimani.remembered")}</h2>
          {state?.memory.length ? (
            <>
              <ul>
                {state.memory.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
              <div className="manimani-actions">
                <button type="button" onClick={() => act(post("/v1/memory/clear"))}>
                  {t("manimani.forget")}
                </button>
              </div>
            </>
          ) : (
            <p>{t("manimani.nothingYet")}</p>
          )}
        </section>
        <section>
          <h2>{t("manimani.activity")}</h2>
          <ul>
            {(state?.activity ?? [])
              .slice(-12)
              .reverse()
              .map((item) => (
                <li key={`${item.at}-${item.kind}`}>
                  {new Date(item.at).toLocaleTimeString(language)} {item.kind}
                  {item.detail ? `: ${item.detail}` : ""}
                </li>
              ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
