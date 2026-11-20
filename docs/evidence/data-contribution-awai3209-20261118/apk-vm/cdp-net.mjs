// Evaluate an expression with the CDP Network domain enabled and report every request the page starts
// within <waitMs>. usage: node cdp-net.mjs <port> <waitMs> '<expression>'
const [port, waitMs, expr] = process.argv.slice(2);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, {once: true}));
let id = 0; const pending = new Map(), requests = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSent') requests.push({method: m.params.request.method, url: m.params.request.url});
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const call = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
await call('Network.enable');
const res = await call('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true});
await new Promise(r => setTimeout(r, Number(waitMs)));
console.log(JSON.stringify({result: res.result?.result?.value ?? res.result?.exceptionDetails?.text ?? null, requests}, null, 1));
ws.close();
