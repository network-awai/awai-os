import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

test('style.css enforces overflow-wrapping on a.ext-link, flex/grid children, and keeps >= 44px touch targets', () => {
  for (const rel of ['src/style.css', 'dist/style.css']) {
    const css = readFileSync(resolve(appRoot, rel), 'utf8');
    const extLinkMatch = css.match(/a\.ext-link\s*\{([^}]+)\}/);
    assert.ok(extLinkMatch, `${rel} must define a.ext-link rule`);
    const body = extLinkMatch[1];

    assert.match(body, /max-inline-size\s*:\s*100%/, `${rel} a.ext-link must set max-inline-size: 100%`);
    assert.match(body, /overflow-wrap\s*:\s*anywhere/, `${rel} a.ext-link must set overflow-wrap: anywhere`);
    assert.match(body, /word-break\s*:\s*break-word/, `${rel} a.ext-link must set word-break: break-word`);
    assert.match(body, /min-width\s*:\s*0/, `${rel} a.ext-link must set min-width: 0`);
    assert.match(body, /box-sizing\s*:\s*border-box/, `${rel} a.ext-link must set box-sizing: border-box`);
    assert.match(body, /min-block-size\s*:\s*44px/, `${rel} a.ext-link must keep >= 44px touch height`);
    assert.match(body, /min-inline-size\s*:\s*44px/, `${rel} a.ext-link must keep >= 44px touch width`);

    assert.match(css, /\.grid\s*\{[^}]*minmax\(0,\s*1fr\)/, `${rel} .grid must constrain track with minmax(0,1fr)`);
    assert.match(css, /\.card\s*\{[^}]*min-width\s*:\s*0/, `${rel} .card must allow shrinking via min-width:0`);
    assert.match(css, /--bg:#fff/, `${rel} must preserve canonical light --bg`);
    assert.match(css, /--bg:#14110f/, `${rel} must preserve canonical dark --bg`);
  }
});

test('mobile 390x844 layout has zero horizontal overflow (scrollWidth <= 390) on #/guide, #/search, and core views', async (t) => {
  const chromeBin = findChromeBinary();
  if (!chromeBin || typeof globalThis.WebSocket !== 'function') {
    t.skip('Headless Chrome or WebSocket not available in this environment');
    return;
  }

  const distDir = resolve(appRoot, 'dist');
  const server = createServer(async (req, res) => {
    const cleanPath = (req.url || '/').split('?')[0];
    const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
    try {
      const buf = await readFile(resolve(distDir, rel));
      res.writeHead(200, { 'Content-Type': MIME[extname(rel)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/`;

  const chrome = spawn(chromeBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--window-size=390,844',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let ws = null;
  try {
    const wsUrl = await new Promise((resolveUrl, rejectUrl) => {
      const timeout = setTimeout(() => rejectUrl(new Error('Timed out waiting for Chrome DevTools URL')), 10000);
      let stderrBuf = '';
      chrome.stderr.on('data', chunk => {
        stderrBuf += chunk.toString();
        const m = stderrBuf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) {
          clearTimeout(timeout);
          resolveUrl(m[1]);
        }
      });
      chrome.once('exit', code => {
        clearTimeout(timeout);
        rejectUrl(new Error(`Chrome exited early (${code}): ${stderrBuf}`));
      });
    });

    const devPort = new URL(wsUrl).port;
    const targets = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();
    const pageTarget = targets.find(x => x.type === 'page');
    assert.ok(pageTarget?.webSocketDebuggerUrl, 'Chrome page target must exist');

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

    let msgId = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: fail } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message));
        else ok(msg.result);
      }
    };
    const send = (method, params = {}) => new Promise((ok, fail) => {
      const id = ++msgId;
      pending.set(id, { resolve: ok, reject: fail });
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });

    await send('Page.navigate', { url: baseUrl + '#/guide' });
    await new Promise(r => setTimeout(r, 700));

    const routes = [
      '#/guide',
      '#/search',
      '#/profile/syn-lawyer-990001',
      '#/contact/compose',
      '#/lawyer/onboarding',
      '#/lawyer/profile',
      '#/lawyer/inbox',
      '#/audit',
    ];

    for (const hash of routes) {
      await send('Runtime.evaluate', {
        expression: `location.hash = ${JSON.stringify(hash)};`,
        awaitPromise: false,
      });
      await new Promise(r => setTimeout(r, 250));

      const evalRes = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const sw = document.documentElement.scrollWidth;
          const cw = document.documentElement.clientWidth;
          const extLinks = [...document.querySelectorAll('a.ext-link')].map(el => {
            const r = el.getBoundingClientRect();
            return { text: el.textContent.slice(0, 40), right: Math.ceil(r.right), width: Math.round(r.width), height: Math.round(r.height) };
          });
          const smallControls = [...document.querySelectorAll('button, .nav-bar a, a.ext-link')]
            .filter(el => {
              const style = getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
            })
            .map(el => {
              const r = el.getBoundingClientRect();
              return { tag: el.tagName, cls: el.className, w: Math.round(r.width), h: Math.round(r.height), text: el.textContent.slice(0, 24) };
            })
            .filter(x => x.w < 44 || x.h < 44);
          return { hash: location.hash, scrollWidth: sw, clientWidth: cw, extLinks, smallControls };
        })()`,
      });

      const metrics = evalRes.result.value;
      assert.ok(
        metrics.scrollWidth <= 390,
        `Horizontal overflow on ${hash}: scrollWidth=${metrics.scrollWidth} > 390 (clientWidth=${metrics.clientWidth})`,
      );
      for (const link of metrics.extLinks) {
        assert.ok(link.right <= 390, `a.ext-link overflows 390px on ${hash}: ${JSON.stringify(link)}`);
        assert.ok(link.height >= 44, `a.ext-link touch target height < 44px on ${hash}: ${JSON.stringify(link)}`);
      }
      assert.deepEqual(metrics.smallControls, [], `Controls smaller than 44x44px on ${hash}: ${JSON.stringify(metrics.smallControls)}`);
    }
  } finally {
    if (ws && ws.readyState === 1) ws.close();
    chrome.kill('SIGTERM');
    server.close();
  }
});
