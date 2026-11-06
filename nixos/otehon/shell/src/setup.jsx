import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "react";
import { REQUEST_MS, confirmationCode, createLinkRequest, linkUrl, openResponse, verifyLink } from "./identity/link.js";
import { saveSession } from "./identity/device.js";
import { awaitPhoneApproval } from "./runtime.js";
import { POINTS } from "./trust.js";

const TEXT = {
  en: {
    hello: "Hello",
    getStarted: "Get Started",
    next: "Continue",
    back: "Back",
    languageTitle: "Choose your language",
    networkTitle: "Network",
    networkOnline: "This device reports a network connection.",
    networkOffline: "This device reports no network connection.",
    networkNote: "Signing in needs the network. Network settings are not available here yet.",
    signInTitle: "Sign in with your phone",
    signInBody: "Approve this device on your phone with a passkey or a Web3 wallet. There is no password or guest option.",
    signInAgain: "Sign in with your phone to open this device.",
    linkStart: "Link with Phone",
    scan: "Scan this code with your phone.",
    checkCode: "Check that your phone shows this code:",
    waiting: "Waiting for your phone…",
    denied: "Nothing was sent. Choose Link with Phone to try again.",
    failed: "The relay could not be reached. Check the network and try again.",
    expired: "This code expired. Choose Link with Phone to try again.",
    refused: "An answer was refused",
    trustTitle: "Trust Score",
    trustBody: "Some apps and operations ask for a minimum score. The score is not a verdict on you, and you can raise it later in Account.",
    yourScore: "Your score",
    later: "Set Up Later",
    doneTitle: "You're all set",
    doneBody: "Your apps are in the sidebar. Each one has its own conversation.",
    enter: "Open Itonami",
  },
  ja: {
    hello: "こんにちは",
    getStarted: "はじめる",
    next: "続ける",
    back: "戻る",
    languageTitle: "言語を選択",
    networkTitle: "ネットワーク",
    networkOnline: "この端末はネットワークに接続されています。",
    networkOffline: "この端末はネットワークに接続されていません。",
    networkNote: "サインインにはネットワークが必要です。ここではまだネットワークを設定できません。",
    signInTitle: "スマートフォンでサインイン",
    signInBody: "スマートフォンでパスキーか Web3 ウォレットを使い、この端末を承認します。パスワードとゲストの利用はできません。",
    signInAgain: "この端末を開くには、スマートフォンでサインインしてください。",
    linkStart: "スマートフォンとリンク",
    scan: "このコードをスマートフォンで読み取ってください。",
    checkCode: "スマートフォンに同じコードが出ていることを確認してください:",
    waiting: "スマートフォンの承認を待っています…",
    denied: "何も送信していません。もう一度試すには「スマートフォンとリンク」を選んでください。",
    failed: "中継に接続できません。ネットワークを確認して、もう一度お試しください。",
    expired: "コードの期限が切れました。もう一度「スマートフォンとリンク」を選んでください。",
    refused: "受け取った応答を拒否しました",
    trustTitle: "Trust Score",
    trustBody: "App や操作によっては、最低点が必要です。この点数はあなたへの評価ではありません。あとで「アカウント」から上げられます。",
    yourScore: "現在の点数",
    later: "あとで設定",
    doneTitle: "準備ができました",
    doneBody: "App はサイドバーにあります。App ごとに専用の会話があります。",
    enter: "Itonami を開く",
  },
};

const LANGUAGES = [
  ["en", "English"],
  ["ja", "日本語"],
];
const STEPS = ["hello", "language", "network", "signin", "trust", "done"];
const LANGUAGE_KEY = "otehon.language.v1";

function savedLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return saved === "ja" || saved === "en" ? saved : "en";
  } catch {
    return "en";
  }
}

