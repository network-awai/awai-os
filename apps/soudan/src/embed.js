// Sandboxed MCP Apps (SEP-1865 draft alignment) entry for ui://soudan/app (text/html;profile=mcp-app).
// Connects to the host over JSON-RPC 2.0 postMessage with origin & session validation.
// Direct external X1 send and external inference are strictly forbidden inside this sandboxed iframe.

import {MCP_APP_MANIFEST, MCP_CONFORMANCE_STATUS, MCP_MIME_TYPE, MCP_RESOURCE_URI, createMcpAppBridge} from './mcp-app.js';
import {pickLocale, translator} from './messages.js';
import {createSemanticStore} from './semantic.js';

const locale = pickLocale(navigator.languages);
const t = translator(locale);
document.documentElement.lang = locale;

const store = createSemanticStore({locale, sandboxedIframe: true});

function allowedOriginsFromQuery() {
  try {
    const hostOrigin = new URLSearchParams(location.search).get('hostOrigin');
    if (hostOrigin && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(hostOrigin)) return [hostOrigin];
  } catch {}
  return [];
}

const bridge = createMcpAppBridge({
  store,
  locale,
  allowedHostOrigins: allowedOriginsFromQuery(),
  postMessage: (msg, origin) => {
    if (window.parent && window.parent !== window) window.parent.postMessage(msg, origin);
  },
});

const statusEl = document.getElementById('embed-status');
const stateEl = document.getElementById('embed-state');
const metaEl = document.getElementById('embed-meta');
const disclaimerEl = document.getElementById('embed-disclaimer');

if (metaEl) metaEl.textContent = `${MCP_RESOURCE_URI} · ${MCP_MIME_TYPE} · ${MCP_CONFORMANCE_STATUS}`;
if (disclaimerEl) disclaimerEl.textContent = t('disclaimer.fixed');

function renderState() {
  const s = store.getUiState();
  if (stateEl) stateEl.textContent = `${t('state.label')}: ${t('state.' + s)}`;
  if (statusEl) {
    const sess = bridge.getSession();
    statusEl.textContent = sess.initialized
      ? `MCP Apps initialized (session=${sess.sessionId}, tools=${MCP_APP_MANIFEST.tools.length})`
      : 'MCP Apps ready (awaiting ui/initialize from trusted host; direct external egress disabled)';
  }
}

window.addEventListener('message', async event => {
  await bridge.handleMessage(event);
  renderState();
});

renderState();
