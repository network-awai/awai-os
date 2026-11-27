import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {
  CLIENT_STORAGE_CONFORMANCE_SCHEMA, createClientConsentHost, createClientHostLocal,
  createClientOperationBroker, createEncryptedClientStorageBackend, mountRestrictedClientApp,
  verifyClientArtifact, verifySignedClientDescriptor,
} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';
import {REQUESTED_CAPABILITIES, SEND_SELECTOR} from '../src/operations.js';
import {createShareHandler} from '../src/send.js';
import {bootRestrictedGuest} from '../src/guest-entry.js';
import {createStandaloneSafeHost} from '../src/storage.js';
import {createHost} from '../../../packages/awai-shell/host.js';

const appDir = fileURLToPath(new URL('../', import.meta.url));
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function makeKv() {
  const map = new Map();
  return {
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async entries(prefix = '') { return [...map.entries()].filter(([k]) => k.startsWith(prefix)); },
    async deletePrefix(prefix = '') { for (const k of [...map.keys()]) if (k.startsWith(prefix)) map.delete(k); },
    async update(keys, decide) {
      const current = keys.map(k => (map.has(k) ? map.get(k) : null));
      const plan = decide(current);
      if (plan?.abort) return plan.result;
      for (const [op, k, v] of plan?.writes ?? []) {
        if (op === 'put') map.set(k, v);
        else if (op === 'delete') map.delete(k);
      }
      return plan?.result;
    },
  };
}

