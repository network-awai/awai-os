// Device-local persistence helpers for Bengoshi (network.itonami.bengoshi).
// Never swallows host write errors or silently bypasses Web Locks mutual exclusion.

export const STORAGE_SCHEMA = 'awai.shell.host.v1';
export const DEFAULT_APP_ID = 'network.itonami.bengoshi';
export const STORAGE_KEY = `${STORAGE_SCHEMA}:${DEFAULT_APP_ID}`;

export function classifyStorageError(err) {
  const name = err?.name || '';
  const code = err?.code || '';
  const rawMessage = err?.message || String(err || 'unknown-storage-error');

  if (code === 'atomic-write-unavailable' || code === 'lock-unavailable') {
    return { code: 'atomic-write-unavailable', errorName: name || code || 'HostError', rawMessage };
  }

  if (code === 'state-conflict') {
    return { code: 'state-conflict', errorName: code, rawMessage };
  }

  if (code === 'unreadable-state') {
    return { code: 'unreadable-state', errorName: name || code || 'HostError', rawMessage };
  }

  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 'quota-exceeded' ||
    code === 'data-too-large' ||
    /quota|exceeded|full|too-large/i.test(rawMessage)
  ) {
    return { code: 'quota-exceeded', errorName: name || code || 'QuotaExceededError', rawMessage };
  }

  if (
    name === 'SecurityError' ||
    code === 'storage-unavailable' ||
    /security|denied|disabled|unavailable/i.test(rawMessage)
  ) {
    return { code: 'storage-unavailable', errorName: name || code || 'SecurityError', rawMessage };
  }

  return {
    code: code || name || 'storage-write-failed',
    errorName: name || code || 'Error',
    rawMessage,
  };
}

export function isStoragePersistError(err) {
  return Boolean(err && (err.code === 'storage-persist-failed' || err.persistResult?.ok === false));
}

/**
 * Persist state strictly through the Awai Shell host's atomic, Web-Locks-serialized
 * compare-and-swap `host.write({ expectedRevision, data })`.
 *
 * Fails closed whenever exclusive locking (`atomicWrite` / Web Locks) is unavailable
 * or revisions conflict — never falls back to an unguarded raw `localStorage.setItem`
 * that could silently overwrite another tab or writer.
 *
 * Always resolves to `{ ok: true, revision, via: 'host' }` on success or
 * `{ ok: false, error, code, message, via: 'host' }` on ANY failure.
 */
export async function persistLocalState({
  host,
  revision = 0,
  state,
} = {}) {
  try {
    if (!host || typeof host.write !== 'function') {
      throw Object.assign(new Error('host-write-unavailable'), { code: 'storage-unavailable' });
    }
    const caps = typeof host.info === 'function' ? host.info()?.capabilities : null;
    if (caps && caps.atomicWrite === false) {
      throw Object.assign(new Error('atomic-write-unavailable'), { code: 'atomic-write-unavailable' });
    }
    const next = await host.write({ expectedRevision: revision, data: state });
    if (!next || !Number.isSafeInteger(next.revision) || next.revision <= revision) {
      throw Object.assign(new Error('invalid-host-write-response'), { code: 'storage-write-failed' });
    }
    return { ok: true, revision: next.revision, via: 'host' };
  } catch (hostErr) {
    const info = classifyStorageError(hostErr);
    return {
      ok: false,
      error: hostErr,
      code: info.code,
      message: info.rawMessage,
      via: 'host',
    };
  }
}
