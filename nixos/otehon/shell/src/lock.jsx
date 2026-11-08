// The lock screen. While it shows, the shell renders no app, thread or account data.
import { useEffect, useRef, useState } from "react";
import { unlockMessage, verifyUnlock } from "./identity/lock.js";
import { accountAddress } from "./trust.js";

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
        <h1>Locked</h1>
        <p className="account-id">{lock.accountDid}</p>
        {message ? (
          <>
            {window.ethereum ? (
              <button type="button" className="primary" id="unlock-provider" onClick={useProvider}>
                Unlock with Your Wallet
              </button>
            ) : null}
            <label className="field">
              <span>Sign this message with the wallet of this account (personal_sign):</span>
              <textarea id="unlock-message" readOnly rows={7} value={message} />
            </label>
            <label className="field">
              <span>Signature</span>
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
              Unlock
            </button>
          </>
        ) : (
          <p className="muted">
            This account signed in with a passkey. A passkey cannot unlock this device yet, so the only way on is to
            erase this device's data and sign in again.
          </p>
        )}
        {refusal ? (
          <p className="problem" data-unlock-error={refusal}>
            Not unlocked: {refusal}
          </p>
        ) : null}
        {erasing ? (
          <button type="button" className="secondary" id="lock-erase-confirm" onClick={onErase}>
            Erase Messages and Sign-In on This Device
          </button>
        ) : (
          <button type="button" className="secondary" id="lock-erase" onClick={() => setErasing(true)}>
            Erase This Device's Data Instead
          </button>
        )}
      </main>
    </div>
  );
}
