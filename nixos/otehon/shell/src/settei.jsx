// Settei and Web: the two System and Apps screens that change something on this device.
// Both talk only to loopback services (settei/settei.nix). Nothing here leaves the machine.
import { useEffect, useState } from "react";
import { LANGUAGES, useLanguage, useText } from "./i18n.js";

export const SETTEI_ORIGIN = "http://127.0.0.1:8774";
export const WEB_ORIGIN = "http://127.0.0.1:8775";

async function call(origin, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error ?? `http-${response.status}`), { refused: true });
  return value;
}

// The zone the browser itself uses for times. It follows /etc/localtime, so after a change it
// shows whether Chromium picked the new zone up.
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function TimeZone() {
  const t = useText();
  const { language } = useLanguage();
  const now = useClock();
  const [state, setState] = useState({ phase: "loading" });
  const [choice, setChoice] = useState("");

  const load = () =>
    call(SETTEI_ORIGIN, "/v1/timezone")
      .then((value) => {
        setState({ phase: "ready", zone: value.zone, zones: value.zones });
        setChoice((current) => current || value.zone);
      })
      .catch(() => setState({ phase: "unavailable" }));
  useEffect(() => {
    load();
  }, []);

  const apply = async () => {
    setState((current) => ({ ...current, phase: "applying", refusal: null, applied: null }));
    try {
      const value = await call(SETTEI_ORIGIN, "/v1/timezone", { zone: choice });
      setState((current) => ({ ...current, phase: "ready", zone: value.zone, applied: value.zone }));
    } catch (error) {
      setState((current) => ({ ...current, phase: "ready", refusal: error.refused ? error.message : "unreachable" }));
    }
  };

  return (
    <section className="settei-section" aria-labelledby="settei-time-zone">
      <h2 id="settei-time-zone">{t("settei.timeZone")}</h2>
      {state.phase === "unavailable" ? (
        <p className="problem" data-settei-state="unavailable">
          {t("settei.unavailable")}
        </p>
      ) : null}
      {state.zone ? (
        <p data-settei-zone={state.zone} data-browser-zone={browserZone()}>
          {t("settei.timeZoneCurrent", {
            zone: state.zone,
            time: now.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" }),
          })}
        </p>
      ) : null}
      {state.zones ? (
        <div className="settei-row">
          <label className="field">
            <span>{t("settei.timeZoneChoose")}</span>
            <select id="settei-zone" value={choice} onChange={(event) => setChoice(event.target.value)}>
              {state.zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            id="settei-apply"
            disabled={state.phase === "applying" || !choice || choice === state.zone}
            onClick={apply}
          >
            {state.phase === "applying" ? t("settei.applying") : t("settei.apply")}
          </button>
        </div>
      ) : null}
      <div role="status">
        {state.applied ? <p data-settei-applied={state.applied}>{t("settei.applied", { zone: state.applied })}</p> : null}
        {state.refusal ? (
          <p className="problem" data-settei-refused={state.refusal}>
            {t("settei.refused", { reason: state.refusal })}
          </p>
        ) : null}
      </div>
      <p className="muted">{t("settei.helperNote")}</p>
    </section>
  );
}

export function Settei() {
  const t = useText();
  const { language, setLanguage } = useLanguage();
  return (
    <main className="chat settei" data-settei>
      <div className="settei-body">
        <h1>{t("settei.title")}</h1>
        <section className="settei-section" aria-labelledby="settei-language">
          <h2 id="settei-language">{t("settei.language")}</h2>
          <ul className="choices">
            {LANGUAGES.map(([code, label]) => (
              <li key={code}>
                <button
                  type="button"
                  data-language={code}
                  lang={code}
                  aria-pressed={language === code}
                  onClick={() => setLanguage(code)}
                >
                  <span>{label}</span>
                  {language === code ? <span aria-hidden="true">✓</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">{t("settei.languageNote")}</p>
        </section>
        <TimeZone />
        <section className="settei-section" aria-labelledby="settei-network">
          <h2 id="settei-network">{t("settei.network")}</h2>
          <p className="muted">{t("settei.networkNote")}</p>
        </section>
        <section className="settei-section" aria-labelledby="settei-other">
          <h2 id="settei-other">{t("settei.other")}</h2>
          <p className="muted">{t("settei.otherNote")}</p>
        </section>
      </div>
    </main>
  );
}

export function WebBrowser() {
  const t = useText();
  const [state, setState] = useState(null);
  const open = async () => {
    setState("opening");
    try {
      await call(WEB_ORIGIN, "/v1/open", {});
      setState("opened");
    } catch (error) {
      setState(error.refused ? `refused:${error.message}` : "unavailable");
    }
  };
  return (
    <main className="chat settei" data-web>
      <div className="settei-body">
        <h1>{t("browser.title")}</h1>
        <p>{t("browser.body")}</p>
        <button type="button" className="primary" id="web-open" disabled={state === "opening"} onClick={open}>
          {state === "opening" ? t("browser.opening") : t("browser.open")}
        </button>
        <div role="status">
          {state === "opened" ? <p data-web-state="opened">{t("browser.opened")}</p> : null}
          {state === "unavailable" ? (
            <p className="problem" data-web-state="unavailable">
              {t("browser.unavailable")}
            </p>
          ) : null}
          {state?.startsWith("refused:") ? (
            <p className="problem" data-web-state="refused">
              {t("browser.refused", { reason: state.slice(8) })}
            </p>
          ) : null}
        </div>
        <p className="muted">{t("browser.network")}</p>
        <p className="muted">{t("browser.kotoba")}</p>
      </div>
    </main>
  );
}
