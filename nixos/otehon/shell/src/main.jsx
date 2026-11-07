import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import catalog from "./dapps.json";
import { MANIMANI, Manimani, ManimaniLink } from "./manimani.jsx";
import { clearSession, deviceDid, loadProofs, loadSession, saveProof } from "./identity/device.js";
import { clearLock, loadLock, markLocked, markUnlocked, newLock, saveLock, unlockedThisSession } from "./identity/lock.js";
import { LockScreen, useIdle } from "./lock.jsx";
import { createBroker, osOperations, readPassport } from "./runtime.js";
import { MEDIA_ORIGIN, describeMessage, requestImage, requestSpeech, settleSavedItem, useMediaCapabilities } from "./media.js";
import { Setup } from "./setup.jsx";
import { Settei, WebBrowser } from "./settei.jsx";
import { LanguageContext, dappSummary, saveLanguage, savedLanguage, serviceName, useLanguage, useText } from "./i18n.js";
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
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(Object.entries(saved).map(([context, items]) => [context, items.map(settleSavedItem)]));
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
  const add = (context, item) =>
    setThreads((current) => ({
      ...current,
      [context]: [...(current[context] ?? []), item],
    }));
  const update = (context, id, changes) =>
    setThreads((current) => ({
      ...current,
      [context]: (current[context] ?? []).map((item) => (item?.id === id ? { ...item, ...changes } : item)),
    }));
  return [threads, add, update];
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
  const t = useText();
  return (
    <li className={up ? "service up" : "service down"}>
      <span>{name}</span>
      <span>{up ? t("service.running") : t("service.down")}</span>
    </li>
  );
}

// These dapps have a screen of their own in the shell instead of a chat.
const SCREENS = new Set(["settei", "browser"]);

