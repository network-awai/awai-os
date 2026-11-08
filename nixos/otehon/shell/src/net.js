// Network setup state for the Otehon shell (AWAI-168): Wi-Fi and Bluetooth
// through the loopback otehon-net service. Nothing here touches the network
// directly, and nothing is scanned beyond the OS's own adapters.
import { useCallback, useEffect, useState } from "react";

export const NET_ORIGIN = "http://127.0.0.1:8773";
const POLL_MS = 5000;
const SCAN_POLL_MS = 15000;

// Mirrors the service-side validation so the buttons stay honest.
export function ssidError(value) {
  if (typeof value !== "string") return "bad-ssid";
  const raw = new TextEncoder().encode(value);
  if (!raw.length || raw.length > 32) return "bad-ssid";
  if (/[\x00-\x1f]/.test(value)) return "bad-ssid";
  return null;
}

export function pskError(value) {
  if (value === "" || value == null) return null;
  if (typeof value !== "string") return "bad-psk";
  if (/^[0-9a-fA-F]{64}$/.test(value)) return null;
  if (value.length >= 8 && value.length <= 63) return null;
  return "bad-psk";
}

export function macError(value) {
  if (typeof value !== "string" || !/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(value)) return "bad-mac";
  return null;
}

export function nameError(value) {
  if (typeof value !== "string" || !value || value.length > 128) return "bad-name";
  if (/[\x00-\x1f]/.test(value)) return "bad-name";
  return null;
}

async function get(path) {
  const control = new AbortController();
  const guard = setTimeout(() => control.abort(), 4000);
  try {
    const response = await fetch(`${NET_ORIGIN}${path}`, { signal: control.signal });
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
  const guard = setTimeout(() => control.abort(), 35000);
  try {
    const response = await fetch(`${NET_ORIGIN}${path}`, {
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

export function useNetStatus() {
  const read = useCallback(() => get("/v1/status"), []);
  return usePoll(read, POLL_MS);
}

export function useWifiNetworks(running) {
  const read = useCallback(() => (running ? get("/v1/wifi/networks") : Promise.resolve(null)), [running]);
  return usePoll(read, SCAN_POLL_MS);
}

export function useWifiKnown(running) {
  const read = useCallback(() => (running ? get("/v1/wifi/known") : Promise.resolve(null)), [running]);
  return usePoll(read, SCAN_POLL_MS);
}

export function useBluetoothDevices(running) {
  const read = useCallback(() => (running ? get("/v1/bluetooth/devices") : Promise.resolve(null)), [running]);
  return usePoll(read, POLL_MS);
}

export const joinWifi = (ssid, psk) => post("/v1/wifi/join", psk ? { ssid, psk } : { ssid });
export const forgetWifi = (name) => post("/v1/wifi/forget", { name });
export const setBluetoothPower = (on) => post("/v1/bluetooth/power", { on });
export const pairBluetooth = (mac) => post("/v1/bluetooth/pair", { mac });
