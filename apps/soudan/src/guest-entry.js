// Self-contained restricted-wasm-v1 guest bootstrap (compiled into dist/guest.html).
// Receives MessagePort via { protocol: 'kotoba.client.host.v1' } from mountRestrictedClientApp,
// persists exclusively via kotoba.client.local.v1 (zero localStorage access), and routes external
// operations strictly through kotoba.client.operation.v1.

import {pickLocale, translator} from './messages.js';
import {CATEGORIES, JURISDICTIONS, LIMITS, draftDisplayTitle, draftProblems, assembleMemo, recipientProblems} from './model.js';
import {SEND_SELECTOR} from './operations.js';
import {DEFAULT_INFERENCE_CONFIG} from './inference.js';
import {createSemanticStore} from './semantic.js';
import {CLIENT_HOST_PROTOCOL, createRestrictedPortClient} from './storage.js';

export function bootRestrictedGuest({win = globalThis, doc = globalThis.document} = {}) {
  const locale = pickLocale(win?.navigator?.languages);
  const t = translator(locale);
  if (doc?.documentElement) doc.documentElement.lang = locale;

  let portClient = null;
  let revision = 0;
  let store = null;

  const $ = id => doc?.getElementById?.(id) ?? null;
  const say = msg => { const el = $('status'); if (el) el.textContent = msg; };

  function makeBroker() {
    return {
      operations: [SEND_SELECTOR],
      invoke: (selector, payload) => {
        if (!portClient) throw Error('host-port-unavailable');
        return portClient.invokeOperation(selector, payload);
      },
    };
  }

  function initStore(client) {
    portClient = client;
    store = createSemanticStore({
      locale,
      broker: makeBroker(),
      inferenceConfig: DEFAULT_INFERENCE_CONFIG,
      route: 'web-device-save',
      onPersist: async nextState => {
        try {
          const saved = await portClient.write({expectedRevision: revision, data: nextState});
          revision = saved.revision;
          return {ok: true};
        } catch (e) {
          if (e?.code === 'state-conflict') {
            try {
              const latest = await portClient.read();
              revision = latest.revision;
              return {ok: false, conflict: true, code: 'state-conflict', reloadedState: latest.data};
            } catch {
              return {ok: false, conflict: true, code: 'state-conflict'};
            }
          }
          return {ok: false, conflict: false, code: e?.code ?? 'storage-unavailable'};
        }
      },
    });
    return store;
  }

  function render() {
    const view = $('view');
    if (!view || !store) return;
    const rec = store.getActiveDraft();
    const state = store.getState();
    view.replaceChildren();
    const h = doc.createElement('h2');
    h.textContent = draftDisplayTitle(rec, Math.max(0, state.drafts.findIndex(d => d.id === rec.id)), t);
    const intro = doc.createElement('p');
    intro.className = 'muted';
    intro.textContent = t('intro');
    const summaryLabel = doc.createElement('label');
    summaryLabel.textContent = t('field.summary');
    const summaryInput = doc.createElement('textarea');
    summaryInput.value = rec.draft.summary;
    summaryInput.maxLength = LIMITS.summary;
    const saveBtn = doc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.dataset.submit = 'true';
    saveBtn.textContent = t('save');
    saveBtn.addEventListener('click', async () => {
      const res = await store.execute('soudan.draft.update', {
        id: rec.id,
        patch: {...rec.draft, summary: summaryInput.value},
      }, {actor: {kind: 'human'}});
      if (res.ok) say(t('saved'));
      else if (res.conflict) say(t('conflict'));
      else say(t('saveFailed', {code: res.error ?? 'unknown'}));
      render();
    });
    view.append(h, intro, summaryLabel, summaryInput, saveBtn);
  }

  async function attachPort(port) {
    const client = createRestrictedPortClient(port);
    initStore(client);
    try {
      const loaded = await client.read();
      revision = loaded.revision;
      store.setState(loaded.data);
      say(t('env.line', {runtime: 'restricted-wasm-v1'}));
    } catch (e) {
      say(t('saveFailed', {code: e?.code ?? 'unavailable'}));
    }
    render();
    return {store, client};
  }

  const onMessage = event => {
    if (event?.data?.protocol === CLIENT_HOST_PROTOCOL && event.ports?.[0]) {
      win.removeEventListener('message', onMessage);
      attachPort(event.ports[0]);
    }
  };
  if (typeof win?.addEventListener === 'function') {
    win.addEventListener('message', onMessage);
  }

  return Object.freeze({
    attachPort,
    getStore: () => store,
    getClient: () => portClient,
    meta: Object.freeze({categories: CATEGORIES, jurisdictions: Object.keys(JURISDICTIONS), draftProblems, assembleMemo, recipientProblems}),
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('guest-root')) {
  bootRestrictedGuest({win: window, doc: document});
}
