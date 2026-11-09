// Display screen of the Otehon shell (AWAI-168). It drives the loopback
// otehon-display service and shows an honest empty state when no backlight
// device exists, as in the check VM.
import { useEffect, useState } from "react";
import { brightnessError, setBrightness, useDisplayStatus } from "./display.js";

const ERROR_TEXT = {
  "bad-brightness": "Brightness is 0 to 100.",
  "bad-json": "The request was not understood.",
  "no-adapter": "This device has no brightness control.",
  "brightness-failed": "The brightness did not change.",
  unreachable: "The display service is not reachable.",
};

function problem(error) {
  return <p className="net-error">{ERROR_TEXT[error] ?? "Something went wrong."}</p>;
}

export function DisplayPanel() {
  const status = useDisplayStatus();
  const [level, setLevel] = useState(80);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (typeof status?.brightness === "number") setLevel(status.brightness);
  }, [status?.brightness]);

  const invalid = brightnessError(level);

  const apply = async (value) => {
    if (invalid || busy) return;
    setBusy(true);
    setResult(null);
    const done = await setBrightness(value);
    setBusy(false);
    setResult(done.ok ? null : done);
    if (done.ok) setLevel(done.brightness);
  };

  return (
    <main className="chat net-view" data-net="display">
      <div className="net-body">
        <h1>Display</h1>
        {!status ? <p className="muted">Checking…</p> : null}
        {status?.error ? problem(status.error) : null}
        {status && !status.error && !status.available ? (
          <p className="muted">This device has no brightness control. The last setting stays saved.</p>
        ) : null}
        {status?.available ? (
          <>
            <p className="muted" data-net-device={status.device ?? "unknown"}>
              {status.device ?? "Output"} · Brightness {status.brightness}
            </p>
            <div className="net-form">
              <label>
                Brightness
                <input
                  aria-label="Brightness"
                  type="range"
                  min="0"
                  max="100"
                  value={level}
                  disabled={busy}
                  onChange={(event) => setLevel(Number(event.target.value))}
                  onMouseUp={() => apply(level)}
                  onTouchEnd={() => apply(level)}
                />
              </label>
              <button type="button" className="primary" disabled={invalid !== null || busy} onClick={() => apply(level)}>
                {busy ? "Setting…" : "Set brightness"}
              </button>
            </div>
            {result && !result.ok ? problem(result.error) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
