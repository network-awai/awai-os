// Minimal CDP client: node cdp.mjs <ws-url> <js-expression-file>; prints the awaited result as JSON.
import {readFileSync} from 'node:fs';
const [ws, file] = process.argv.slice(2);
const sock = new WebSocket(ws); let id = 0; const pending = new Map();
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); sock.send(JSON.stringify({id: i, method, params})); });
sock.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
sock.onopen = async () => {
  const r = await send('Runtime.evaluate', {expression: readFileSync(file, 'utf8'), awaitPromise: true, returnByValue: true});
  console.log(JSON.stringify(r.result?.result?.value ?? r.result ?? r, null, 2)); sock.close();
};
