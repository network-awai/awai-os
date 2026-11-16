// The lock screen. While it shows, the shell renders no app, thread or account data.
import { useEffect, useRef, useState } from "react";
import { unlockMessage, verifyUnlock } from "./identity/lock.js";
import { accountAddress } from "./trust.js";
import { useText } from "./i18n.js";

const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];

// Calls onIdle after `ms` with no input, while `active` is true.
export function useIdle(active, ms, onIdle) {
  const callback = useRef(onIdle);
  callback.current = onIdle;
  useEffect(() => {
    if (!active) return undefined;
    let timer = setTimeout(() => callback.current(), ms);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callback.current(), ms);
    };
    for (const name of ACTIVITY) window.addEventListener(name, reset, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      for (const name of ACTIVITY) window.removeEventListener(name, reset, { capture: true });
    };
  }, [active, ms]);
}

const toHex = (text) => Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("");

export function LockScreen({ lock, onUnlock, onErase }) {
  const t = useText();
  const address = accountAddress(lock.accountDid);
  const message = address
    ? unlockMessage({ address, device: lock.device, nonce: lock.nonce, issuedAt: lock.issuedAt })
    : null;
  const [signature, setSignature] = useState("");
  const [refusal, setRefusal] = useState(null);
  const [erasing, setErasing] = useState(false);

  const attempt = (value) => {
    setRefusal(null);
    try {
      verifyUnlock(lock, value);
      onUnlock();
    } catch (error) {
      setRefusal(error.message);
    }
  };

  const useProvider = async () => {
    setRefusal(null);
    try {
      attempt(await window.ethereum.request({ method: "personal_sign", params: [`0x${toHex(message)}`, address] }));
    } catch (error) {
      setRefusal(error.message);
    }
  };

  return (
    <div className="setup">
      <main className="setup-card" data-lock-screen>
        <h1>{t("lockScreen.title")}</h1>
        <p className="account-id">{lock.accountDid}</p>
        {message ? (
          <>
            {window.ethereum ? (
              <button type="button" className="primary" id="unlock-provider" onClick={useProvider}>
                {t("lockScreen.useWallet")}
              </button>
            ) : null}
            <label className="field">
              <span>{t("lockScreen.sign")}</span>
              <textarea id="unlock-message" readOnly rows={7} value={message} />
            </label>
            <label className="field">
              <span>{t("lockScreen.signature")}</span>
              <input
                id="unlock-signature"
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
              id="unlock-verify"
              disabled={!signature.trim()}
              onClick={() => attempt(signature)}
            >
              {t("lockScreen.unlock")}
            </button>
          </>
        ) : (
          <p className="muted">{t("lockScreen.passkey")}</p>
        )}
        {refusal ? (
          <p className="problem" role="alert" data-unlock-error={refusal}>
            {t("lockScreen.refused", { reason: refusal })}
          </p>
        ) : null}
        {erasing ? (
          <button type="button" className="secondary" id="lock-erase-confirm" onClick={onErase}>
            {t("lockScreen.eraseConfirm")}
          </button>
        ) : (
          <button type="button" className="secondary" id="lock-erase" onClick={() => setErasing(true)}>
            {t("lockScreen.erase")}
          </button>
        )}
      </main>
    </div>
  );
}
