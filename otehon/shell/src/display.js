// Display state for the Otehon shell (AWAI-168): screen brightness
// through the loopback otehon-display service. Nothing here touches
// hardware directly, and the last setting is restored by the service.
import { useCallback, useEffect, useState } from "react";

export const DISPLAY_ORIGIN = "http://127.0.0.1:8776";
const POLL_MS = 5000;

// Mirrors the service-side validation so the controls stay honest.
export function brightnessError(value) {
  if (typeof value === "boolean" || !Number.isInteger(value)) return "bad-brightness";
  if (value < 0 || value > 100) return "bad-brightness";
  return null;
}

async function get(path) {
  const control = new AbortController();
  const guard = setTimeout(() => control.abort(), 4000);
  try {
    const response = await fetch(`${DISPLAY_ORIGIN}${path}`, { signal: control.signal });
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
    const response = await fetch(`${DISPLAY_ORIGIN}${path}`, {
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

export function useDisplayStatus() {
  const read = useCallback(() => get("/v1/status"), []);
  return usePoll(read, POLL_MS);
}

export const setBrightness = (brightness) => post("/v1/brightness", { brightness });
