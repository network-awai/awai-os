// Sound state for the Otehon shell (AWAI-168): system volume and mute
// through the loopback otehon-sound service. Nothing here touches audio
// hardware directly, and the last setting is restored by the service.
import { useCallback, useEffect, useState } from "react";

export const SOUND_ORIGIN = "http://127.0.0.1:8775";
const POLL_MS = 5000;

// Mirrors the service-side validation so the controls stay honest.
export function volumeError(value) {
  if (typeof value === "boolean" || !Number.isInteger(value)) return "bad-volume";
  if (value < 0 || value > 100) return "bad-volume";
  return null;
}

export function muteError(value) {
  if (value !== true && value !== false) return "bad-mute";
  return null;
}

async function get(path) {
  const control = new AbortController();
  const guard = setTimeout(() => control.abort(), 4000);
  try {
    const response = await fetch(`${SOUND_ORIGIN}${path}`, { signal: control.signal });
    if (!response.ok) return { error: `http-${response.status}` };
    return await response.json();
  } catch {
    return { error: "unreachable" };
  } finally {
    clearTimeout(guard);
  }
}

async function post(path, body) {
  const control = new AbortController();
  const guard = setTimeout(() => control.abort(), 15000);
  try {
    const response = await fetch(`${SOUND_ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: control.signal,
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: value.error ?? `http-${response.status}` };
    return { ok: true, ...value };
  } catch {
    return { ok: false, error: "unreachable" };
  } finally {
    clearTimeout(guard);
  }
}

function usePoll(read, ms) {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let live = true;
    const run = () => read().then((next) => live && setValue(next));
    run();
    const timer = setInterval(run, ms);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [read]);
  return value;
}

export function useSoundStatus() {
  const read = useCallback(() => get("/v1/status"), []);
  return usePoll(read, POLL_MS);
}

export const setVolume = (volume) => post("/v1/volume", { volume });
export const setMuted = (on) => post("/v1/mute", { on });
