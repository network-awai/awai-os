// Evaluate one expression in the app's WebView through the forwarded DevTools socket (debug build only).
// usage: node cdp-eval.mjs <port> '<expression>'
const [port, expr] = process.argv.slice(2);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, {once: true}));
ws.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression: expr, awaitPromise: true, returnByValue: true}}));
const msg = await new Promise(r => ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id === 1) r(m); }));
console.log(JSON.stringify(msg.result?.result?.value ?? msg.result ?? msg, null, 1));
ws.close();
