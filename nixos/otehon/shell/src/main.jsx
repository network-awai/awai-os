import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import catalog from "./dapps.json";
import "./main.css";

const POLL_MS = 3000;
const SECTIONS = ["Core", "Apps", "System"];
const HOME = "home";
const THREADS_KEY = "otehon.threads.v1";

// Both services listen on loopback only (desktop.nix). Nothing here leaves the VM.
async function zenohUp() {
  const response = await fetch("http://127.0.0.1:8000/@/*/router");
  if (!response.ok) return false;
  const body = await response.json();
  return Array.isArray(body) && body.length > 0;
}

function matterUp() {
  return new Promise((resolve) => {
    const socket = new WebSocket("ws://127.0.0.1:5580/ws");
    const finish = (up) => {
      socket.close();
      resolve(up);
    };
    socket.onmessage = (event) => {
      finish(typeof JSON.parse(event.data).sdk_version === "string");
    };
    socket.onerror = () => finish(false);
  });
}

function useService(check) {
  const [up, setUp] = useState(false);
  useEffect(() => {
    let live = true;
    const run = () =>
      check()
        .catch(() => false)
        .then((next) => live && setUp(next));
    run();
    const timer = setInterval(run, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [check]);
  return up;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function loadThreads() {
  try {
    const saved = JSON.parse(localStorage.getItem(THREADS_KEY));
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

// Each context keeps its own thread on this device.
function useThreads() {
  const [threads, setThreads] = useState(loadThreads);
  useEffect(() => {
    try {
      localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
    } catch {
      // The thread still works for this session.
    }
  }, [threads]);
  const add = (context, text) =>
    setThreads((current) => ({
      ...current,
      [context]: [...(current[context] ?? []), text],
    }));
  return [threads, add];
}

function Service({ name, up }) {
  return (
    <li className={up ? "service up" : "service down"}>
      <span>{name}</span>
      <span>{up ? "Running" : "Not reachable"}</span>
    </li>
  );
}

function Sidebar({ context, onSelect, threads, now, zenoh, matter }) {
  return (
    <nav className="sidebar" aria-label="Contexts">
      <div className="brand">Itonami</div>
      <button
        type="button"
        className={context === HOME ? "new-chat active" : "new-chat"}
        aria-current={context === HOME ? "page" : undefined}
        onClick={() => onSelect(HOME)}
      >
        New chat
      </button>
      <div className="contexts">
        {SECTIONS.map((section) => (
          <section key={section}>
            <h2>{section}</h2>
            <ul>
              {catalog.dapps
                .filter((dapp) => dapp.section === section)
                .map((dapp) => (
                  <li key={dapp.id}>
                    <button
                      type="button"
                      className={context === dapp.id ? "dapp active" : "dapp"}
                      aria-current={context === dapp.id ? "page" : undefined}
                      onClick={() => onSelect(dapp.id)}
                    >
                      <span className="mark" aria-hidden="true">
                        {dapp.title[0]}
                      </span>
                      <span className="title">{dapp.title}</span>
                      {threads[dapp.id]?.length ? (
                        <span className="count">{threads[dapp.id].length}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      <footer>
        <ul className="services">
          <Service name="Zenoh" up={zenoh} />
          <Service name="Matter" up={matter} />
        </ul>
        <time>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
      </footer>
    </nav>
  );
}

function Composer({ placeholder, onSend, context }) {
  const [text, setText] = useState("");
  const input = useRef(null);
  useEffect(() => {
    setText("");
    input.current?.focus();
  }, [context]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        ref={input}
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
      />
      <button type="submit" disabled={!text.trim()}>
        Send
      </button>
    </form>
  );
}

function Chat({ dapp, context, messages, onSend }) {
  const end = useRef(null);
  useEffect(() => {
    end.current?.scrollIntoView();
  }, [messages.length, context]);

  return (
    <main className="chat">
      <div className="thread">
        {messages.length === 0 ? (
          <div className="empty">
            <h1>{dapp ? dapp.title : "What should we work on?"}</h1>
            {dapp ? <p>{dapp.summary}</p> : <p>Pick an app in the sidebar to work in its context.</p>}
          </div>
        ) : (
          <ol className="messages">
            {messages.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ol>
        )}
        <div ref={end} />
      </div>
      <div className="dock">
        <Composer
          context={context}
          onSend={onSend}
          placeholder={dapp ? `Message ${dapp.title}` : "Message Itonami"}
        />
        <p className="notice">
          No agent is connected in this image, so nothing answers yet. Messages stay on this device.
        </p>
      </div>
    </main>
  );
}

function DappPanel({ dapp }) {
  return (
    <aside className="panel" aria-label={`${dapp.title} dapp`}>
      <div className="panel-head">
        <h2>{dapp.title}</h2>
        <span className="tag">Not connected</span>
      </div>
      <p>{dapp.summary}</p>
      <dl>
        <dt>Install</dt>
        <dd>{dapp.install === "os-image" ? "Included in the OS image" : dapp.install}</dd>
        <dt>Offline</dt>
        <dd>{dapp.offline === "local-core" ? "The local core works offline" : dapp.offline}</dd>
      </dl>
      <h3>Network operations</h3>
      {dapp.remoteOperations.length === 0 ? (
        <p>None. This app does not use the network.</p>
      ) : (
        <ul className="operations">
          {dapp.remoteOperations.map((operation) => (
            <li key={operation.operation}>
              <span className="title">{operation.operation}</span>
              <span>{operation.service}</span>
              <span>{operation.consent === "each-operation" ? "Asks each time" : operation.consent}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Shell() {
  const now = useNow();
  const zenoh = useService(zenohUp);
  const matter = useService(matterUp);
  const [context, setContext] = useState(HOME);
  const [threads, addMessage] = useThreads();
  const dapp = catalog.dapps.find((item) => item.id === context);

  // The boot report reads this title, so the check proves that React rendered.
  useEffect(() => {
    const dapps = document.querySelectorAll(".dapp").length;
    document.title = `Awai Otehon zenoh=${zenoh ? 1 : 0} matter=${matter ? 1 : 0} dapps=${dapps}`;
  }, [zenoh, matter]);

  return (
    <div className={dapp ? "shell with-panel" : "shell"}>
      <Sidebar
        context={context}
        onSelect={setContext}
        threads={threads}
        now={now}
        zenoh={zenoh}
        matter={matter}
      />
      <Chat
        dapp={dapp}
        context={context}
        messages={threads[context] ?? []}
        onSend={(text) => addMessage(context, text)}
      />
      {dapp ? <DappPanel dapp={dapp} /> : null}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Shell />);
