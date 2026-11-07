import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  REQUEST_MS,
  SESSION_MS,
  checksumAddress,
  confirmationCode,
  createLinkRequest,
  linkUrl,
  openResponse,
  siweMessage,
  verifyLink,
} from "./identity/link.js";
import { signWithProvider } from "./identity/wallet.js";
import { saveSession } from "./identity/device.js";
import { awaitPhoneApproval } from "./runtime.js";
import { POINTS } from "./trust.js";
import { readAgeBand } from "./age.js";

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
    networkNote: "A wallet sign-in on this device needs no network. Phone sign-in does. Network settings are not available here yet.",
    ageTitle: "Choose your age group",
    ageBody: "This is self-declared, not identity verification. Your choice stays on this device and is used for content display.",
    ageUnder13: "Under 13",
    ageTeen: "13–17",
    ageAdult: "18 or older",
    ageSaveFailed: "Could not save your choice on this device. Please try again.",
    signInTitle: "Sign In",
    signInBody: "Use a Web3 wallet on this device, or approve with a passkey or wallet on your phone. There is no password or guest option.",
    signInAgain: "Sign in to open this device.",
    localStart: "Sign In with a Wallet",
    linkStart: "Link with Phone",
    useWallet: "Use the Wallet in This Browser",
    addressLabel: "Your wallet address",
    signThis: "Sign this message with your wallet (personal_sign):",
    signatureLabel: "Signature",
    verify: "Verify and Sign In",
    chooseOther: "Choose Another Way",
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
    networkNote: "この端末のウォレットでのサインインにネットワークは不要です。スマートフォンでのサインインには必要です。ここではまだネットワークを設定できません。",
    ageTitle: "年齢区分を選択",
    ageBody: "自己申告であり、本人確認ではありません。選択はこの端末に保存し、コンテンツの表示に使用します。",
    ageUnder13: "13歳未満",
    ageTeen: "13〜17歳",
    ageAdult: "18歳以上",
    ageSaveFailed: "この端末に保存できませんでした。もう一度お試しください。",
    signInTitle: "サインイン",
    signInBody: "この端末で Web3 ウォレットを使うか、スマートフォンでパスキーかウォレットを使って承認します。パスワードとゲストの利用はできません。",
    signInAgain: "この端末を開くには、サインインしてください。",
    localStart: "ウォレットでサインイン",
    linkStart: "スマートフォンとリンク",
    useWallet: "このブラウザーのウォレットを使う",
    addressLabel: "ウォレットのアドレス",
    signThis: "このメッセージをウォレットで署名してください（personal_sign）:",
    signatureLabel: "署名",
    verify: "確認してサインイン",
    chooseOther: "別の方法を選ぶ",
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
const STEPS = ["hello", "language", "network", "signin", "age", "trust", "done"];
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

// Needs no relay and no network: the signature comes from any wallet the person has.
function LocalWallet({ t, did, onLinked, onBack }) {
  const [request, setRequest] = useState(null);
  const [address, setAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [refusal, setRefusal] = useState(null);
  useEffect(() => {
    createLinkRequest(did).then(({ request: created }) => setRequest(created));
  }, [did]);

  const valid = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  const draft = useMemo(() => {
    if (!request || !valid) return null;
    const now = Date.now();
    return {
      method: "wallet",
      address: checksumAddress(address.trim()),
      chainId: 1,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_MS).toISOString(),
    };
  }, [request, valid, address]);

  const finish = (response) => {
    try {
      const account = verifyLink({ request, response, deviceDid: did });
      saveSession(request, response);
      onLinked(account);
    } catch (error) {
      setRefusal(error.message);
    }
  };

  const useProvider = async () => {
    setRefusal(null);
    try {
      finish(await signWithProvider(window.ethereum, request));
    } catch (error) {
      setRefusal(error.message);
    }
  };

  return (
    <>
      <h1>{t.localStart}</h1>
      {window.ethereum ? (
        <button type="button" className="primary" id="local-provider" disabled={!request} onClick={useProvider}>
          {t.useWallet}
        </button>
      ) : null}
      <label className="field">
        <span>{t.addressLabel}</span>
        <input
          id="local-address"
          value={address}
          spellCheck={false}
          autoComplete="off"
          placeholder="0x…"
          onChange={(event) => setAddress(event.target.value)}
        />
      </label>
      {draft ? (
        <>
          <label className="field">
            <span>{t.signThis}</span>
            <textarea
              id="local-message"
              readOnly
              rows={9}
              value={siweMessage({
                address: draft.address,
                chainId: draft.chainId,
                device: request.device,
                nonce: request.nonce,
                issuedAt: draft.issuedAt,
                expiresAt: draft.expiresAt,
              })}
            />
          </label>
          <label className="field">
            <span>{t.signatureLabel}</span>
            <input
              id="local-signature"
              value={signature}
              spellCheck={false}
              autoComplete="off"
              placeholder="0x…"
              onChange={(event) => setSignature(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary"
            id="local-verify"
            disabled={!signature.trim()}
            onClick={() => {
              setRefusal(null);
              finish({ ...draft, signature: signature.trim() });
            }}
          >
            {t.verify}
          </button>
        </>
      ) : null}
      {refusal ? (
        <p className="problem" data-link-error={refusal}>
          {t.refused}: {refusal}
        </p>
      ) : null}
      <button type="button" className="secondary" onClick={onBack}>
        {t.chooseOther}
      </button>
    </>
  );
}

function SignIn({ t, returning, broker, relayOrigin, did, onLinked }) {
  const [local, setLocal] = useState(false);
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

  if (local) return <LocalWallet t={t} did={did} onLinked={onLinked} onBack={() => setLocal(false)} />;

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
        <>
          <button type="button" className="primary" id="local-start" onClick={() => setLocal(true)}>
            {t.localStart}
          </button>
          <button type="button" className="secondary" id="link-start" onClick={start}>
            {t.linkStart}
          </button>
        </>
      )}
    </>
  );
}

// A one-screen-per-step first run, modelled on the phone setup people know.
// Signing in is required. There is no way past that step without a verified link.
export function Setup({ broker, relayOrigin, did, account, ageBand, returning, onLinked, onAgeSelected, score, onFinish }) {
  const [language, setLanguage] = useState(savedLanguage);
  const [step, setStep] = useState(returning ? (account && !ageBand ? "age" : "signin") : account ? (ageBand ? "trust" : "age") : "hello");
  const [selectedAge, setSelectedAge] = useState(null);
  const [ageError, setAgeError] = useState(false);
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
              if (!readAgeBand(linked.accountDid)) setStep("age");
              else if (returning) onFinish();
              else setStep("trust");
            }}
          />
        ) : null}
        {step === "age" ? (
          <>
            <h1>{t.ageTitle}</h1>
            <p>{t.ageBody}</p>
            <ul className="choices">
              {[
                ["under-13", t.ageUnder13],
                ["13-17", t.ageTeen],
                ["18-plus", t.ageAdult],
              ].map(([band, label]) => (
                <li key={band}>
                  <button type="button" data-age-band={band} aria-pressed={selectedAge === band}
                    onClick={() => { setSelectedAge(band); setAgeError(false); }}>
                    <span>{label}</span>{selectedAge === band ? <span aria-hidden="true">✓</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {ageError ? <p className="problem" role="alert">{t.ageSaveFailed}</p> : null}
            <button type="button" className="primary" data-age-continue disabled={!selectedAge} onClick={() => {
              if (!account || !onAgeSelected(account.accountDid, selectedAge)) { setAgeError(true); return; }
              if (returning) onFinish();
              else setStep("trust");
            }}>{t.next}</button>
          </>
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
