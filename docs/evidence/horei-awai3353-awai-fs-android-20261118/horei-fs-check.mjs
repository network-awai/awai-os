// Call Horei's Awai FS host commands from its WebView exactly as fulltext.js awaiFsCache does, with the
// fixture block 132AC1000000040.json (CID bafkreihset5…, published and recorded in AWAI-3324).
// usage: node horei-fs-check.mjs <devtools-port> <fixture-path>
import {readFileSync} from 'node:fs';
const [port, fixture] = process.argv.slice(2);
const bytes = [...readFileSync(fixture)];
const cid = 'bafkreihset5nn4ixabqbtdkxur6suapswdub44y2ueirb3si33i6muhunu';
const expr = `(async () => {
  const invoke = window.__TAURI__.core.invoke, cid = ${JSON.stringify(cid)}, bytes = new Uint8Array(${JSON.stringify(bytes)});
  const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
  const out = {bytes: bytes.byteLength, sha256: hex(await crypto.subtle.digest('SHA-256', bytes))};
  try { await invoke('awai_fs_put', bytes, {headers: {'x-awai-cid': cid}}); out.put = 'ok'; } catch (e) { out.put = 'error: ' + e; }
  try { const raw = await invoke('awai_fs_get', {cid}); const got = new Uint8Array(raw);
        out.getType = Object.prototype.toString.call(raw); out.getBytes = got.byteLength;
        out.getSha256 = got.byteLength ? hex(await crypto.subtle.digest('SHA-256', got)) : null; } catch (e) { out.get = 'error: ' + e; }
  return out; })()`;
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, {once: true}));
ws.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression: expr, awaitPromise: true, returnByValue: true}}));
const m = await new Promise(r => ws.addEventListener('message', e => { const x = JSON.parse(e.data); if (x.id === 1) r(x); }));
console.log(JSON.stringify(m.result?.result?.value ?? m.result, null, 1)); ws.close();
