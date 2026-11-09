// Sound screen of the Otehon shell (AWAI-168). It drives the loopback
// otehon-sound service and shows an honest empty state when no output
// device exists, as in the check VM.
import { useEffect, useState } from "react";
import { setMuted, setVolume, useSoundStatus, volumeError } from "./sound.js";

const ERROR_TEXT = {
  "bad-volume": "Volume is 0 to 100.",
  "bad-mute": "The switch was not understood.",
  "bad-json": "The request was not understood.",
  "no-adapter": "This device has no sound output.",
  "no-session": "Nobody is signed in to play sound.",
  "volume-failed": "The volume did not change.",
  "mute-failed": "The switch did not change.",
  unreachable: "The sound service is not reachable.",
};

function problem(error) {
  return <p className="net-error">{ERROR_TEXT[error] ?? "Something went wrong."}</p>;
}

export function SoundPanel() {
  const status = useSoundStatus();
  const [level, setLevel] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (typeof status?.volume === "number") setLevel(status.volume);
  }, [status?.volume]);

  const invalid = volumeError(level);

  const apply = async (volume) => {
    if (invalid || busy) return;
    setBusy(true);
    setResult(null);
    const done = await setVolume(volume);
    setBusy(false);
    setResult(done.ok ? null : done);
    if (done.ok) setLevel(done.volume);
  };

  const flip = async () => {
    if (busy || typeof status?.muted !== "boolean") return;
    setBusy(true);
    setResult(null);
    const done = await setMuted(!status.muted);
    setBusy(false);
    setResult(done.ok ? null : done);
  };

  return (
    <main className="chat net-view" data-net="sound">
      <div className="net-body">
        <h1>Sound</h1>
        {!status ? <p className="muted">Checking…</p> : null}
        {status?.error ? problem(status.error) : null}
        {status && !status.error && !status.available ? (
          <p className="muted">This device has no sound output. The last setting stays saved.</p>
        ) : null}
        {status?.available ? (
          <>
            <p className="muted" data-net-sink={status.sink ?? "unknown"}>
              {status.sink ?? "Output"} · {status.muted ? "Muted" : `Volume ${status.volume}`}
            </p>
            <div className="net-form">
              <label>
                Volume
                <input
                  aria-label="Volume"
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
                {busy ? "Setting…" : "Set volume"}
              </button>
              <button type="button" disabled={busy} onClick={flip}>
                {status.muted ? "Unmute" : "Mute"}
              </button>
            </div>
            {result && !result.ok ? problem(result.error) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
