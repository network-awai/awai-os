import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import catalog from "./dapps.json";
import { BUNDLED_APPS, installedApps, setAppInstalled } from "./apps.js";
import registry from "./registry/itonami-index.json";
import { REGISTRY_REVISION, searchRegistry } from "./discovery.js";
import { clearSession, deviceDid, loadProofs, loadSession, saveProof } from "./identity/device.js";
import { createBroker, osOperations, readPassport } from "./runtime.js";
import { QrCode, Setup } from "./setup.jsx";
import { Bunsho } from "./apps/bunsho.cljc";
import { Hyokeisan } from "./apps/hyokeisan.cljc";
import { Tsunagu } from "./apps/tsunagu.cljc";
import { tailscaleAdapters } from "./connect.js";
import { displayMessage, readAgeBand, saveAgeBand } from "./age.js";
import {
  POINTS,
  accountAddress,
  dappMinimum,
  operationMinimum,
  parsePassportResponse,
  passportCall,
  trustScore,
} from "./trust.js";
import "./main.css";

const POLL_MS = 3000;
const SECTIONS = ["Core", "Apps", "System"];
const HOME = "home";
const ACCOUNT = "account";
const MARKETPLACE = "marketplace";
const THREADS_KEY = "otehon.threads.v1";
const SETUP_KEY = "otehon.setup.v1";
const relayOrigin = RELAY_ORIGIN;

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

function setupFinished() {
  try {
    return localStorage.getItem(SETUP_KEY) === "done";
  } catch {
    return false;
  }
}

const shortDid = (did) => (did.length > 26 ? `${did.slice(0, 14)}…${did.slice(-8)}` : did);

function Service({ name, up }) {
  return (
    <li className={up ? "service up" : "service down"}>
      <span>{name}</span>
      <span>{up ? "Running" : "Not reachable"}</span>
    </li>
  );
}

