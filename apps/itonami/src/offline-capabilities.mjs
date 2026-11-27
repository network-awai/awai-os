// Offline capability report for the standalone Itonami Tauri app (AWAI-3001).
//
// Machine-readable contract `awai.itonami.offline-capabilities.v1`. Every
// entry is classified only from existing capability values:
//
//   host — the `awai_host_info` command response (`awai.shell.host.v1`):
//     nixosServices, localInference, inferenceHandoff, hostFilesystem,
//     externalOperations. This is the same report the native host already
//     returns; nothing here probes, grants or widens a capability.
//   web  — the Awai Shell host capabilities (`awai.shell.host.v1`,
//     host.info().capabilities): localState, atomicWrite, agendaProjection,
//     peerSnapshots, notifications, sync, install.
//
// States: "offline-available" (verified usable without a network),
// "network-required" (works only through a declared remote endpoint),
// "unavailable" (the source explicitly reports the capability absent),
// "unverified" (missing, unreadable or unknown — never shown as available).
// External operations stay on the canonical Kotoba broker with
// per-operation consent; they are network-required by definition and this
// module introduces no fallback path.

export const OFFLINE_CAPABILITIES_SCHEMA = 'awai.itonami.offline-capabilities.v1';
export const OFFLINE_STATES = Object.freeze([
  'offline-available',
  'network-required',
  'unavailable',
  'unverified',
]);

const HOST_SCHEMA = 'awai.shell.host.v1';
const HOST = 'host';
const WEB = 'web';
const LOCAL = 'local';
const NETWORK = 'network';
const BROKER = 'broker';
const CANONICAL_BROKER = 'canonical-browser-broker-each-operation';

// key -> [source, host_info field or web capability field, kind]
const CAPABILITIES = Object.freeze([
  ['local-state', WEB, 'localState', LOCAL],
  ['atomic-write', WEB, 'atomicWrite', LOCAL],
  ['agenda-projection', WEB, 'agendaProjection', LOCAL],
  ['peer-snapshots', WEB, 'peerSnapshots', NETWORK],
  ['notifications', WEB, 'notifications', LOCAL],
  ['sync', WEB, 'sync', NETWORK],
  ['install', WEB, 'install', NETWORK],
  ['nixos-services', HOST, 'nixosServices', LOCAL],
  ['local-inference', HOST, 'localInference', LOCAL],
  ['local-inference-handoff', HOST, 'inferenceHandoff', LOCAL],
  ['host-filesystem', HOST, 'hostFilesystem', LOCAL],
  ['external-operations', HOST, 'externalOperations', BROKER],
]);

function classify(kind, value) {
  if (kind === BROKER) {
    return value === CANONICAL_BROKER ? 'network-required' : 'unverified';
  }
  if (typeof value !== 'boolean') return 'unverified';
  if (kind === NETWORK) return value ? 'network-required' : 'unavailable';
  return value ? 'offline-available' : 'unavailable';
}

/**
 * Build the offline capability report. `host` is the raw awai_host_info
 * response (or null when the command is unavailable/failed); `web` is the
 * shell host capabilities object (or undefined when there is no host
 * handshake). Unreadable or wrongly shaped input degrades entries to
 * "unverified"; it never upgrades them to "offline-available".
 */
export function offlineCapabilityReport({ host = null, web = null } = {}) {
  const hostOk = host !== null && typeof host === 'object' && host.schema === HOST_SCHEMA;
  const webOk = web !== null && typeof web === 'object';
  const capabilities = {};
  for (const [key, source, field, kind] of CAPABILITIES) {
    const value = source === HOST
      ? (hostOk ? host[field] : undefined)
      : (webOk ? web[field] : undefined);
    capabilities[key] = classify(kind, value);
  }
  return Object.freeze({
    schema: OFFLINE_CAPABILITIES_SCHEMA,
    host: hostOk ? HOST_SCHEMA : null,
    capabilities: Object.freeze(capabilities),
  });
}
