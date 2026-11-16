#!/usr/bin/env node
// Otehon operator-side observer. Uses an existing authenticated SSH/CDP relay.
// No clicks, approvals, input values, URLs, request/response bodies or headers
// are retained. This observer never changes browser security settings.
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const origin = 'http://127.0.0.1:8780';
const localPorts = new Set(['8000', '8770', '8771', '8773', '8774', '8775', '8776']);
export function category(url) {
  try {
    const u = new URL(url);
    if (u.origin === 'https://relay.awai.network') return 'relay';
    if (u.origin === origin) return 'shell';
    if (u.protocol === 'http:' && u.hostname === '127.0.0.1' && localPorts.has(u.port)) return 'local-service';
  } catch {}
  return null;
}
export function normalize(method, p, tracked) {
  if (method === 'Network.requestWillBeSent') {
    const kind = category(p.request?.url);
    if (!kind) return null;
    if (tracked.size >= 128) tracked.delete(tracked.keys().next().value);
    tracked.set(p.requestId, kind);
    return { event: 'request', kind, method: ['GET','POST','HEAD','OPTIONS'].includes(p.request.method) ? p.request.method : 'other' };
  }
  const kind = tracked.get(p.requestId);
  if (method === 'Network.responseReceived' && kind) {
    const status = p.response?.status;
    return { event: 'response', kind, status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null };
  }
  if (method === 'Network.loadingFailed' && kind) {
    tracked.delete(p.requestId);
    return { event: 'network-error', kind,
      code: /^net::ERR_[A-Z0-9_]{1,64}$/.test(p.errorText) ? p.errorText : 'network-failed',
      cors: /^[A-Za-z]{1,80}$/.test(p.corsErrorStatus?.corsError ?? '') ? p.corsErrorStatus.corsError : null,
      cancelled: p.canceled === true };
  }
  if (method === 'Network.loadingFinished') tracked.delete(p.requestId);
  if (method === 'Runtime.exceptionThrown') {
    const name = p.exceptionDetails?.exception?.className;
    return { event: 'uncaught-exception', class: ['Error','TypeError','ReferenceError','DOMException','SyntaxError'].includes(name) ? name : 'other' };
  }
  return null;
}
export function safeUi(value) {
  const steps = ['hello','language','network','signin','trust','done'];
  const states = ['idle','asking','waiting','denied','failed','expired'];
  return { event: 'ui', step: steps.includes(value?.step) ? value.step : null,
    link: states.includes(value?.link) ? value.link : null,
    approvalOpen: value?.approvalOpen === true, hasError: value?.hasError === true,
    code: /^(?:relay-http-[1-5][0-9]{2}|operation-denied|operation-cancelled|browser-network-error|relay-protocol-error|client-error)$/.test(value?.code ?? '') ? value.code : null };
}
export function localCdp(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('CDP must be an operator loopback HTTP origin');
  return url.origin;
}

async function observe(cdp, output, duration) {
  if (typeof WebSocket !== 'function') throw Error('Node with native WebSocket support is required');
  const file = await open(output, 'ax', 0o600); // Never overwrite prior evidence.
  let bytes = 0, stopped = false, chain = Promise.resolve();
  const end = Date.now() + duration;
  const write = row => {
    if (stopped) return;
    const line = JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n';
    bytes += Buffer.byteLength(line);
    if (bytes > 1048576) { stopped = true; return; }
    chain = chain.then(() => file.write(line)).catch(() => { stopped = true; });
  };
  let ws;
  try {
    while (!stopped && Date.now() < end) {
      try {
        const tabs = await (await fetch(cdp + '/json/list', { signal: AbortSignal.timeout(5000), redirect: 'error' })).json();
        const page = tabs.find(t => t.type === 'page' && category(t.url) === 'shell');
        if (!page) throw Error('page-unavailable');
        const endpoint = new URL(page.webSocketDebuggerUrl);
        if (!['ws:','wss:'].includes(endpoint.protocol) || !/^\/devtools\/page\/[A-Za-z0-9-]+$/.test(endpoint.pathname)) throw Error('invalid-page-endpoint');
        const local = new URL(cdp); endpoint.protocol = 'ws:'; endpoint.hostname = local.hostname; endpoint.port = local.port;
        endpoint.username = ''; endpoint.password = ''; endpoint.search = ''; endpoint.hash = '';
        ws = new WebSocket(endpoint);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('connect-timeout')), 5000);
          ws.onopen = () => { clearTimeout(timeout); resolve(); };
          ws.onerror = () => { clearTimeout(timeout); reject(Error('connect-failed')); };
        });
        const pending = new Map(), tracked = new Map(); let seq = 0, connected = true, previous = '';
        ws.onclose = () => { connected = false; };
        ws.onmessage = ({ data }) => {
          try {
            const m = JSON.parse(data);
            if (m.id && pending.has(m.id)) { const resolve = pending.get(m.id); pending.delete(m.id); resolve(m.result ?? null); }
            const row = normalize(m.method, m.params ?? {}, tracked); if (row) write(row);
          } catch { /* Never log raw protocol payloads. */ }
        };
        const call = (method, params = {}) => new Promise(resolve => {
          const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
          setTimeout(() => { if (pending.delete(id)) resolve(null); }, 5000).unref();
        });
        write({ event: 'attached' });
        await call('Network.enable'); await call('Runtime.enable');
        while (connected && !stopped && Date.now() < end) {
          const r = await call('Runtime.evaluate', {
            expression: 'JSON.stringify({step:document.querySelector(".setup")?.dataset.step,link:document.querySelector("[data-link-state]")?.dataset.linkState,approvalOpen:!!document.querySelector("dialog[open]"),hasError:Array.from(document.querySelectorAll(".problem,.net-error")).some(e=>e.getClientRects().length>0),code:document.querySelector("[data-link-error-code]")?.dataset.linkErrorCode})',
            returnByValue: true,
          });
          if (r?.result?.value) {
            const state = safeUi(JSON.parse(r.result.value)); const key = JSON.stringify(state);
            if (key !== previous) { write(state); previous = key; }
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch { write({ event: 'cdp-unavailable' }); }
      finally { ws?.close(); }
      if (!stopped && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally {
    ws?.close(); await chain; await file.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = flag => args[args.indexOf(flag) + 1];
  if (!args.includes('--cdp') || !args.includes('--output')) throw Error('Usage: --cdp http://127.0.0.1:PORT --output NEW.jsonl [--duration-ms N]');
  const duration = args.includes('--duration-ms') ? Number(value('--duration-ms')) : 1800000;
  if (!Number.isInteger(duration) || duration < 1000 || duration > 14400000) throw Error('duration must be 1000..14400000 ms');
  await observe(localCdp(value('--cdp')), value('--output'), duration);
}
