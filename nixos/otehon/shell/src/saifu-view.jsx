import { useEffect, useRef, useState } from "react";
import { mountSaifuPackage } from "./saifu-package.js";
import { unpackSaifuBundle } from "./saifu-bundle.js";
import { operationMinimum } from "./trust.js";

export function SaifuView({ broker, score, onAccount }) {
  const container = useRef(null);
  const latestScore = useRef(score);
  latestScore.current = score;
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let disposed = false;
    let mounted = null;
    if (!SAIFU_EMBEDDED) { setStatus("not-installed"); return undefined; }
    (async () => {
      try {
        const payload = unpackSaifuBundle(SAIFU_EMBEDDED.bundle, SAIFU_EMBEDDED.pins);
        mounted = await mountSaifuPackage({ ...payload, container: container.current, broker, getScore: () => latestScore.current });
        if (disposed) mounted.close();
        else setStatus("ready");
      } catch { if (!disposed) setStatus("unavailable"); }
    })();
    return () => { disposed = true; mounted?.close(); };
  }, [broker]);

  return (
    <main className="chat account-view">
      <div className="account-body">
        <h1>Saifu</h1>
        {status === "not-installed" ? <p role="status">署名済みの Saifu がまだインストールされていません。</p> : null}
        {status === "unavailable" ? <p role="alert">Saifu の検証または起動に失敗しました。</p> : null}
        {status === "checking" ? <p role="status">Saifu を確認しています…</p> : null}
        {status === "ready" && score < operationMinimum("saifu", "read-chain-state") ? (
          <p>残高の確認には Trust {operationMinimum("saifu", "read-chain-state")} が必要です。 <button type="button" onClick={onAccount}>アカウントを確認</button></p>
        ) : null}
        <div ref={container} className="saifu-container" />
      </div>
    </main>
  );
}
