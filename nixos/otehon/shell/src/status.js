// Data for the shell's bottom docks (AWAI-231): the device dock on the left and
// the node dock on the right. Every value comes from a loopback service on this
// device. Nothing here reaches the network, and nothing is scanned: the ports
// below are the OS's own inventory, probed one by one.
import { useEffect, useState } from "react";

export const STATUS_ORIGIN = "http://127.0.0.1:8774";
export const ZENOH_REST_ORIGIN = "http://127.0.0.1:8000";
const PORT_POLL_MS = 5000;
const SYSTEM_POLL_MS = 5000;

// kind "http": probed with GET. kind "service": state comes from the service
// check the shell already runs. kind "internal": reserved, never probed.
export const OS_PORTS = [
  { port: 8770, service: "Media", path: "/v1/capabilities", kind: "http" },
  { port: 8771, service: "Manimani", path: "/v1/state", kind: "http" },
  { port: 8774, service: "Status", path: "/v1/system", kind: "http" },
  { port: 8000, service: "Zenoh REST", path: "/@/*/router", kind: "http" },
  { port: 7447, service: "Zenoh", kind: "service", from: "zenoh" },
  { port: 5580, service: "Matter", kind: "service", from: "matter" },
  { port: 9222, service: "Chromium DevTools", kind: "internal" },
];

export function formatKiB(kb) {
  if (!Number.isFinite(kb) || kb < 0) return "—";
  if (kb < 1024) return `${Math.round(kb)} KiB`;
  const mib = kb / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MiB`;
  return `${(mib / 1024).toFixed(1)} GiB`;
}

export function memUsedPercent(system) {
  if (!system || !Number.isFinite(system.mem_total_kb) || system.mem_total_kb <= 0) return null;
  if (!Number.isFinite(system.mem_available_kb)) return null;
  const used = system.mem_total_kb - system.mem_available_kb;
  return Math.max(0, Math.min(100, (100 * used) / system.mem_total_kb));
}

export function summarizeSystem(system) {
  if (!system) return null;
  if (!Number.isFinite(system.cpu_percent)) return null;
  const mem = memUsedPercent(system);
  if (mem === null) return null;
  return {
    cpu: `${system.cpu_percent.toFixed(1)}%`,
    mem: `${mem.toFixed(0)}% of ${formatKiB(system.mem_total_kb)}`,
  };
}

// Merges live probes with the service checks the shell already runs.
// states: {port: true|false}. services: {zenoh: bool, matter: bool}.
export function portRows(states, services = {}) {
  return OS_PORTS.map((entry) => {
    if (entry.kind === "internal") return { ...entry, state: "internal" };
    const up = entry.kind === "service" ? Boolean(services[entry.from]) : states[entry.port];
    return { ...entry, state: up ? "up" : "down" };
  });
}

function usePoll(read, ms) {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let live = true;
    const run = () => read().then(
      (next) => live && setValue(next),
      () => live && setValue(null),
    );
    run();
    const timer = setInterval(run, ms);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [read]);
  return value;
}

// One slow service must not wedge the whole row: time out and report it down.
async function probeHttp(origin, path) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 4000);
  try {
    const response = await fetch(`${origin}${path}`, { signal: control.signal });
    if (!response.ok) return false;
    return true;
  } finally {
    clearTimeout(timer);
  }
}

// Live CPU and memory from the loopback status service. Null while the
// service is unreachable, so the dock shows services without usage.
export function useSystem() {
  const [system, setSystem] = useState(null);
  useEffect(() => {
    let live = true;
    const run = () => {
      const control = new AbortController();
      const guard = setTimeout(() => control.abort(), 4000);
      return fetch(`${STATUS_ORIGIN}/v1/system`, { signal: control.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((value) => live && setSystem(value))
        .catch(() => live && setSystem(null))
        .finally(() => clearTimeout(guard));
    };
    run();
    const timer = setInterval(run, SYSTEM_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return system;
}

// Reachability of the shell's own HTTP ports. Service and internal rows are
// resolved by portRows instead of probed here.
export function useHttpPorts() {
  const [states, setStates] = useState({});
  useEffect(() => {
    let live = true;
    const run = async () => {
      const next = {};
      for (const entry of OS_PORTS) {
        if (entry.kind !== "http") continue;
        const origin = entry.port === 8000 ? ZENOH_REST_ORIGIN : `http://127.0.0.1:${entry.port}`;
        try {
          next[entry.port] = await probeHttp(origin, entry.path);
        } catch {
          next[entry.port] = false;
        }
      }
      if (live) setStates(next);
    };
    run();
    const timer = setInterval(run, PORT_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return states;
}

// Routers this device's Zenoh router has seen, for the hosts panel. Unknown
// entries are counted, not parsed: the shape is the router's business.
export function useZenohRouters(enabled) {
  return usePoll(async () => {
    if (!enabled) return null;
    const response = await fetch(`${ZENOH_REST_ORIGIN}/@/*/router`);
    if (!response.ok) return null;
    const body = await response.json();
    return Array.isArray(body) ? body.length : null;
  }, PORT_POLL_MS);
}