function QrCode({ url }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(url);
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) d += `M${column + 4} ${row + 4}h1v1h-1z`;
      }
    }
    return { size: count + 8, path: d };
  }, [url]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={url} data-link-url={url}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function SignIn({ t, returning, broker, relayOrigin, did, onLinked }) {
  const [state, setState] = useState("idle");
  const [pending, setPending] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const abort = useRef(null);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    setRefusal(null);
    setPending(null);
    setState("asking");
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort(), REQUEST_MS);
    try {
      const { request, privateKey } = await createLinkRequest(did);
      const stream = await awaitPhoneApproval(broker, relayOrigin, request.topic, controller.signal);
      setPending({ url: linkUrl(request), code: confirmationCode(request) });
      setState("waiting");
      for await (const sealed of stream.messages()) {
        try {
          const response = await openResponse(request, privateKey, sealed);
          const account = verifyLink({ request, response, deviceDid: did });
          saveSession(request, response);
          onLinked(account);
          return;
        } catch (error) {
          // Anyone with the topic can post. Keep waiting for a valid answer.
          setRefusal(error.message);
        }
      }
      setState("failed");
    } catch (error) {
      if (controller.signal.aborted) setState("expired");
      else if (/not approved/.test(error.message)) setState("denied");
      else setState("failed");
      setPending(null);
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <>
      <h1>{t.signInTitle}</h1>
      <p>{returning ? t.signInAgain : t.signInBody}</p>
      {pending ? (
        <div className="link-pending">
          <QrCode url={pending.url} />
          <p>{t.scan}</p>
          <p>
            {t.checkCode} <strong className="code">{pending.code}</strong>
          </p>
          <p className="muted">{t.waiting}</p>
        </div>
      ) : null}
      {state === "denied" ? <p data-link-state="denied">{t.denied}</p> : null}
      {state === "failed" ? <p className="problem" data-link-state="failed">{t.failed}</p> : null}
      {state === "expired" ? <p className="problem" data-link-state="expired">{t.expired}</p> : null}
      {refusal ? (
        <p className="problem" data-link-error={refusal}>
          {t.refused}: {refusal}
        </p>
      ) : null}
      {pending || state === "asking" ? null : (
        <button type="button" className="primary" id="link-start" onClick={start}>
          {t.linkStart}
        </button>
      )}
    </>
  );
}

// A one-screen-per-step first run, modelled on the phone setup people know.
// Signing in is required. There is no way past that step without a verified link.
export function Setup({ broker, relayOrigin, did, account, returning, onLinked, score, onFinish }) {
  const [language, setLanguage] = useState(savedLanguage);
  const [step, setStep] = useState(returning ? "signin" : account ? "trust" : "hello");
  const t = TEXT[language];
  const index = STEPS.indexOf(step);
  const next = () => setStep(STEPS[index + 1]);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // The choice still applies to this session.
    }
  }, [language]);

  return (
    <div className="setup" data-step={step}>
      <div className="setup-card">
        {step === "hello" ? (
          <>
            <h1 className="hello">{t.hello}</h1>
            <button type="button" className="primary" data-next onClick={next}>
              {t.getStarted}
            </button>
          </>
        ) : null}
        {step === "language" ? (
          <>
            <h1>{t.languageTitle}</h1>
            <ul className="choices">
              {LANGUAGES.map(([code, label]) => (
                <li key={code}>
                  <button
                    type="button"
                    data-language={code}
                    aria-pressed={language === code}
                    onClick={() => setLanguage(code)}
                  >
                    <span>{label}</span>
                    {language === code ? <span aria-hidden="true">✓</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="primary" data-next onClick={next}>
              {t.next}
            </button>
          </>
        ) : null}
        {step === "network" ? (
          <>
            <h1>{t.networkTitle}</h1>
            <p>{navigator.onLine ? t.networkOnline : t.networkOffline}</p>
            <p className="muted">{t.networkNote}</p>
            <button type="button" className="primary" data-next onClick={next}>
              {t.next}
            </button>
          </>
        ) : null}
        {step === "signin" ? (
          <SignIn
            t={t}
            returning={returning}
            broker={broker}
            relayOrigin={relayOrigin}
            did={did}
            onLinked={(linked) => {
              onLinked(linked);
              if (returning) onFinish();
              else next();
            }}
          />
        ) : null}
        {step === "trust" ? (
          <>
            <h1>{t.trustTitle}</h1>
            <p>{t.trustBody}</p>
            <p>
              {t.yourScore}: <strong data-score={score}>{score}</strong> / {POINTS.login + POINTS.passport + POINTS.worldId}
            </p>
            <button type="button" className="primary" data-next onClick={next}>
              {t.later}
            </button>
          </>
        ) : null}
        {step === "done" ? (
          <>
            <h1>{t.doneTitle}</h1>
            <p>{t.doneBody}</p>
            <p className="muted account-id">{account?.accountDid}</p>
            <button type="button" className="primary" data-finish onClick={onFinish}>
              {t.enter}
            </button>
          </>
        ) : null}
        {index > 0 && index < 3 ? (
          <button type="button" className="secondary" onClick={() => setStep(STEPS[index - 1])}>
            {t.back}
          </button>
        ) : null}
      </div>
      {returning ? null : (
        <ol className="progress" aria-label={`${index + 1} / ${STEPS.length}`}>
          {STEPS.map((name) => (
            <li key={name} className={name === step ? "current" : undefined} />
          ))}
        </ol>
      )}
    </div>
  );
}
