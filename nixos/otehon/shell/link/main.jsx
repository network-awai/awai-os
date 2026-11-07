import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  RP_ID,
  SESSION_MS,
  compressP256,
  confirmationCode,
  fromBase64Url,
  parseLinkFragment,
  passkeyChallenge,
  sealResponse,
  toBase64Url,
} from "../src/identity/link.js";
import { signWithProvider } from "../src/identity/wallet.js";
import { createBroker, deliverApproval, phoneOperations } from "../src/runtime.js";
import "./link.css";

const relayOrigin = RELAY_ORIGIN;
const PASSKEY_KEY = "awai.passkey.v1";
const DEVICES_KEY = "awai.devices.v1";

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

async function registerPasskey() {
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { id: RP_ID, name: "Awai Network" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(32)),
        name: "Awai account",
        displayName: "Awai account",
      },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    },
  });
  const spki = new Uint8Array(credential.response.getPublicKey());
  const saved = {
    id: toBase64Url(new Uint8Array(credential.rawId)),
    publicKey: toBase64Url(compressP256(spki.slice(-65))),
  };
  localStorage.setItem(PASSKEY_KEY, JSON.stringify(saved));
  return saved;
}

async function approveWithPasskey(request) {
  const saved = readJson(PASSKEY_KEY, null) ?? (await registerPasskey());
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  const assertion = await navigator.credentials.get({
    publicKey: {
      rpId: RP_ID,
      challenge: passkeyChallenge({ device: request.device, nonce: request.nonce, expiresAt }),
      allowCredentials: [{ type: "public-key", id: fromBase64Url(saved.id) }],
      userVerification: "required",
    },
  });
  return {
    method: "passkey",
    publicKey: saved.publicKey,
    authenticatorData: toBase64Url(new Uint8Array(assertion.response.authenticatorData)),
    clientDataJSON: toBase64Url(new Uint8Array(assertion.response.clientDataJSON)),
    signature: toBase64Url(new Uint8Array(assertion.response.signature)),
    expiresAt,
  };
}

function approveWithWallet(request) {
  return signWithProvider(window.ethereum, request);
}

function readRequest() {
  try {
    return { request: parseLinkFragment(location.hash) };
  } catch (error) {
    return { problem: error.message };
  }
}

function LinkPage() {
  const { request, problem } = useMemo(readRequest, []);
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState("ready");
  const [error, setError] = useState(null);
  const broker = useMemo(() => (request ? createBroker("index.html", phoneOperations(relayOrigin)) : null), [request]);

  const approve = async (sign) => {
    setError(null);
    setState("working");
    try {
      const response = await sign(request);
      const sealed = await sealResponse(request, response);
      await deliverApproval(broker, relayOrigin, request.topic, sealed);
      localStorage.setItem(
        DEVICES_KEY,
        JSON.stringify([
          ...readJson(DEVICES_KEY, []).filter((device) => device.did !== request.device),
          { did: request.device, linkedAt: new Date().toISOString() },
        ]),
      );
      setState("done");
    } catch (caught) {
      setError(/not approved/.test(caught.message) ? "Nothing was sent." : "This could not be completed. Try again.");
      setState("ready");
    }
  };

  if (!request) {
    return (
      <main>
        <h1>This link can't be used</h1>
        <p data-link-problem={problem}>
          {problem === "request-expired" ? "The code expired. " : ""}Show a new code on your device and scan it again.
        </p>
      </main>
    );
  }
  if (state === "done") {
    return (
      <main data-link-done>
        <h1>Device linked</h1>
        <p>You can return to your device. Your linked devices on this phone:</p>
        <ul className="devices">
          {readJson(DEVICES_KEY, []).map((device) => (
            <li key={device.did}>{device.did}</li>
          ))}
        </ul>
      </main>
    );
  }
  return (
    <main>
      <h1>Link this device?</h1>
      <p>Approve only if you are setting up this device yourself.</p>
      <dl>
        <dt>Device</dt>
        <dd className="did">{request.device}</dd>
        <dt>Code</dt>
        <dd className="code" data-link-code>
          {confirmationCode(request)}
        </dd>
      </dl>
      <label className="confirm">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>My device shows the same code</span>
      </label>
      <button
        type="button"
        className="primary"
        data-approve="passkey"
        disabled={!confirmed || state === "working"}
        onClick={() => approve(approveWithPasskey)}
      >
        Approve with Passkey
      </button>
      <button
        type="button"
        className="secondary"
        data-approve="wallet"
        disabled={!confirmed || state === "working" || !window.ethereum}
        onClick={() => approve(approveWithWallet)}
      >
        Approve with Wallet
      </button>
      {window.ethereum ? null : <p className="muted">To use a wallet, open this page in your wallet's browser.</p>}
      {error ? <p className="problem">{error}</p> : null}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<LinkPage />);