function Sidebar({ context, onSelect, threads, now, zenoh, matter, account, score, installed }) {
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
                .filter((dapp) => dapp.section === section && (dapp.id !== "tokei" || installed.includes("tokei")))
                .map((dapp) => (
                  <li key={dapp.id}>
                    <button
                      type="button"
                      className={context === dapp.id ? "dapp active" : "dapp"}
                      data-dapp={dapp.id}
                      aria-current={context === dapp.id ? "page" : undefined}
                      onClick={() => onSelect(dapp.id === "itonami-apps" ? MARKETPLACE : dapp.id)}
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
      <button type="button" className={context === MARKETPLACE ? "new-chat active" : "new-chat"}
        data-marketplace onClick={() => onSelect(MARKETPLACE)}>Apps / Marketplace</button>
      <button
        type="button"
        className={context === ACCOUNT ? "account-button active" : "account-button"}
        data-account={account.accountDid}
        onClick={() => onSelect(ACCOUNT)}
      >
        <span className="title">{shortDid(account.accountDid)}</span>
        <span className="count" data-score={score}>
          Trust {score}
        </span>
      </button>
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

function Marketplace({ account, installed, onChange }) {
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const results = searchRegistry(registry, query);
  return <main className="chat account-view"><div className="account-body">
    <h1>Apps / Marketplace</h1>
    <p className="muted">Discover and manage the apps bundled with this preview. External registries are not connected yet.</p>
    {BUNDLED_APPS.map((app) => {
      const active = installed.includes(app.id);
      return <section key={app.id} className="market-item" data-market-app={app.id}>
        <h2>{app.title} <span className="tag">{app.type} · Included in this image</span></h2>
        <p>{app.description}</p>
        <button type="button" className="secondary" data-app-install={app.id} onClick={() => {
          if (!setAppInstalled(account.accountDid, app.id, !active)) { setError(true); return; }
          setError(false); onChange();
        }}>{active ? "Uninstall" : "Install"}</button>
      </section>;
    })}
    {error ? <p className="problem" role="alert">Could not save the app choice on this device.</p> : null}
    <p className="muted">Install makes a bundled app available in the sidebar. Uninstall removes it from your sidebar; the image itself is unchanged.</p>
    <h2>Plugins and external apps</h2>
    <p className="muted">Search a bundled, read-only Itonami Registry snapshot ({REGISTRY_REVISION.slice(0, 8)}). Listings are metadata; external installation is not connected.</p>
    <label className="field">Search registry
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps, skills and bots" />
    </label>
    {query.trim() ? <ul className="discovery-results">{results.map((item) =>
      <li key={`${item.type}:${item.id}`}><strong>{item.name || item.id}</strong> <span className="tag">{item.type}</span><p>{item.description || "No description"}</p></li>
    )}</ul> : null}
    {query.trim() && results.length === 0 ? <p className="muted">No matching entries in this snapshot.</p> : null}
  </div></main>;
}

function AppView({ dapp, now, account, broker }) {
  if (dapp.id === "bunsho") return <Bunsho key={account.accountDid} accountDid={account.accountDid} />;
  if (dapp.id === "hyokeisan") return <Hyokeisan key={account.accountDid} accountDid={account.accountDid} />;
  if (dapp.id === "tsunagu") return <Tsunagu broker={broker} QrCode={QrCode} />;
  if (dapp.id === "tokei") return <main className="chat account-view"><div className="account-body" data-app-view="tokei">
    <h1>Tokei</h1><p className="app-clock">{now.toLocaleTimeString()}</p><p>{now.toLocaleDateString(undefined, { dateStyle: "full" })}</p>
  </div></main>;
  return <main className="chat account-view"><div className="account-body" data-app-view={dapp.id}>
    <h1>{dapp.title}</h1><p>{dapp.summary}</p>
    <p className="muted">This app is listed in the catalog, but its application interface is not connected in this preview.</p>
  </div></main>;
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

function Chat({ dapp, context, messages, onSend, ageBand }) {
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
            {messages.map((message, index) => (
              <li key={index}>{displayMessage(message, ageBand) ?? "Content hidden by your age setting."}</li>
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

function Locked({ dapp, minimum, score, onRaise }) {
  return (
    <main className="chat">
      <div className="empty" data-dapp-locked={dapp.id}>
        <h1>{dapp.title}</h1>
        <p>
          This app needs a trust score of {minimum}. Yours is {score}.
        </p>
        <button type="button" className="primary" onClick={onRaise}>
          Raise Your Score
        </button>
      </div>
    </main>
  );
}

function DappPanel({ dapp, score, onRaise }) {
  const available = ["tokei", "bunsho", "hyokeisan", "tsunagu"].includes(dapp.id);
  return (
    <aside className="panel" aria-label={`${dapp.title} dapp`}>
      <div className="panel-head">
        <h2>{dapp.title}</h2>
        <span className="tag">{available ? "Local preview" : "Not connected"}</span>
      </div>
      <p>{dapp.summary}</p>
      <dl>
        <dt>Install</dt>
        <dd>{available ? "Bundled app" : "Not connected in this preview"}</dd>
        <dt>Offline</dt>
        <dd>{available ? "Available offline" : "Not yet verified"}</dd>
      </dl>
      <h3>Catalog-declared operations</h3>
      <p>
        {dapp.id === "tsunagu"
          ? "These operations run on this VM, each only after you approve it."
          : "These entries describe planned capabilities; they are not connected here."}
      </p>
      {dapp.remoteOperations.length === 0 ? (
        <p>None. This app does not use the network.</p>
      ) : (
        <ul className="operations">
          {dapp.remoteOperations.map((operation) => {
            const minimum = operationMinimum(dapp.id, operation.operation);
            const locked = score < minimum;
            return (
              <li key={operation.operation} data-operation={operation.operation} data-locked={locked}>
                <span className="title">{operation.operation}</span>
                <span>{operation.service}</span>
                <span>{operation.consent === "each-operation" ? "Asks each time" : operation.consent}</span>
                {locked ? (
                  <button type="button" className="locked" onClick={onRaise}>
                    Needs trust {minimum}. Yours is {score}.
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function Account({ account, ageBand, onAgeSelected, score, proofs, onCheckPassport, passportState, onSignOut }) {
  const address = accountAddress(account.accountDid);
  const [selectedAge, setSelectedAge] = useState(ageBand);
  const [ageError, setAgeError] = useState(false);
  return (
    <main className="chat account-view">
      <div className="account-body">
        <h1>Account</h1>
        <p className="account-id">{account.accountDid}</p>
        <p className="muted">
          Signed in with {account.method === "wallet" ? "a Web3 wallet" : "a passkey"} until{" "}
          {new Date(account.expiresAt).toLocaleDateString()}.
        </p>
        <h2>Age group</h2>
        <p className="muted">Self-declared and saved on this device. This is not age verification.</p>
        <label>
          <span>Age group </span>
          <select value={selectedAge} onChange={(event) => { setSelectedAge(event.target.value); setAgeError(false); }}>
            <option value="under-13">Under 13</option>
            <option value="13-17">13–17</option>
            <option value="18-plus">18 or older</option>
          </select>
        </label>
        <button type="button" disabled={selectedAge === ageBand} onClick={() => {
          if (!onAgeSelected(account.accountDid, selectedAge)) setAgeError(true);
        }}>Save age group</button>
        {ageError ? <p className="problem" role="alert">Could not save your choice on this device.</p> : null}
        <h2>
          Trust score <span data-score={score}>{score}</span>
        </h2>
        <p className="muted">
          A condition for some apps and operations. It does not mean goodwill, truth or a verified identity.
        </p>
        <ul className="sources">
          <li>
            <span>Signed in</span>
            <span>+{POINTS.login}</span>
          </li>
          <li>
            <span>
              Human Passport
              {proofs.passport?.account === account.accountDid ? ` (score ${proofs.passport.score})` : ""}
            </span>
            {address ? (
              <button type="button" onClick={onCheckPassport}>
                Check for +{POINTS.passport}
              </button>
            ) : (
              <span className="muted">Needs a wallet account</span>
            )}
          </li>
          <li>
            <span>World ID</span>
            <span className="muted">Not available yet (+{POINTS.worldId})</span>
          </li>
        </ul>
        {passportState ? <p className={passportState.problem ? "problem" : "muted"}>{passportState.text}</p> : null}
        <button type="button" className="secondary" data-sign-out onClick={onSignOut}>
          Sign Out of This Device
        </button>
      </div>
    </main>
  );
}

function Shell({ account, ageBand, onAgeSelected, proofs, score, broker, zenoh, matter, onProof, onSignOut }) {
  const now = useNow();
  const [context, setContext] = useState(HOME);
  const [threads, addMessage] = useThreads();
  const [passportState, setPassportState] = useState(null);
  const [, refreshApps] = useState(0);
  const installed = installedApps(account.accountDid);
  const dapp = catalog.dapps.find((item) => item.id === context);
  const minimum = dapp ? dappMinimum(dapp.id) : 0;
  const openAccount = () => setContext(ACCOUNT);

  const checkPassport = async () => {
    setPassportState(null);
    try {
      const address = accountAddress(account.accountDid);
      const passportScore = parsePassportResponse(await readPassport(broker, passportCall(address)));
      onProof("passport", { account: account.accountDid, score: passportScore, checkedAt: Date.now() });
      setPassportState({ text: `Human Passport score on Optimism: ${passportScore}.` });
    } catch (error) {
      setPassportState({
        problem: true,
        text: /not approved/.test(error.message) ? "Nothing was sent." : "The chain could not be read. Try again later.",
      });
    }
  };

  let body;
  if (context === ACCOUNT) {
    body = (
      <Account
        account={account}
        ageBand={ageBand}
        onAgeSelected={onAgeSelected}
        score={score}
        proofs={proofs}
        onCheckPassport={checkPassport}
        passportState={passportState}
        onSignOut={onSignOut}
      />
    );
  } else if (context === MARKETPLACE) {
    body = <Marketplace account={account} installed={installed} onChange={() => refreshApps((value) => value + 1)} />;
  } else if (dapp && score < minimum) {
    body = <Locked dapp={dapp} minimum={minimum} score={score} onRaise={openAccount} />;
  } else if (dapp) {
    body = <AppView dapp={dapp} now={now} account={account} broker={broker} />;
  } else {
    body = (
      <Chat
        dapp={dapp}
        context={context}
        messages={threads[context] ?? []}
        ageBand={ageBand}
        onSend={(text) => addMessage(context, text)}
      />
    );
  }

  return (
    <div className={dapp ? "shell with-panel" : "shell"} data-age-band={ageBand}>
      <Sidebar
        context={context}
        onSelect={setContext}
        threads={threads}
        now={now}
        zenoh={zenoh}
        matter={matter}
        account={account}
        score={score}
        installed={installed}
      />
      {body}
      {dapp ? <DappPanel dapp={dapp} score={score} onRaise={openAccount} /> : null}
    </div>
  );
}

function App() {
  const zenoh = useService(zenohUp);
  const matter = useService(matterUp);
  const broker = useMemo(() => createBroker("index.html", osOperations(relayOrigin), tailscaleAdapters()), []);
  const [did, setDid] = useState(null);
  const [account, setAccount] = useState(null);
  const [finished, setFinished] = useState(setupFinished);
  const [proofs, setProofs] = useState(loadProofs);
  const [, refreshAge] = useState(0);
  const ageBand = account ? readAgeBand(account.accountDid) : null;
  const onAgeSelected = (accountDid, band) => {
    const saved = saveAgeBand(accountDid, band);
    if (saved) refreshAge((value) => value + 1);
    return saved;
  };
  const score = trustScore({ accountDid: account?.accountDid, proofs });
  const open = Boolean(did && account && finished && ageBand);

  useEffect(() => {
    deviceDid().then((value) => {
      setAccount(loadSession(value));
      setDid(value);
    });
  }, []);

  // The boot report reads this title, so the check proves that React rendered and
  // that the apps stay hidden until sign-in.
  useEffect(() => {
    const dapps = document.querySelectorAll(".dapp").length;
    document.title = `Awai Otehon zenoh=${zenoh ? 1 : 0} matter=${matter ? 1 : 0} gate=${open ? 0 : 1} dapps=${dapps}`;
  }, [zenoh, matter, open, did]);

  if (!did) return null;
  if (!open) {
    return (
      <Setup
        broker={broker}
        relayOrigin={relayOrigin}
        did={did}
        account={account}
        ageBand={ageBand}
        returning={finished}
        score={score}
        onLinked={setAccount}
        onAgeSelected={onAgeSelected}
        onFinish={() => {
          localStorage.setItem(SETUP_KEY, "done");
          setFinished(true);
        }}
      />
    );
  }
  return (
    <Shell
      account={account}
      ageBand={ageBand}
      onAgeSelected={onAgeSelected}
      proofs={proofs}
      score={score}
      broker={broker}
      zenoh={zenoh}
      matter={matter}
      onProof={(name, proof) => {
        saveProof(name, proof);
        setProofs(loadProofs());
      }}
      onSignOut={() => {
        clearSession();
        setProofs({});
        setAccount(null);
      }}
    />
  );
}

createRoot(document.getElementById("root")).render(<App />);
