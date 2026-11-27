// Device-local persistence helpers for Bengoshi (network.itonami.bengoshi).
// Never swallows host write errors or browser localStorage exceptions (e.g. QuotaExceededError, SecurityError).

export const STORAGE_SCHEMA = 'awai.shell.host.v1';
export const DEFAULT_APP_ID = 'network.itonami.bengoshi';
export const STORAGE_KEY = `${STORAGE_SCHEMA}:${DEFAULT_APP_ID}`;

export function classifyStorageError(err) {
  const name = err?.name || '';
  const code = err?.code || '';
  const rawMessage = err?.message || String(err || 'unknown-storage-error');

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

  if (code === 'state-conflict') {
    return { code: 'state-conflict', errorName: code, rawMessage };
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
 * Persist state via Awai Shell host (preferred) or browser localStorage fallback
 * when atomic Web Locks are unavailable.
 *
 * Always resolves to `{ ok: true, revision, via }` on success or
 * `{ ok: false, error, code, message, via }` on ANY failure.
 * Never swallows host write errors or localStorage exceptions.
 */
export async function persistLocalState({
  host,
  storage = globalThis.localStorage,
  revision = 0,
  state,
  storageKey = STORAGE_KEY,
} = {}) {
  try {
    if (!host || typeof host.write !== 'function') {
      throw Object.assign(new Error('host-write-unavailable'), { code: 'storage-unavailable' });
    }
    const next = await host.write({ expectedRevision: revision, data: state });
    if (!next || !Number.isSafeInteger(next.revision)) {
      throw Object.assign(new Error('invalid-host-write-response'), { code: 'storage-write-failed' });
    }
    return { ok: true, revision: next.revision, via: 'host' };
  } catch (hostErr) {
    if (hostErr?.code === 'atomic-write-unavailable') {
      try {
        if (!storage || typeof storage.setItem !== 'function') {
          const missingErr = Object.assign(new Error('localStorage is unavailable'), {
            name: 'SecurityError',
            code: 'storage-unavailable',
          });
          const info = classifyStorageError(missingErr);
          return {
            ok: false,
            error: missingErr,
            code: info.code,
            message: info.rawMessage,
            via: 'localStorage',
          };
        }
        const nextRevision = revision + 1;
        const payload = JSON.stringify({
          schema: STORAGE_SCHEMA,
          revision: nextRevision,
          data: state,
        });
        storage.setItem(storageKey, payload);
        return { ok: true, revision: nextRevision, via: 'localStorage' };
      } catch (lsErr) {
        const info = classifyStorageError(lsErr);
        return {
          ok: false,
          error: lsErr,
          code: info.code,
          message: info.rawMessage,
          via: 'localStorage',
        };
      }
    }

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
