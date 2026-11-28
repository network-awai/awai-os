// External operations descriptor for Bengoshi (kotoba.app.client-runtime.v1).
// Legal addendum & static-first constraint:
// - ZERO external network calls (`operations: []`, `REQUESTED_CAPABILITIES: []`)
// - ZERO external inference calls in web/Tauri app
// - ZERO app-origin requests; Method A direct transition (office URL / mailto: / tel: + 7-line manual Copy Contact)
// - All local state lives strictly on device (`awai.shell.host.v1`)

export const REQUESTED_CAPABILITIES = Object.freeze([]);

export function runtimeDescriptor() {
  return {
    schema: 'kotoba.app.client-runtime.v1',
    target: 'browser',
    profile: 'trusted-page-v1',
    entry: 'index.html',
    'local-state': {
      adapter: 'localstorage',
      schema: 'itonami.bengoshi.state.v1',
      version: 1,
    },
    workers: [],
    operations: [],
  };
}