function makeHostDom() {
  class FakeHTMLElement {
    constructor(tag, doc) {
      this.tag = tag;
      this.tagName = tag.toUpperCase();
      this.ownerDocument = doc;
      this.children = [];
      this.parentNode = null;
      this.textContent = '';
      this.className = '';
      this.disabled = false;
      this.open = false;
      this.isConnected = true;
      this._listeners = new Map();
    }
    getRootNode() { return this.ownerDocument; }
    setAttribute() {}
    append(...kids) {
      for (const k of kids) {
        if (k && typeof k === 'object') k.parentNode = this;
        this.children.push(k);
      }
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    removeEventListener() {}
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { this.isConnected = false; this.parentNode = null; }
  }
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  const frames = [];
  const doc = {
    defaultView: {MouseEvent: class {}, performance: {now: () => 0}},
    createElement(tag) {
      const el = new FakeHTMLElement(tag, doc);
      if (tag === 'iframe') {
        el._posted = [];
        el.contentWindow = {postMessage: (msg, targetOrigin, transfer) => el._posted.push({msg, targetOrigin, transfer})};
        frames.push(el);
      }
      return el;
    },
  };
  doc.body = new FakeHTMLElement('body', doc);
  const container = new FakeHTMLElement('div', doc);
  doc.body.append(container);
  return {doc, container, frames, FakeHTMLElement, FakeMutationObserver};
}

test('P1 #1: canonical mountRestrictedClientApp mounts self-contained guest.html and persists via kotoba.client.local.v1 on opaque origin', async () => {
  // Ensure dist/guest.html is built cleanly.
  execFileSync('node', ['scripts/build.mjs'], {cwd: appDir, stdio: 'pipe'});
  const guestBytes = readFileSync(resolve(appDir, 'dist/guest.html'));
  const guestHtml = guestBytes.toString('utf8');
  assert.ok(guestBytes.byteLength < 8 * 1024 * 1024, 'guest.html fits mountRestrictedClientApp 8 MiB budget');
  assert.doesNotMatch(guestHtml, /<script[^>]+src=|<link[^>]+rel=['"]stylesheet['"]/i, 'self-contained guest has zero external script/stylesheet loads');

  // Sign app-descriptor.json with an ephemeral Ed25519 keypair and verify via canonical verifySignedClientDescriptor.
  const descBytes = readFileSync(resolve(appDir, 'app-descriptor.json'));
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const sigRaw = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, descBytes));
  const admitted = await verifySignedClientDescriptor({
    bytes: new Uint8Array(descBytes),
    signature: hex(sigRaw),
    publicKey: hex(pubRaw),
    pinnedPublicKey: hex(pubRaw),
    revision: 'a'.repeat(40),
    digest: sha256(descBytes),
    requestedCapabilities: [...REQUESTED_CAPABILITIES],
    appOrigins: ['https://soudan.itonami.app'],
  });
  assert.equal(admitted.runtime.profile, 'restricted-wasm-v1');
  assert.equal(admitted.runtime.entry, 'guest.html');

  const artifact = await verifyClientArtifact(new Uint8Array(guestBytes), {
    revision: 'b'.repeat(40),
    sha256: sha256(guestBytes),
    'max-bytes': guestBytes.byteLength + 1024,
  });

  const {doc, container, frames, FakeHTMLElement, FakeMutationObserver} = makeHostDom();
  const prevDoc = globalThis.document;
  const prevHtmlEl = globalThis.HTMLElement;
  const prevMO = globalThis.MutationObserver;
  globalThis.document = doc;
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.MutationObserver = FakeMutationObserver;

  try {
    const consentHost = createClientConsentHost({document: doc, locale: 'ja'});
    const backend = createEncryptedClientStorageBackend({
      kv: makeKv(),
      conformance: {
        schema: CLIENT_STORAGE_CONFORMANCE_SCHEMA,
        host: 'browser-test',
        'no-logging': true,
        'encrypted-at-rest': true,
        'encrypted-names': true,
        'user-clearable': true,
        'removed-with-app': true,
        'no-cloud-backup': 'no-os-backup',
        'key-custody': 'host-profile',
      },
    });
    const hostLocal = createClientHostLocal({
      admitted,
      appId: 'network.itonami.soudan',
      storage: backend,
      consentHost,
      app: {name: 'Soudan'},
    });
    const broker = createClientOperationBroker({
      runtime: admitted.runtime,
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      approvedOperations: admitted.runtime.operations,
      hostSupportedOperations: [[SEND_SELECTOR.capability, SEND_SELECTOR.service, SEND_SELECTOR.operation]],
      browserAdapters: {[SEND_SELECTOR.service]: {[SEND_SELECTOR.operation]: createShareHandler({shareText: async () => {}})}},
      consentHost,
      hostLocal,
      app: {name: 'Soudan'},
    });

    const mounted = await mountRestrictedClientApp({artifact, container, broker, hostLocal});
    assert.equal(frames.length, 1);
    const frame = frames[0];
    assert.equal(frame.sandbox, 'allow-scripts');
    assert.ok(frame.srcdoc.includes('id="guest-root"'));

    // Trigger iframe load so host transfers channel.port2 to the guest.
    for (const fn of frame._listeners.get('load') ?? []) fn({});
    assert.equal(frame._posted.length, 1);
    assert.equal(frame._posted[0].msg.protocol, 'kotoba.client.host.v1');
    const guestPort = frame._posted[0].transfer[0];

    // Boot guest on a simulated opaque origin where accessing localStorage throws SecurityError.
    const opaqueWin = {
      navigator: {languages: ['ja']},
      get localStorage() { throw new Error('SecurityError: opaque origin'); },
      addEventListener() {},
      removeEventListener() {},
    };
    const guest = bootRestrictedGuest({win: opaqueWin, doc: null});
    const {store} = await guest.attachPort(guestPort);

    // Persist a draft update over kotoba.client.local.v1 -> hostLocal -> encrypted backend!
    const upd = await store.execute('soudan.draft.update', {
      patch: {jurisdiction: 'JPN', category: 'money', summary: 'opaque-origin host storage round-trip'},
    }, {actor: {kind: 'human'}});
    assert.equal(upd.ok, true);

    // Read back through the same host port to prove persisted encrypted storage works end-to-end.
    const readBack = await guest.getClient().read();
    assert.equal(readBack.revision, 1);
    assert.equal(readBack.data.drafts[0].draft.summary, 'opaque-origin host storage round-trip');
    mounted.close();
  } finally {
    globalThis.document = prevDoc;
    globalThis.HTMLElement = prevHtmlEl;
    globalThis.MutationObserver = prevMO;
  }
});

test('P1 #1: createStandaloneSafeHost survives opaque-origin localStorage SecurityError without throwing at startup', async () => {
  const opaqueWin = {
    get localStorage() { throw new Error('SecurityError: opaque origin'); },
  };
  const safeHost = createStandaloneSafeHost({createHostFn: createHost, appId: 'network.itonami.soudan', win: opaqueWin});
  assert.equal(safeHost.info().runtime, 'opaque-origin-memory');
  assert.deepEqual(await safeHost.read(), {schema: 'awai.shell.host.v1', revision: 0, data: null});
  await assert.rejects(safeHost.write({expectedRevision: 0, data: {}}), /storage-unavailable/);
});
