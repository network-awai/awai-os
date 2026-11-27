import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offlineCapabilityReport, OFFLINE_CAPABILITIES_SCHEMA, OFFLINE_STATES} from '../src/offline-capabilities.mjs';

// Fixture: the awai_host_info response apps/itonami/src-tauri/src/lib.rs
// returns on Android (inferenceHandoff = cfg!(target_os = "android")).
const ANDROID_HOST = Object.freeze({
  schema: 'awai.shell.host.v1',
  app: 'itonami',
  runtime: 'tauri-3.0.0-alpha.6-wry',
  platform: 'android',
  nixosServices: false,
  localInference: false,
  inferenceHandoff: true,
  hostFilesystem: false,
  externalOperations: 'canonical-browser-broker-each-operation',
});
// Fixture: the same host off-Android (desktop/dev build).
const DESKTOP_HOST = Object.freeze({...ANDROID_HOST, platform: 'macos', inferenceHandoff: false});
// Fixture: awai.shell.host.v1 host.info().capabilities shape (host.js).
const WEB_CAPS = Object.freeze({
  localState: true, atomicWrite: true, agendaProjection: false,
  peerSnapshots: false, notifications: false, sync: false, install: false,
});

test('Android host: verified offline entries are available, absent ones are not', () => {
  const r = offlineCapabilityReport({host: ANDROID_HOST, web: WEB_CAPS});
  assert.equal(r.schema, OFFLINE_CAPABILITIES_SCHEMA);
  assert.equal(r.host, 'awai.shell.host.v1');
  const c = r.capabilities;
  // Existing verified-available values stay available offline.
  assert.equal(c['local-state'], 'offline-available');
  assert.equal(c['atomic-write'], 'offline-available');
  assert.equal(c['local-inference-handoff'], 'offline-available');
  // Explicit false is unavailable, never shown as available.
  for (const k of ['nixos-services', 'local-inference', 'host-filesystem',
                   'agenda-projection', 'notifications', 'sync', 'install'])
    assert.equal(c[k], 'unavailable', k);
  // External operations go through the canonical broker: network-required.
  assert.equal(c['external-operations'], 'network-required');
  assert.equal(c['peer-snapshots'], 'unavailable');
});

test('desktop host: no Android inference handoff, nothing upgraded', () => {
  const c = offlineCapabilityReport({host: DESKTOP_HOST, web: WEB_CAPS}).capabilities;
  assert.equal(c['local-inference-handoff'], 'unavailable');
  assert.equal(c['local-inference'], 'unavailable');
  assert.equal(c['local-state'], 'offline-available');
});

test('missing or unreadable host degrades to unverified, never available', () => {
  for (const host of [null, undefined, 'x', 42, {}, {schema: 'other.v9'}, {...ANDROID_HOST, schema: 'other.v9'}]) {
    const c = offlineCapabilityReport({host, web: WEB_CAPS}).capabilities;
    for (const k of ['nixos-services', 'local-inference', 'local-inference-handoff',
                     'host-filesystem', 'external-operations'])
      assert.equal(c[k], 'unverified', `${k} host=${JSON.stringify(host)}`);
    // Web-side verified values are unaffected by a missing host report.
    assert.equal(c['local-state'], 'offline-available');
  }
});

test('missing web capabilities degrade to unverified', () => {
  for (const web of [null, undefined, 'x', [], {localState: 'yes', atomicWrite: 1}]) {
    const c = offlineCapabilityReport({host: ANDROID_HOST, web}).capabilities;
    for (const k of ['local-state', 'atomic-write', 'agenda-projection',
                     'peer-snapshots', 'notifications', 'sync', 'install'])
      assert.equal(c[k], 'unverified', `${k} web=${JSON.stringify(web)}`);
    // Host-side values still classify.
    assert.equal(c['local-inference-handoff'], 'offline-available');
    assert.equal(c['external-operations'], 'network-required');
  }
});

test('unknown externalOperations value is unverified, never offline', () => {
  const c = offlineCapabilityReport({host: {...ANDROID_HOST, externalOperations: 'direct-socket'}, web: WEB_CAPS}).capabilities;
  assert.equal(c['external-operations'], 'unverified');
});

test('report is frozen and states stay inside the contract', () => {
  const r = offlineCapabilityReport({host: ANDROID_HOST, web: WEB_CAPS});
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.capabilities));
  for (const s of Object.values(r.capabilities)) assert.ok(OFFLINE_STATES.includes(s), s);
});
