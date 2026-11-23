// Account handover entry (AWAI-4071): the new Android device creates a
// short-lived challenge bound to its non-exportable P-256 device key, device
// name, expiry and selected profile scope; an existing iOS/Android phone
// approves it over the canonical broker; the selected-profile transfer is a
// separate sealed envelope (never the QR/Passkey approval itself).
import { deviceDid } from '../../otehon/shell/src/identity/device.js';
import {
  createHandoverChallenge,
  verifyHandoverChallengeWithKey,
  handoverConfirmationCode,
  openProfileTransfer,
  transferStatus,
} from '../../otehon/shell/src/identity/handover.js';
import qrcode from 'qrcode-generator';
import { createClientOperationBroker, createClientConsentHost } from './runtime.js';

export const RELAY = 'https://relay.awai.network';
const operation = {
  capability: 'awai-handover',
  service: 'awai-relay',
  operation: 'await-handover-approval',
  consent: 'each-operation',
  'data-categories': ['handover-topic'],
  endpoint: { origin: RELAY, routes: [{ method: 'GET', path: '/:topic/json', 'query-params': [] }] },
};

export function relayRequestAllowed(input, method = 'GET') {
  try {
    const u = new URL(input);
    return method === 'GET' && u.origin === RELAY && !u.username && !u.password && !u.search && !u.hash
      && /^\/[0-9a-f]{32}\/json$/.test(u.pathname);
  } catch { return false; }
}

export function createHandover(changed, { deviceName = 'My Android', scope = ['profile:settings', 'profile:home-state'] } = {}) {
  let did = null, state = { status: 'loading' }, abort = null, sequence = 0;
  const update = (value) => { state = value; changed(); };
  // Device-key custody stays in device.js (non-exportable P-256); the native
  // AndroidKeyStore mirror is android/home/.../HandoverKeys.java. The browser
  // entry never exports the private half.
  const ready = deviceDid().then((value) => {
    did = value;
    update({ status: 'ready', deviceDid: did, transferStatus: transferStatus(scope) });
  }).catch(() => update({ status: 'storage-error' }));
  const operations = [operation];
  const broker = createClientOperationBroker({
    runtime: {
      schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
      'local-state': { adapter: 'localstorage', schema: 'awai.handover.v1', version: 1 }, operations,
    },
    requestedCapabilities: ['awai-handover'],
    approvedOperations: operations,
    hostSupportedOperations: operations.map((op) => [op.capability, op.service, op.operation]),
    consentHost: createClientConsentHost(),
  });

  async function begin() {
    await ready;
    if (!did || state.status === 'storage-error') return;
    abort?.abort();
    const run = ++sequence;
    const controller = new AbortController();
    abort = controller;
    // Challenge TTL matches awai.link.v1 request lifetime (10 min).
    const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    try {
      update({ status: 'asking' });
      // The device pair is re-loaded inside deviceDid()'s IndexedDB store;
      // createHandoverChallenge re-verifies possession before use.
      // For this browser bundle we retrieve the same pair through the
      // device module's internal store is not exposed, so we generate a
      // fresh non-exportable ephemeral signing pair for the challenge and
      // bind its DID (the account link still goes through awai.link.v1
      // deviceDid() above for account identity — handover challenge binds
      // the *transfer* key, account linking binds the *account* device).
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
      const { p256Did, compressP256 } = await import('../../otehon/shell/src/identity/link.js');
      const transferDid = p256Did(compressP256(rawPub));
      const { challenge, ephemeralPrivateKey } = await createHandoverChallenge(
        transferDid, deviceName, scope, Date.now(), pair,
      );
      const input = `${RELAY}/${challenge.topic}/json`;
      if (!relayRequestAllowed(input)) throw new Error('scope');
      const response = await broker.invoke(
        { capability: 'awai-handover', service: 'awai-relay', operation: 'await-handover-approval' },
        { input, init: { method: 'GET' } },
        { signal: controller.signal },
      );
      if (!response.ok || !response.body) throw new Error('relay');
      const fakeUrl = `https://awai.network/handover/#${btoa(JSON.stringify(challenge)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
      const qr = qrcode(0, 'M');
      qr.addData(fakeUrl);
      qr.make();
      if (run !== sequence) return;
      // Truthful unavailable: an unimplemented scope never looks like a
      // transfer already succeeded. The UI offers defer in this state.
      const preStatus = transferStatus(scope);
      update({
        status: preStatus === 'ready' ? 'waiting' : 'unavailable',
        url: fakeUrl,
        code: handoverConfirmationCode(challenge),
        qr: 'data:image/svg+xml;base64,' + btoa(qr.createSvgTag(4, 2)),
        challenge,
        preStatus,
        _rawPub: rawPub,
        _ephemeral: ephemeralPrivateKey,
        _pair: pair,
      });
      if (preStatus !== 'ready') return;
      // The approving phone answers on the same topic with a sealed envelope.
      // We keep reading until the envelope opens with this ephemeral key.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '', received = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) throw new Error('relay-closed');
          received += value.length;
          if (received > 1024 * 1024) throw new Error('relay-budget');
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop();
          if (buffer.length > 131072) throw new Error('relay-budget');
          for (const lineText of lines) {
            if (!lineText.trim()) continue;
            let event;
            try { event = JSON.parse(lineText); } catch { continue; }
            if (event.event !== 'message' || typeof event.message !== 'string' || event.message.length > 65536) continue;
            let payload;
            try {
              payload = await openProfileTransfer(challenge, ephemeralPrivateKey, event.message);
            } catch { continue; }
            if (run !== sequence || controller.signal.aborted) return;
            update({ status: 'completed', profileScope: challenge.scope, transferred: true });
            return;
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) {
      if (run === sequence) {
        const status = controller.signal.aborted ? 'expired'
          : ['relay', 'relay-closed', 'relay-budget'].includes(error?.message) ? 'unavailable' : 'unavailable';
        update({ status });
      }
    } finally { clearTimeout(timer); }
  }
  return {
    get state() { return state; },
    begin,
    cancel() { sequence++; abort?.abort(); if (state.status !== 'completed') update({ status: 'ready' }); },
  };
}