function Sidebar({ context, onSelect, threads, now, zenoh, matter, account, score, onLock }) {
  const t = useText();
  const { language } = useLanguage();
  return (
    <nav className="sidebar" aria-label={t("sidebar.label")}>
      <div className="brand">Itonami</div>
      <button
        type="button"
        className={context === HOME ? "new-chat active" : "new-chat"}
        aria-current={context === HOME ? "page" : undefined}
        onClick={() => onSelect(HOME)}
      >
        {t("sidebar.newChat")}
      </button>
      <ManimaniLink active={context === MANIMANI} onSelect={() => onSelect(MANIMANI)} />
      <div className="contexts">
        {SECTIONS.map((section) => (
          <section key={section}>
            <h2>{t(`section.${section}`)}</h2>
            <ul>
              {catalog.dapps
                .filter((dapp) => dapp.section === section)
                .map((dapp) => (
                  <li key={dapp.id}>
                    <button
                      type="button"
                      className={context === dapp.id ? "dapp active" : "dapp"}
                      data-dapp={dapp.id}
                      aria-current={context === dapp.id ? "page" : undefined}
                      onClick={() => onSelect(dapp.id)}
                    >
                      <span className="mark" aria-hidden="true">
                        {dapp.title[0]}
                      </span>
                      <span className="title">{dapp.title}</span>
                      {threads[dapp.id]?.length ? (
                        <span className="count" aria-label={t("sidebar.messages", { count: threads[dapp.id].length })}>
                          {threads[dapp.id].length}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      <button
        type="button"
        className={context === ACCOUNT ? "account-button active" : "account-button"}
        data-account={account.accountDid}
        aria-current={context === ACCOUNT ? "page" : undefined}
        aria-label={t("account.open", { id: shortDid(account.accountDid), score })}
        onClick={() => onSelect(ACCOUNT)}
      >
        <span className="title">{shortDid(account.accountDid)}</span>
        <span className="count" data-score={score}>
          {t("account.trust", { score })}
        </span>
      </button>
      <footer>
        <ul className="services" aria-label={t("sidebar.services")}>
          <Service name="Zenoh" up={zenoh} />
          <Service name="Matter" up={matter} />
        </ul>
        <time dateTime={now.toISOString()} data-clock>
          {now.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}
        </time>
        <button type="button" className="secondary lock-now" data-lock-now onClick={onLock}>
          {t("lock.now")}
        </button>
      </footer>
    </nav>
  );
}

function Composer({ placeholder, onSend, onImage, onSpeech, capabilities, context }) {
  const t = useText();
  const [text, setText] = useState("");
  const input = useRef(null);
  useEffect(() => {
    setText("");
    input.current?.focus();
  }, [context]);

  const submit = (action) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    action(trimmed);
    setText("");
  };
  const send = () => submit(onSend);

  return (
    <form
      className="composer"
      aria-label={placeholder}
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
      <button
        type="button"
        className="tool"
        data-generate="speech"
        disabled={!text.trim() || capabilities.speech.length === 0}
        onClick={() => submit(onSpeech)}
      >
        {t("composer.speak")}
      </button>
      <button
        type="button"
        className="tool"
        data-generate="image"
        title={capabilities.image ? undefined : t("composer.imageMissing")}
        disabled={!text.trim() || !capabilities.image}
        onClick={() => submit(onImage)}
      >
        {t("composer.image")}
      </button>
      <button type="submit" disabled={!text.trim()}>
        {t("composer.send")}
      </button>
    </form>
  );
}

function Message({ item }) {
  const t = useText();
  const message = describeMessage(item);
  if (message.kind === "text") return <li>{message.text}</li>;
  return (
    <li className="media" data-media={message.kind} data-state={message.state}>
      <span className="prompt">{message.text}</span>
      {message.state === "done" && message.kind === "speech" ? (
        <audio controls preload="metadata" src={`${MEDIA_ORIGIN}${message.url}`} />
      ) : null}
      {message.state === "done" && message.kind === "image" ? (
        <img alt={message.text} src={`${MEDIA_ORIGIN}${message.url}`} />
      ) : null}
      {message.state === "working" ? (
        <span className="muted">
          {message.kind === "image" ? t("media.imageWorking") : t("media.working")}
        </span>
      ) : null}
      {message.state === "failed" ? <span className="problem">{t("media.failed", { reason: message.reason })}</span> : null}
      {message.state === "done" && message.seconds != null ? (
        <span className="muted">{t("media.seconds", { seconds: message.seconds })}</span>
      ) : null}
    </li>
  );
}

function Chat({ dapp, context, messages, onSend, onImage, onSpeech, capabilities }) {
  const t = useText();
  const { language } = useLanguage();
  const end = useRef(null);
  useEffect(() => {
    end.current?.scrollIntoView();
  }, [messages.length, context]);

  return (
    <main className="chat">
      <div className="thread">
        {messages.length === 0 ? (
          <div className="empty">
            <h1>{dapp ? dapp.title : t("chat.homeTitle")}</h1>
            {dapp ? <p>{dappSummary(language, dapp)}</p> : <p>{t("chat.homeBody")}</p>}
          </div>
        ) : (
          <ol className="messages" aria-label={t("chat.messages")} aria-live="polite">
            {messages.map((item, index) => (
              <Message key={item?.id ?? index} item={item} />
            ))}
          </ol>
        )}
        <div ref={end} />
      </div>
      <div className="dock">
        <Composer
          context={context}
          onSend={onSend}
          onImage={onImage}
          onSpeech={onSpeech}
          capabilities={capabilities}
          placeholder={dapp ? t("composer.message", { name: dapp.title }) : t("composer.messageHome")}
        />
        <p className="notice">{t("chat.notice")}</p>
      </div>
    </main>
  );
}

function Locked({ dapp, minimum, score, onRaise }) {
  const t = useText();
  return (
    <main className="chat">
      <div className="empty" data-dapp-locked={dapp.id}>
        <h1>{dapp.title}</h1>
        <p>{t("locked.body", { minimum, score })}</p>
        <button type="button" className="primary" onClick={onRaise}>
          {t("locked.raise")}
        </button>
      </div>
    </main>
  );
}

function DappPanel({ dapp, score, onRaise }) {
  const t = useText();
  const { language } = useLanguage();
  return (
    <aside className="panel" aria-label={t("panel.label", { name: dapp.title })}>
      <div className="panel-head">
        <h2>{dapp.title}</h2>
        <span className="tag">{t("panel.notConnected")}</span>
      </div>
      <p>{dappSummary(language, dapp)}</p>
      <dl>
        <dt>{t("panel.install")}</dt>
        <dd>{dapp.install === "os-image" ? t("panel.osImage") : dapp.install}</dd>
        <dt>{t("panel.offline")}</dt>
        <dd>{dapp.offline === "local-core" ? t("panel.localCore") : dapp.offline}</dd>
      </dl>
      <h3>{t("panel.operations")}</h3>
      {dapp.remoteOperations.length === 0 ? (
        <p>{t("panel.none")}</p>
      ) : (
        <ul className="operations">
          {dapp.remoteOperations.map((operation) => {
            const minimum = operationMinimum(dapp.id, operation.operation);
            const locked = score < minimum;
            return (
              <li key={operation.operation} data-operation={operation.operation} data-locked={locked}>
                <span className="title">{operation.operation}</span>
                <span>{serviceName(language, operation.service)}</span>
                <span>{operation.consent === "each-operation" ? t("panel.asks") : operation.consent}</span>
                {locked ? (
                  <button type="button" className="locked" onClick={onRaise}>
                    {t("panel.needs", { minimum, score })}
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

function Account({ account, score, proofs, onCheckPassport, passportState, onSignOut }) {
  const t = useText();
  const { language } = useLanguage();
  const address = accountAddress(account.accountDid);
  return (
    <main className="chat account-view">
      <div className="account-body">
        <h1>{t("account.title")}</h1>
        <p className="account-id">{account.accountDid}</p>
        <p className="muted">
          {t("account.signedIn", {
            method: account.method === "wallet" ? t("account.wallet") : t("account.passkey"),
            date: new Date(account.expiresAt).toLocaleDateString(language),
          })}
        </p>
        <h2>
          {t("account.score")} <span data-score={score}>{score}</span>
        </h2>
        <p className="muted">{t("account.scoreNote")}</p>
        <ul className="sources" aria-label={t("account.sources")}>
          <li>
            <span>{t("account.signedInSource")}</span>
            <span>+{POINTS.login}</span>
          </li>
          <li>
            <span>
              Human Passport
              {proofs.passport?.account === account.accountDid ? t("account.passportScore", { score: proofs.passport.score }) : ""}
            </span>
            {address ? (
              <button type="button" onClick={onCheckPassport}>
                {t("account.check", { points: POINTS.passport })}
              </button>
            ) : (
              <span className="muted">{t("account.needsWallet")}</span>
            )}
          </li>
          <li>
            <span>World ID</span>
            <span className="muted">{t("account.worldId", { points: POINTS.worldId })}</span>
          </li>
        </ul>
        {passportState ? (
          <p className={passportState.problem ? "problem" : "muted"} role="status">
            {t(passportState.key, passportState.vars)}
          </p>
        ) : null}
        <button type="button" className="secondary" data-sign-out onClick={onSignOut}>
          {t("account.signOut")}
        </button>
      </div>
    </main>
  );
}

function Shell({ account, proofs, score, broker, zenoh, matter, onProof, onSignOut, onLock }) {
  const now = useNow();
  const [context, setContext] = useState(HOME);
  const [threads, addMessage, updateMessage] = useThreads();
  const capabilities = useMediaCapabilities();
  const [passportState, setPassportState] = useState(null);
  const dapp = catalog.dapps.find((item) => item.id === context);
  const minimum = dapp ? dappMinimum(dapp.id) : 0;
  const openAccount = () => setContext(ACCOUNT);

  const checkPassport = async () => {
    setPassportState(null);
    try {
      const address = accountAddress(account.accountDid);
      const passportScore = parsePassportResponse(await readPassport(broker, passportCall(address)));
      onProof("passport", { account: account.accountDid, score: passportScore, checkedAt: Date.now() });
      setPassportState({ key: "account.passportResult", vars: { score: passportScore } });
    } catch (error) {
      setPassportState({
        problem: true,
        key: /not approved/.test(error.message) ? "account.nothingSent" : "account.chainFailed",
      });
    }
  };

  let body;
  if (context === ACCOUNT) {
    body = (
      <Account
        account={account}
        score={score}
        proofs={proofs}
        onCheckPassport={checkPassport}
        passportState={passportState}
        onSignOut={onSignOut}
      />
    );
  } else if (context === MANIMANI) {
    body = <Manimani />;
  } else if (context === "settei") {
    body = <Settei />;
  } else if (context === "browser") {
    body = <WebBrowser />;
  } else if (dapp && score < minimum) {
    body = <Locked dapp={dapp} minimum={minimum} score={score} onRaise={openAccount} />;
  } else {
    body = (
      <Chat
        dapp={dapp}
        context={context}
        messages={threads[context] ?? []}
        onSend={(text) => addMessage(context, text)}
        onSpeech={(text) => requestSpeech(text, context, addMessage, updateMessage)}
        onImage={(text) => requestImage(text, context, addMessage, updateMessage)}
        capabilities={capabilities}
      />
    );
  }

  const panel = dapp && !SCREENS.has(dapp.id);
  return (
    <div className={panel ? "shell with-panel" : "shell"}>
      <Sidebar
        context={context}
        onSelect={setContext}
        threads={threads}
        now={now}
        zenoh={zenoh}
        matter={matter}
        account={account}
        score={score}
        onLock={onLock}
      />
      {body}
      {panel ? <DappPanel dapp={dapp} score={score} onRaise={openAccount} /> : null}
    </div>
  );
}

function App() {
  const zenoh = useService(zenohUp);
  const matter = useService(matterUp);
  const broker = useMemo(() => createBroker("index.html", osOperations(relayOrigin)), []);
  const [did, setDid] = useState(null);
  const [account, setAccount] = useState(null);
  const [finished, setFinished] = useState(setupFinished);
  const [proofs, setProofs] = useState(loadProofs);
  const [lock, setLock] = useState(loadLock);
  const [language, setLanguageState] = useState(savedLanguage);
  const languageValue = useMemo(
    () => ({
      language,
      setLanguage: (next) => {
        saveLanguage(next);
        setLanguageState(next);
      },
    }),
    [language],
  );
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const score = trustScore({ accountDid: account?.accountDid, proofs });
  const open = Boolean(did && account && finished && !lock);

  const lockNow = (accountDid = account?.accountDid, device = did) => {
    if (!accountDid || !device) return;
    const created = newLock(accountDid, device);
    saveLock(created);
    markLocked();
    setLock(created);
  };

  useEffect(() => {
    deviceDid().then((value) => {
      const saved = loadSession(value);
      // A new browser, as after a reboot, starts locked. A reload of the same page does not.
      if (saved && !loadLock() && !unlockedThisSession()) lockNow(saved.accountDid, value);
      setAccount(saved);
      setDid(value);
    });
  }, []);

  useIdle(open, IDLE_LOCK_MS, () => lockNow());

  // The boot report reads this title, so the check proves that React rendered and
  // that the apps stay hidden until sign-in.
  useEffect(() => {
    const dapps = document.querySelectorAll(".dapp").length;
    document.title = `Awai Otehon zenoh=${zenoh ? 1 : 0} matter=${matter ? 1 : 0} locked=${lock ? 1 : 0} gate=${open ? 0 : 1} dapps=${dapps}`;
  }, [zenoh, matter, open, did, lock]);

  if (!did) return null;
  return <LanguageContext.Provider value={languageValue}>{screen()}</LanguageContext.Provider>;

  function screen() {
  // A lock holds whatever the session does: an expired or edited session cannot skip it.
  if (lock) {
    return (
      <LockScreen
        lock={lock}
        onUnlock={() => {
          clearLock();
          markUnlocked();
          setLock(null);
        }}
        onErase={() => {
          localStorage.removeItem(THREADS_KEY);
          clearSession();
          clearLock();
          markUnlocked();
          setProofs({});
          setAccount(null);
          setLock(null);
        }}
      />
    );
  }
  if (!open) {
    return (
      <Setup
        broker={broker}
        relayOrigin={relayOrigin}
        did={did}
        account={account}
        returning={finished}
        score={score}
        onLinked={(linked) => {
          markUnlocked();
          setAccount(linked);
        }}
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
      onLock={() => lockNow()}
    />
  );
  }
}

createRoot(document.getElementById("root")).render(<App />);
