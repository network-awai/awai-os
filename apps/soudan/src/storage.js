// Opaque-origin safe storage and restricted-wasm-v1 host bridge for Soudan.
// - Inside canonical mountRestrictedClientApp (srcdoc, sandbox="allow-scripts", opaque origin):
//   communicates strictly over the host-provided MessagePort using kotoba.client.local.v1
//   (storage.get / conditional versioned storage.put / device.save) and kotoba.client.operation.v1.
//   Uses host-enforced CAS (ifAbsent / ifVersion) so concurrent writes never silently lose updates.
//   Never touches window.localStorage.
// - Standalone Web / Tauri: wraps awai.shell.host.v1 while safely guarding localStorage
//   access so opaque-origin environments never throw during startup.

export const CLIENT_LOCAL_PROTOCOL = 'kotoba.client.local.v1';
export const CLIENT_OPERATION_PROTOCOL = 'kotoba.client.operation.v1';
export const CLIENT_HOST_PROTOCOL = 'kotoba.client.host.v1';
export const HOST_STATE_STORE = 'soudan-state';
export const HOST_STATE_KEY = 'state-v2';

export function safeBrowserStorage(win = globalThis) {
  try {
    const ls = win?.localStorage;
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') return ls;
  } catch {
    // Opaque origin (sandbox="allow-scripts" without allow-same-origin) throws SecurityError.
  }
  return null;
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
  };
}

// Create a host-port RPC client for canonical mountRestrictedClientApp guests.
export function createRestrictedPortClient(port) {
  if (!port || typeof port.postMessage !== 'function') throw TypeError('message-port-required');
  let reqSeq = 0;
  const pending = new Map();

  port.onmessage = event => {
    const msg = event?.data;
    if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string') return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg);
    else entry.reject(Object.assign(Error(msg.error ?? 'host-call-failed'), {code: msg.error ?? 'host-call-failed'}));
  };
  if (typeof port.start === 'function') port.start();

  function nextId(prefix) {
    reqSeq += 1;
    return `${prefix}-${reqSeq}`;
  }

  async function callLocal(call, args) {
    const id = nextId('loc');
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve: msg => resolve(msg.result), reject});
      port.postMessage({protocol: CLIENT_LOCAL_PROTOCOL, id, call, args});
    });
  }

  async function invokeOperation(selector, payload) {
    const id = nextId('op');
    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve: msg => resolve(Object.hasOwn(msg, 'result') ? msg.result : msg),
        reject,
      });
      port.postMessage({protocol: CLIENT_OPERATION_PROTOCOL, id, selector, payload});
    });
  }

  return Object.freeze({
    info: () => Object.freeze({schema: 'kotoba.client.local.v1', runtime: 'restricted-wasm-v1'}),
    async initialize() {},
    async read() {
      const res = await callLocal('storage.get', {store: HOST_STATE_STORE, key: HOST_STATE_KEY});
      if (!res || res.value == null) return {schema: 'awai.shell.host.v1', revision: 0, data: null};
      const raw = res.value instanceof Uint8Array
        ? new TextDecoder().decode(res.value)
        : typeof res.value === 'string' ? res.value : JSON.stringify(res.value);
      const parsed = JSON.parse(raw);
      // Authoritative revision comes from the canonical host's monotonic storage version.
      const hostVersion = Number.isSafeInteger(res.version) && res.version >= 1
        ? res.version
        : (Number.isSafeInteger(parsed?.revision) ? parsed.revision : 1);
      return {schema: 'awai.shell.host.v1', revision: hostVersion, data: parsed?.data ?? parsed};
    },
    async write({expectedRevision, data}) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw Object.assign(Error('invalid-revision'), {code: 'invalid-revision'});
      }
      const next = {schema: 'awai.shell.host.v1', revision: expectedRevision + 1, data};
      const bytes = new TextEncoder().encode(JSON.stringify(next));
      // P1 #3: Single atomic conditional write enforced by canonical host (ifAbsent / ifVersion).
      const putArgs = expectedRevision === 0
        ? {store: HOST_STATE_STORE, key: HOST_STATE_KEY, value: bytes, ifAbsent: true}
        : {store: HOST_STATE_STORE, key: HOST_STATE_KEY, value: bytes, ifVersion: expectedRevision};
      try {
        const putRes = await callLocal('storage.put', putArgs);
        const committedVersion = Number.isSafeInteger(putRes?.version) ? putRes.version : expectedRevision + 1;
        return {schema: 'awai.shell.host.v1', revision: committedVersion, data};
      } catch (err) {
        if (err?.code === 'version-conflict' || err?.code === 'key-exists') {
          throw Object.assign(Error('state-conflict'), {code: 'state-conflict'});
        }
        throw err;
      }
    },
    async saveFile({name, type, bytes}) {
      return callLocal('device.save', {name, type, value: bytes});
    },
    invokeOperation,
  });
}

// Standalone wrapper around packages/awai-shell/host.js that never throws on opaque origin.
export function createStandaloneSafeHost({createHostFn, appId, win = globalThis}) {
  const storage = safeBrowserStorage(win);
  if (!storage) {
    return Object.freeze({
      info: () => Object.freeze({schema: 'awai.shell.host.v1', appId, runtime: 'opaque-origin-memory'}),
      async initialize() {},
      async read() { return {schema: 'awai.shell.host.v1', revision: 0, data: null}; },
      async write() { throw Object.assign(Error('storage-unavailable'), {code: 'storage-unavailable'}); },
    });
  }
  return createHostFn({appId, storage, locks: win?.navigator?.locks, native: win?.__TAURI__?.core});
}
