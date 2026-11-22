import { clientRuntimeProblems, createClientConsentHost, createClientOperationBroker } from './runtime.js';

// Torihiki devnet client (AWAI-3100 reads, AWAI-491 orders).
// The node is a single sequencer with unbacked devnet collateral; it is not a
// market for real assets. Every request is its own operation with its own
// trusted user choice through the canonical broker; denial sends nothing.
// Nothing is signed unless the node's /head chain id, read in this session,
// names a devnet.
export const TORIHIKI_NODE = 'https://torihiki-node.04-feasts-minded.workers.dev';
export const TORIHIKI_MARKET = '1';
const READ = 'torihiki-read';
const TRADE = 'torihiki-devnet-trade';
const SERVICE = 'torihiki-devnet';
const MAX_RESPONSE_BYTES = 65536;
const MARKET_ID = Number(TORIHIKI_MARKET);

// torihiki.auth/tx-fields has this many positions (f0..f49) at the engine the
// node is pinned to (kotoba-lang/torihiki 6f3a28d, torihiki-node main). A node
// on another engine computes a different payload and answers 401
// bad-signature, which changes nothing on the node.
export const FIELD_COUNT = 50;
// What the node actually running at TORIHIKI_NODE signs over, keyed by /head
// "code-version". Measured against the live devnet on 2026-11-18 (AWAI-3442):
// code-version 12 accepts f0..f15 only (the engine before the appended :credit
// and later fields) and has no cancel-all (400 unknown-tx). The engine pin
// above (50 fields) is what the node's repository names, not what is deployed.
// An unknown version is refused rather than guessed: a wrong guess is a
// bad-signature, a right guess made silently is a format nobody checked.
export const NODE_PROTOCOLS = Object.freeze({ '12': Object.freeze({ fields: 16, txs: Object.freeze(['deposit', 'order']) }) });
export function protocolFor(head) {
  const p = head && Object.hasOwn(NODE_PROTOCOLS, head.codeVersion ?? '') ? NODE_PROTOCOLS[head.codeVersion] : null;
  if (!p) throw Error(`このノードの版（${head?.codeVersion ?? '不明'}）の署名形式を確認できていないため、署名しません。`);
  return p;
}
export const supports = (head, kind) => { try { return protocolFor(head).txs.includes(kind); } catch { return false; } };
// torihiki.address: ids below FLOOR are genesis roles; ids live in 2^45.
const FLOOR = 100000, SPACE = 35184372088832;

// Candle spans the node accepts (blocks per candle). Each span is its own declared read.
export const CANDLE_SPANS = ['1', '10', '50'];
const tx = { method: 'POST', path: '/tx', 'query-params': [] };
const operations = [
  [READ, 'read-head', { method: 'GET', path: '/head', 'query-params': [] }, ['request-ip']],
  [READ, 'read-market', { method: 'GET', path: '/market', 'query-params': ['id'], 'query-values': { id: TORIHIKI_MARKET } }, ['request-ip', 'market-id']],
  [READ, 'read-book', { method: 'GET', path: '/book', 'query-params': ['market', 'depth'], 'query-values': { market: TORIHIKI_MARKET, depth: '15' } }, ['request-ip', 'market-id']],
  [READ, 'read-account', { method: 'GET', path: '/account', 'query-params': ['id'] }, ['request-ip', 'account-id']],
  [READ, 'read-trades', { method: 'GET', path: '/trades', 'query-params': ['market'], 'query-values': { market: TORIHIKI_MARKET } }, ['request-ip', 'market-id']],
  ...CANDLE_SPANS.map((span) => [READ, `read-candles-${span}`, { method: 'GET', path: '/candles', 'query-params': ['market', 'span'], 'query-values': { market: TORIHIKI_MARKET, span } }, ['request-ip', 'market-id']]),
  [TRADE, 'request-devnet-funds', tx, ['request-ip', 'account-id', 'public-key', 'signed-transaction']],
  [TRADE, 'submit-order', tx, ['request-ip', 'account-id', 'public-key', 'signed-transaction', 'order']],
  [TRADE, 'cancel-all', tx, ['request-ip', 'account-id', 'public-key', 'signed-transaction', 'market-id']],
];
export const torihikiUrls = {
  'read-head': `${TORIHIKI_NODE}/head`,
  'read-market': `${TORIHIKI_NODE}/market?id=${TORIHIKI_MARKET}`,
  'read-book': `${TORIHIKI_NODE}/book?market=${TORIHIKI_MARKET}&depth=15`,
  'read-trades': `${TORIHIKI_NODE}/trades?market=${TORIHIKI_MARKET}`,
  ...Object.fromEntries(CANDLE_SPANS.map((span) => [`read-candles-${span}`, `${TORIHIKI_NODE}/candles?market=${TORIHIKI_MARKET}&span=${span}`])),
};
export const accountUrl = (id) => `${TORIHIKI_NODE}/account?id=${accountId(id)}`;
export const TX_URL = `${TORIHIKI_NODE}/tx`;

// AWAI-3881: finding-9 disclosure for every operation (same shape as
// apps/murakumo/client/download-contract.js, AWAI-3842). The node runs on
// Cloudflare Workers; per the owner decision (2026-11-23) it is declared
// as the US infrastructure recipient rather than as a domestic service.
const NODE_DISCLOSURE = { recipient: 'Cloudflare, Inc.', country: 'US', 'country-name': 'United States',
  'foreign-info-url': 'https://www.cloudflare.com/', 'special-care': false, frequency: 'one-time',
  note: 'Devnet only: no real assets. A signed transaction is public to the node once sent.' };
const DATA_WORDS = { 'request-ip': 'request IP address', 'market-id': 'market id', 'account-id': 'account id',
  'public-key': 'public key', 'signed-transaction': 'signed transaction', order: 'order details' };
const disclosureFor = (capability, categories) => ({ ...NODE_DISCLOSURE,
  data: categories.map((c) => DATA_WORDS[c] ?? c),
  purpose: capability === READ ? 'read devnet market data from the node' : 'submit a signed devnet transaction to the node',
  withdrawal: capability === READ ? 'cancel the request before it is sent' : 'do not sign; a sent transaction cannot be unsent' });

export function torihikiRuntime(base) {
  return { ...base, operations: operations.map(([capability, operation, route, categories]) => ({
    capability, service: SERVICE, operation, consent: 'each-operation',
    'data-categories': categories,
    endpoint: { origin: TORIHIKI_NODE, routes: [route] },
    disclosure: disclosureFor(capability, categories),
  })) };
}

const int = (x) => Number.isSafeInteger(x);
const optionalInt = (x) => x === null || x === undefined || int(x);
const inRange = (x, lo, hi) => int(x) && x >= lo && x <= hi;
function accountId(id) { if (!inRange(id, FLOOR, FLOOR + SPACE - 1)) throw Error('口座番号を確認できません。'); return id; }

export function isDevnet(chainId) { return typeof chainId === 'string' && /devnet/i.test(chainId); }

// ── signing (torihiki.auth/signing-payload, torihiki.address/derive) ─────────
// Written out because this page has no engine; checked against vectors the
// engine produced (android/tests/torihiki-vectors.json).

const enc = new TextEncoder();
export function b64(buffer) { let s = ''; for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b); return btoa(s); }

/** torihiki.address/derive: first six bytes of SHA-256 over the base64 text of the raw key. */
export async function deriveAccount(pubB64) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(pubB64)));
  let acc = 0; for (let i = 0; i < 6; i++) acc = acc * 256 + d[i];
  return FLOOR + (acc % SPACE);
}

/** The only transactions this client builds, with exactly these fields. */
export function buildTx(kind, fields = {}) {
  if (kind === 'order') {
    const { side, level, qty, flags = 0 } = fields;
    if (!inRange(side, 0, 1)) throw Error('売買の別を確認してください。');
    if (!inRange(level, 1, 1048575)) throw Error('価格（レベル）は 1〜1048575 の整数です。');
    if (!inRange(qty, 1, 1e9) || qty > Math.floor(9007199254740991 / level)) throw Error('数量を確認してください。');
    if (![0, 1, 2, 4, 5, 6].includes(flags)) throw Error('注文条件を確認してください。');
    return { tx: 'order', market: MARKET_ID, side, level, qty, flags };
  }
  if (kind === 'cancel-all') return { tx: 'cancel-all', market: MARKET_ID };
  if (kind === 'deposit') {
    if (!inRange(fields.amount, 1, 1e12)) throw Error('受け取る量は 1〜1,000,000,000,000 の整数です。');
    return { tx: 'deposit', amount: fields.amount };
  }
  throw Error('この版で扱わない取引です。');
}

/** torihiki.auth/signing-payload for the transactions buildTx makes. */
export function signingPayload(chainId, account, nonce, t, fieldCount = FIELD_COUNT) {
  if (!inRange(fieldCount, 16, FIELD_COUNT)) throw Error('署名の形式を確認できません。');
  if (typeof chainId !== 'string' || !/^[\x21-\x7e]{1,80}$/.test(chainId) || !int(account) || !inRange(nonce, 1, 9007199254740991)) throw Error('署名の前提を確認できません。');
  const allowed = { order: ['tx', 'market', 'side', 'level', 'qty', 'flags'], 'cancel-all': ['tx', 'market'], deposit: ['tx', 'amount'] }[t?.tx];
  if (!allowed || Object.keys(t).some((k) => !allowed.includes(k))) throw Error('この版で扱わない取引です。');
  const f = Array(fieldCount).fill('');
  const put = (i, v) => { if (v !== undefined) f[i] = String(v); };
  // f0 tx, f1 market, f2 side, f3 level, f4 qty, f5 flags, f6 oid, f7 amount
  put(0, t.tx); put(1, t.market); put(2, t.side); put(3, t.level); put(4, t.qty); put(5, t.flags); put(7, t.amount);
  return `torihiki/tx/v1\nchain=${chainId}\naccount=${account}\nnonce=${nonce}\n${f.map((v, i) => `f${i}=${v}`).join('\n')}\n`;
}

export async function signEnvelope(key, chainId, nonce, t, fieldCount = FIELD_COUNT) {
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, enc.encode(signingPayload(chainId, key.account, nonce, t, fieldCount)));
  return { tx: t, account: key.account, nonce, pubkey: key.pubkey, sig: b64(sig) };
}

// ── session key: Ed25519, private half non-extractable, kept in IndexedDB ────

const DB = 'itonami.torihiki.v1', STORE = 'keys', SLOT = 'session';
function idb(run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, t = db.transaction(STORE, 'readwrite'), req = run(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(req?.result); };
      t.onerror = t.onabort = () => { db.close(); reject(t.error); };
    };
  });
}
export async function loadKey(store = idb) {
  const k = await store((s) => s.get(SLOT));
  if (!k || !(k.privateKey instanceof CryptoKey) || k.privateKey.extractable || typeof k.pubkey !== 'string') return null;
  if (await deriveAccount(k.pubkey) !== k.account) return null;
  return k;
}
export async function createKey(store = idb) {
  let pair;
  try { pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']); }
  catch { throw Error('この端末のブラウザ部品は Ed25519 署名に対応していないため、発注できません。'); }
  const pubkey = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
  const key = { privateKey: pair.privateKey, pubkey, account: await deriveAccount(pubkey), created: Date.now() };
  await store((s) => s.put(key, SLOT));
  return key;
}
export const deleteKey = (store = idb) => store((s) => s.delete(SLOT));

// ── response views ───────────────────────────────────────────────────────────

export function headView(v) {
  if (!v || typeof v !== 'object' || !int(v.height) || v.height < 0 || typeof v['chain-id'] !== 'string' || v['chain-id'].length > 80
      || typeof v['state-root'] !== 'string' || !/^[0-9a-f]{64}$/.test(v['state-root'])) throw Error('ノードの応答を確認できません。');
  return { height: v.height, chainId: v['chain-id'], stateRoot: v['state-root'],
    codeVersion: typeof v['code-version'] === 'string' && /^[0-9]{1,6}$/.test(v['code-version']) ? v['code-version'] : null,
    consensus: typeof v.consensus === 'string' ? v.consensus.slice(0, 120) : '不明' };
}
export function marketView(v) {
  if (!v || typeof v !== 'object' || String(v.id) !== TORIHIKI_MARKET
      || ![v.mark, v.oracle, v.last, v['open-interest'], v['funding-rate']].every(int)
      || !optionalInt(v['max-leverage']) || typeof v['oracle-stale'] !== 'boolean') throw Error('市場の応答を確認できません。');
  return { id: v.id, mark: v.mark, oracle: v.oracle, last: v.last, openInterest: v['open-interest'],
    fundingRate: v['funding-rate'], maxLeverage: v['max-leverage'] ?? null, oracleStale: v['oracle-stale'],
    // Rates are integers scaled by RATE_SCALE (initial margin 25000000 = 2.5% = 40x); absent rates stay null.
    initialMarginRate: rate(v['initial-margin-rate']), takerFeeRate: rate(v['taker-fee-rate']), makerFeeRate: rate(v['maker-fee-rate']) };
}
export const RATE_SCALE = 1e9;
function rate(x) { if (x === undefined || x === null) return null; if (!inRange(x, 0, RATE_SCALE)) throw Error('市場の応答を確認できません。'); return x; }
/** /trades: newest first, side 0 = buy (lifted the ask), 1 = sell (hit the bid). */
export function tradesView(v) {
  if (!v || typeof v !== 'object' || String(v.market) !== TORIHIKI_MARKET || !Array.isArray(v.trades) || v.trades.length > 200) throw Error('約定の応答を確認できません。');
  return v.trades.map((r) => {
    if (!r || !inRange(r.level, 1, 1048575) || !inRange(r.qty, 1, 9007199254740991) || ![0, 1].includes(r.side) || !inRange(r.h, 0, 9007199254740991)) throw Error('約定の応答を確認できません。');
    return { level: r.level, qty: r.qty, side: r.side, height: r.h };
  });
}
/** /candles: block-span candles, oldest first. */
export function candlesView(v) {
  if (!v || typeof v !== 'object' || v.unit !== 'blocks' || !Array.isArray(v.candles) || v.candles.length > 500) throw Error('チャートの応答を確認できません。');
  const candles = v.candles.map((c) => {
    const nums = [c?.open, c?.high, c?.low, c?.close, c?.volume, c?.['buy-volume'], c?.['sell-volume'], c?.h];
    if (!c || !nums.every((x) => inRange(x, 0, 9007199254740991)) || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) throw Error('チャートの応答を確認できません。');
    return { height: c.h, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, buy: c['buy-volume'], sell: c['sell-volume'] };
  });
  return { candles, truncated: typeof v['truncated-because'] === 'string' };
}
export function bookView(v) {
  const side = (rows) => {
    if (!Array.isArray(rows) || rows.length > 15) throw Error('板の応答を確認できません。');
    return rows.map((r) => {
      if (!r || !int(r.level) || !int(r.qty) || r.qty < 0) throw Error('板の応答を確認できません。');
      return { level: r.level, qty: r.qty };
    });
  };
  if (!v || typeof v !== 'object' || String(v.market) !== TORIHIKI_MARKET) throw Error('板の応答を確認できません。');
  return { bids: side(v.bids), asks: side(v.asks) };
}
export function accountView(v, id) {
  if (!v || typeof v !== 'object' || v.account !== id || !inRange(v['next-nonce'], 1, 9007199254740991)
      || ![v.collateral, v.equity, v['free-collateral']].every(int) || typeof v.liquidatable !== 'boolean'
      || !(v['bound-key'] === null || typeof v['bound-key'] === 'string')
      || !v.positions || typeof v.positions !== 'object' || Object.keys(v.positions).length > 16) throw Error('口座の応答を確認できません。');
  const positions = Object.entries(v.positions).map(([market, p]) => {
    if (!p || !int(p.size) || !int(p.entry ?? 0) || !int(p.unrealized ?? 0)) throw Error('口座の応答を確認できません。');
    return { market: market.slice(0, 12), size: p.size, entry: p.entry ?? 0, unrealized: p.unrealized ?? 0 };
  });
  return { account: v.account, nextNonce: v['next-nonce'], boundKey: v['bound-key'], collateral: v.collateral, equity: v.equity,
    freeCollateral: v['free-collateral'], liquidatable: v.liquidatable, positions };
}
const REASONS = /^[a-z][a-z0-9-]{0,40}$/;
/** /tx answers 200 accepted, 400 refused after authenticating (nonce spent), 401 not authenticated (nothing changed). */
export function txView(status, v) {
  if (![200, 400, 401].includes(status) || !v || typeof v !== 'object' || typeof v.ok !== 'boolean') throw Error(`ノードが ${status} を返しました。`);
  if (v.reason !== undefined && !(typeof v.reason === 'string' && REASONS.test(v.reason))) throw Error('取引の応答を確認できません。');
  if (status === 200 && (v.ok !== true || !int(v.height))) throw Error('取引の応答を確認できません。');
  return { ok: status === 200, nonceSpent: status !== 401, height: int(v.height) ? v.height : null, reason: v.reason ?? null };
}

async function boundedText(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw Error('応答が大きすぎます。');
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw Error('応答が大きすぎます。');
  return text;
}
async function boundedJson(response) {
  if (!response.ok) throw Error(`ノードが ${response.status} を返しました。`);
  return JSON.parse(await boundedText(response));
}

export function createTorihiki(base, appOrigin = location.origin, consentHost = createClientConsentHost()) {
  const runtime = torihikiRuntime(base);
  if (clientRuntimeProblems(runtime, [READ, TRADE], appOrigin).length) throw Error('Torihiki の通信宣言を確認できません。');
  const broker = createClientOperationBroker({ runtime, requestedCapabilities: [READ, TRADE], approvedOperations: runtime.operations,
    hostSupportedOperations: runtime.operations.map((o) => [o.capability, o.service, o.operation]), consentHost });
  const capability = (operation) => runtime.operations.find((o) => o.operation === operation)?.capability;
  // Eligibility is a ceiling. Each request still needs the canonical trusted user choice.
  async function read(operation, account) {
    const url = operation === 'read-account' ? accountUrl(account) : torihikiUrls[operation];
    if (!url) throw Error('未宣言の操作です。');
    const body = await boundedJson(await broker.invoke({ capability: READ, service: SERVICE, operation }, { input: url, init: { method: 'GET' } }));
    return operation === 'read-head' ? headView(body) : operation === 'read-market' ? marketView(body)
      : operation === 'read-book' ? bookView(body) : operation === 'read-trades' ? tradesView(body)
      : operation.startsWith('read-candles-') ? candlesView(body) : accountView(body, account);
  }
  /** Sign and send one transaction. `head` must be this session's /head read and name a devnet. */
  async function submit(operation, key, head, nonce, t) {
    const kind = { 'request-devnet-funds': 'deposit', 'submit-order': 'order', 'cancel-all': 'cancel-all' }[operation];
    if (!kind || capability(operation) !== TRADE || t?.tx !== kind) throw Error('未宣言の操作です。');
    if (!head || !isDevnet(head.chainId)) throw Error('devnet と確認できないノードには署名しません。');
    const protocol = protocolFor(head);
    if (!protocol.txs.includes(kind)) throw Error('このノードはこの取引に対応していません。何も送信していません。');
    const envelope = await signEnvelope(key, head.chainId, nonce, t, protocol.fields);
    const response = await broker.invoke({ capability: TRADE, service: SERVICE, operation },
      { input: TX_URL, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) } });
    return txView(response.status, JSON.parse(await boundedText(response)));
  }
  return { runtime, read, submit };
}

// ── page (AWAI-3415: Figma 315:2, docs/design/awai-design-system.md) ─────────
// Tabs 取引 / チャート / 口座 and an order ticket. Every read and transaction is
// still its own canonical-broker operation; denial sends nothing and keeps the
// last values with their fetch time. Nothing refreshes automatically.

const REASON_TEXT = {
  'bad-nonce': '順番番号が古くなっています。口座を取得し直してください。', 'bad-signature': '署名をノードが受け付けませんでした（ノードの版が違う可能性）。',
  'wrong-key': 'この口座は別の鍵に結び付いています。', 'not-your-account': 'この鍵の口座ではありません。',
  'insufficient-margin': '証拠金が足りません。数量を減らすか、口座で devnet 資金を受け取ってください。', 'bad-price-level': '価格（レベル）を確認してください。',
  'bad-quantity': '数量を確認してください。', 'bad-amount': '量を確認してください。', 'not-the-bridge': 'このノードでは資金を受け取れません。',
};
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  trade: [['path', { d: 'M7 4v13l-3-3M17 20V7l3 3' }]],
  chart: [['path', { d: 'M6 3v4M6 14v7M12 6v3M12 17v4M18 3v3M18 13v8' }], ['rect', { x: 4, y: 7, width: 4, height: 7, rx: 1 }], ['rect', { x: 10, y: 9, width: 4, height: 8, rx: 1 }], ['rect', { x: 16, y: 6, width: 4, height: 7, rx: 1 }]],
  account: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6' }]],
};
function svg(tag, attrs = {}, cls) { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (cls) n.setAttribute('class', cls); return n; }
function icon(name) { const s = svg('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true' }, 'tk-icon'); for (const [t, a] of ICONS[name]) s.append(svg(t, a)); return s; }

/** 1, 2 or 5 × 10^n at or above x: readable axis steps. */
export function niceStep(x) { const e = 10 ** Math.floor(Math.log10(Math.max(x, 1e-9))); return [1, 2, 5, 10].map((m) => m * e).find((v) => v >= x); }
/** Candles as SVG: wick + body per candle, optional volume, right price axis, last-price line. */
export function candleChart(candles, { width = 360, height = 160, volume = false } = {}) {
  const s = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `ローソク足 ${candles.length} 本` }, 'tk-chart');
  if (!candles.length) return s;
  const axis = 52, plotW = width - axis, volH = volume ? Math.round(height * 0.22) : 0, plotH = height - volH - 8;
  let max = Math.max(...candles.map((c) => c.high)), min = Math.min(...candles.map((c) => c.low));
  // A flat devnet series must not look like a crash: show at least 0.2% of the price.
  const minSpan = Math.max(20, candles[candles.length - 1].close * 0.002);
  if (max - min < minSpan) { const mid = (max + min) / 2; max = mid + minSpan / 2; min = mid - minSpan / 2; }
  const step = niceStep((max - min) / 4); max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
  const y = (v) => ((max - v) / (max - min)) * plotH;
  const fmt = (n) => new Intl.NumberFormat('ja-JP').format(Math.round(n));
  const lastY = y(candles[candles.length - 1].close);
  for (let v = min; v <= max + step / 2; v += step) { s.append(svg('line', { x1: 0, x2: plotW, y1: y(v), y2: y(v) }, 'tk-grid')); if (Math.abs(y(v) - lastY) < 14) continue; const t = svg('text', { x: plotW + 6, y: Math.min(plotH, Math.max(10, y(v) + 4)) }, 'tk-axis'); t.textContent = fmt(v); s.append(t); }
  const slot = plotW / Math.max(candles.length, 12), bw = Math.max(3, slot * 0.6), vmax = Math.max(1, ...candles.map((c) => c.volume));
  candles.forEach((c, i) => {
    const up = c.close >= c.open, cls = up ? 'up' : 'down', cx = i * slot + slot / 2;
    s.append(svg('line', { x1: cx, x2: cx, y1: y(c.high), y2: y(c.low) }, `tk-wick ${cls}`));
    s.append(svg('rect', { x: cx - bw / 2, y: Math.min(y(c.open), y(c.close)), width: bw, height: Math.max(2, Math.abs(y(c.open) - y(c.close))), rx: 1 }, `tk-body ${cls}`));
    if (volume) { const vh = Math.max(2, (c.volume / vmax) * (volH - 4)); s.append(svg('rect', { x: cx - bw / 2, y: height - vh, width: bw, height: vh }, `tk-vol ${cls}`)); }
  });
  const last = candles[candles.length - 1];
  s.append(svg('line', { x1: 0, x2: plotW, y1: y(last.close), y2: y(last.close) }, 'tk-last'));
  const tag = svg('text', { x: plotW + 6, y: Math.max(10, y(last.close) + 4) }, 'tk-axis tk-last-label'); tag.textContent = fmt(last.close); s.append(tag);
  return s;
}

export function renderTorihiki({ root, page, el, button, notify, client, state, keyStore }) {
  const p = page(state.view === 'ticket' ? '注文' : 'BTC-PERP', state.view === 'ticket' ? () => { state.view = null; draw(); } : undefined);
  p.classList.add('tk-page');
  const titleBar = p.querySelector('.app-bar'); titleBar.append(el('span', 'caption muted tk-sub', state.view === 'ticket' ? 'BTC-PERP · devnet' : 'Torihiki · 市場 #1'));
  const main = el('div', 'tk-main'); p.append(main);
  // A new tab or view starts at the top; re-renders inside the same view keep the scroll position.
  const viewKey = `${state.tab}/${state.view}`; if (state.viewKey !== undefined && state.viewKey !== viewKey) queueMicrotask(() => window.scrollTo(0, 0)); state.viewKey = viewKey;
  state.tab ??= 'trade'; state.list ??= 'book'; state.span ??= '10'; state.side ??= 0; state.flags ??= 0; state.qty ??= 1; state.candles ??= {};
  const fmt = (n) => new Intl.NumberFormat('ja-JP').format(n);
  const time = (d) => new Intl.DateTimeFormat('ja-JP', { timeStyle: 'medium' }).format(d);
  const chip = (text, tone = 'neutral') => el('span', `tk-chip ${tone}`, text);
  const stat = (label, value) => { const d = el('div', 'tk-stat'); d.append(el('span', 'caption muted', label), el('strong', '', value)); return d; };
  const banner = (n) => { const b = el('section', `tk-banner ${n.tone}`); b.setAttribute('role', n.tone === 'error' ? 'alert' : 'status'); b.append(el('strong', '', n.title), el('p', '', n.body)); if (n.retry) b.append(button('再試行', n.retry, 'button tonal tk-retry')); return b; };
  const segs = (items, current, pick, label) => { const g = el('div', 'tk-segs'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label); for (const [v, t] of items) { const b = button(t, () => { pick(v); draw(); }, 'tk-seg'); b.setAttribute('aria-pressed', String(v === current)); g.append(b); } return g; };
  const denied = (e) => /not approved/.test(e?.message || '');
  if (!client) { main.append(banner({ tone: 'error', title: '通信の宣言を確認できません', body: 'この端末では取得も発注もできません。何も送信していません。' })); return; }
  if (state.key === undefined) { state.key = null; loadKey(keyStore).then((k) => { state.key = k; draw(); }).catch(() => { state.key = null; }); }

  function draw() { root.replaceChildren(); renderTorihiki({ root, page, el, button, notify, client, state, keyStore }); }
  function noticeFor(e, retry) {
    return denied(e) ? { tone: 'info', title: '拒否しました', body: state.at ? `何も送信していません。表示中の値は ${time(state.at)} の取得のままです。` : '何も送信していません。必要なときにもう一度取得できます。' }
      : { tone: 'error', title: '取得できませんでした', body: `${e.message} 値は推測しません。`, retry };
  }
  /** Run reads one after another; each is its own consent. Stops at the first denial or error. */
  async function fetchAll(ops) {
    state.busy = true; state.notice = null; draw();
    try {
      for (const [op, keyName, arg] of ops) {
        const v = await client.read(op, arg);
        if (keyName === 'head') { const prev = state.head; if (prev && prev.height === v.height && state.headAt && Date.now() - state.headAt > 60000) state.stale = { height: v.height, since: state.headAt }; else if (!prev || prev.height !== v.height) state.stale = null; state.headAt = state.headAt && prev?.height === v.height ? state.headAt : Date.now(); }
        if (keyName.startsWith('candles:')) state.candles[keyName.slice(8)] = v; else state[keyName] = v;
        state.at = new Date();
      }
    } catch (e) { state.notice = noticeFor(e, () => fetchAll(ops)); }
    finally { state.busy = false; draw(); }
  }
  const fetchButton = (label, ops, cls = 'button') => { const b = button(state.busy ? '取得しています…' : label, () => fetchAll(ops), cls); b.disabled = !!state.busy; return b; };

  // ── shared header ──
  const chips = el('div', 'tk-chips'); chips.append(chip('devnet・デモ専用', 'warning'), chip('単一シーケンサー'), chip('担保の裏付けなし'));
  if (state.view !== 'ticket') main.append(chips);
  if (state.notice) main.append(banner(state.notice));
  if (state.stale && state.view !== 'ticket') main.append(banner({ tone: 'warning', title: 'チェーンが進んでいない可能性', body: `ブロック高は ${fmt(state.stale.height)} のまま（${time(new Date(state.stale.since))} から）。表示中の価格は最新とは限りません。` }));
  if (state.lastTx && state.view !== 'ticket' && state.tab === 'trade') {
    const t = state.lastTx;
    main.append(banner(t.ok ? { tone: 'info', title: 'devnet に送信しました', body: `${t.summary}。ノードが受け付けた高さ ${fmt(t.height)}。約定は「口座」で確認できます。` }
      : { tone: 'error', title: '受け付けられませんでした', body: `${REASON_TEXT[t.reason] || t.reason || '理由不明'}${t.nonceSpent ? '' : ' ノードでは何も変わっていません。'}` }));
  }

  const marketOps = [['read-market', 'market'], ['read-book', 'book']];
  function priceHeader() {
    const m = state.market, h = el('div', 'tk-price');
    h.append(el('span', 'caption muted', 'マーク価格'));
    const row = el('div', 'tk-price-row'); row.append(el('strong', 'tk-mark', m ? fmt(m.mark) : '—'));
    if (m) row.append(chip(`${m.last >= m.mark ? '▲' : '▼'} 直近 ${fmt(m.last)}`, m.last >= m.mark ? 'up' : 'down'));
    else row.append(chip('未取得'));
    h.append(row); return h;
  }
  function chartCard(span, big) {
    const c = state.candles[span];
    const wrap = el('div', big ? 'tk-chart-wrap big' : 'tk-chart-wrap');
    if (c) {
      wrap.append(candleChart(c.candles, big ? { height: 300, volume: true } : { height: 150 }));
      if (c.truncated) wrap.append(el('p', 'caption muted', `ノードに古いブロックがないため ${c.candles.length} 本です。`));
    } else wrap.append(el('p', 'caption muted', 'チャートはまだ取得していません。'), fetchButton('チャートを取得', [[`read-candles-${span}`, `candles:${span}`]], 'button tonal'));
    return wrap;
  }

  if (state.view === 'ticket') return ticket();
  ({ trade, chart, account }[state.tab] || trade)();
  tabs();

  function trade() {
    if (!state.market) {
      main.append(priceHeader());
      const card = el('section', 'card tk-empty'); card.append(el('h2', '', 'まだ何も取得していません'), el('p', 'muted', '取得するときに、接続先と送る情報を確認する画面が開きます。自動では通信しません。'), fetchButton('価格と板を取得', marketOps));
      main.append(card);
    } else {
      const m = state.market; main.append(priceHeader());
      const stats = el('div', 'tk-stats'); stats.append(stat('オラクル', fmt(m.oracle) + (m.oracleStale ? '（古い）' : '')), stat('建玉', fmt(m.openInterest)), stat('資金調達率（生値）', String(m.fundingRate)), stat('最大', m.maxLeverage === null ? '—' : `${m.maxLeverage}×`));
      main.append(stats);
      main.append(segs([['1', '1 ブロック'], ['10', '10 ブロック'], ['50', '50 ブロック']], state.span, (v) => { state.span = v; }, 'ローソク足の幅'), chartCard(state.span, false));
      main.append(segs([['book', '板'], ['trades', '約定']], state.list, (v) => { state.list = v; }, '表示'));
      main.append(state.list === 'book' ? bookList() : tradeList());
      main.append(el('p', 'caption muted', `最終取得 ${time(state.at)} · 自動更新しません`), fetchButton('価格と板を更新', marketOps, 'button tonal'));
    }
    const act = el('div', 'tk-actions');
    const best = (s) => state.book?.[s]?.[0]?.level;
    for (const [label, side, cls, lvl] of [['買う', 0, 'up', best('asks')], ['売る', 1, 'down', best('bids')]]) {
      const b = button('', () => { state.view = 'ticket'; state.side = side; state.level = lvl ?? state.market?.mark ?? state.level; draw(); }, `tk-big ${cls}`);
      b.append(el('strong', '', label), el('span', 'caption', lvl ? `${fmt(lvl)} で` : '価格を選ぶ')); act.append(b);
    }
    root.append(act);
  }
  function bookList() {
    const b = state.book; const box = el('div', 'tk-book');
    if (!b) { box.append(el('p', 'caption muted', '板はまだ取得していません。')); return box; }
    const head = el('div', 'tk-row tk-head'); head.append(el('span', '', '価格'), el('span', '', '数量')); box.append(head);
    const asks = [...b.asks].reverse(), all = [...b.asks, ...b.bids];
    const cum = (rows) => { let t = 0; return rows.map((r) => (t += r.qty)); };
    const maxCum = Math.max(1, ...cum(b.asks), ...cum(b.bids));
    const row = (r, c, side) => { const d = el('div', `tk-row tk-level ${side}`); d.style.setProperty('--depth', `${Math.round((c / maxCum) * 100)}%`); d.append(el('span', 'tk-px', fmt(r.level)), el('span', '', fmt(r.qty))); return d; };
    const askCum = cum(b.asks).reverse();
    asks.forEach((r, i) => box.append(row(r, askCum[i], 'ask')));
    const spread = b.asks[0] && b.bids[0] ? b.asks[0].level - b.bids[0].level : null;
    const mid = el('div', 'tk-row tk-spread'); mid.append(el('span', '', spread === null ? 'スプレッド —' : `スプレッド ${fmt(spread)}`), el('span', '', `売り ${b.asks.length} 段 · 買い ${b.bids.length} 段`)); box.append(mid);
    const bidCum = cum(b.bids); b.bids.forEach((r, i) => box.append(row(r, bidCum[i], 'bid')));
    if (!all.length) box.append(el('p', 'caption muted', '注文はありません。'));
    return box;
  }
  function tradeList() {
    const box = el('div', 'tk-book');
    if (!state.trades) { box.append(el('p', 'caption muted', '約定はまだ取得していません。'), fetchButton('約定を取得', [['read-trades', 'trades']], 'button tonal')); return box; }
    const head = el('div', 'tk-row tk-head tk-trade'); head.append(el('span', '', '売買'), el('span', '', '価格'), el('span', '', '数量'), el('span', '', '高さ')); box.append(head);
    for (const t of state.trades.slice(0, 20)) { const r = el('div', 'tk-row tk-trade'); r.append(el('span', t.side === 0 ? 'up' : 'down', t.side === 0 ? '▲ 買い' : '▼ 売り'), el('span', '', fmt(t.level)), el('span', '', fmt(t.qty)), el('span', 'muted', `#${t.height}`)); box.append(r); }
    if (!state.trades.length) box.append(el('p', 'caption muted', '約定はありません。'));
    box.append(fetchButton('約定を更新', [['read-trades', 'trades']], 'button text'));
    return box;
  }
  function chart() {
    const c = state.candles[state.span], last = c?.candles.at(-1);
    const stats = el('div', 'tk-stats'); for (const [l, k] of [['始値', 'open'], ['高値', 'high'], ['安値', 'low'], ['終値', 'close']]) stats.append(stat(l, last ? fmt(last[k]) : '—'));
    main.append(stats, segs([['1', '1 ブロック'], ['10', '10 ブロック'], ['50', '50 ブロック']], state.span, (v) => { state.span = v; }, 'ローソク足の幅'), chartCard(state.span, true));
    const legend = el('div', 'tk-chips'); legend.append(chip('▲ 上昇の足', 'up'), chip('▼ 下落の足', 'down'), chip('下段: 出来高')); main.append(legend);
    if (c) main.append(el('p', 'caption muted', `1 本 = ${state.span} ブロック · 最終取得 ${time(state.at)} · 自動更新しません`), fetchButton('チャートを更新', [[`read-candles-${state.span}`, `candles:${state.span}`]], 'button tonal'));
  }
  function account() {
    const k = state.key, a = k && state.account?.account === k.account ? state.account : null;
    if (!k) {
      const card = el('section', 'card tk-key'); card.append(el('h2', '', 'この端末の鍵'), el('p', '', '発注にはこの端末の鍵が必要です。秘密鍵は端末の外へ出せない形で保存し、送るのは公開鍵と署名だけです。'),
        button('鍵を作成', async () => { try { state.key = await createKey(keyStore); state.account = null; notify('鍵を作成しました。通信はしていません。'); } catch (e) { state.notice = { tone: 'error', title: '鍵を作れませんでした', body: e.message }; } draw(); }));
      main.append(card); return;
    }
    const eq = el('div', 'tk-price'); eq.append(el('span', 'caption muted', '評価額（生値）'), el('strong', 'tk-mark', a ? fmt(a.equity) : '—')); main.append(eq);
    if (a) {
      const stats = el('div', 'tk-stats'); stats.append(stat('担保', fmt(a.collateral)), stat('使える担保', fmt(a.freeCollateral)), stat('清算対象', a.liquidatable ? 'はい' : 'いいえ')); main.append(stats);
      main.append(el('h2', 'tk-h', 'ポジション'));
      if (!a.positions.length) main.append(el('p', 'caption muted', 'ポジションはありません。'));
      for (const x of a.positions) {
        const card = el('section', 'card tk-pos'); const top = el('div', 'tk-pos-top');
        top.append(el('strong', '', `市場 #${x.market}`), chip(`${x.size > 0 ? '▲ 買い' : '▼ 売り'} ${fmt(Math.abs(x.size))}`, x.size > 0 ? 'up' : 'down'), el('strong', x.unrealized >= 0 ? 'up' : 'down', `${x.unrealized >= 0 ? '+' : '−'}${fmt(Math.abs(x.unrealized))}`));
        const s = el('div', 'tk-stats'); s.append(stat('建値', fmt(x.entry)), stat('未実現損益', `${x.unrealized >= 0 ? '+' : '−'}${fmt(Math.abs(x.unrealized))}`));
        card.append(top, s); main.append(card);
      }
      main.append(el('p', 'caption muted', `最終取得 ${time(state.at)} · 注文の一覧はノードが返さないため、取消は「全注文を取消」だけです。`));
    }
    main.append(fetchButton(a ? '口座を更新' : '口座を取得', [['read-account', 'account', k.account]], a ? 'button tonal' : 'button'));
    const key = el('section', 'card tk-key'); key.append(el('h2', '', 'この端末の鍵'), el('p', 'caption', `口座 ${k.account} · 公開鍵 ${k.pubkey.slice(0, 12)}… · 秘密鍵は端末の外へ出しません。`)); main.append(key);
    const cancelButton = (go) => { const b = button('全注文を取消', go, 'button danger-fill'); if (state.head && !supports(state.head, 'cancel-all')) { b.disabled = true; b.title = 'このノードは未対応'; } return b; };
    const acts = el('div', 'tk-pair');
    acts.append(button('devnet 資金を受け取る', () => withPrereq(() => { const t = buildTx('deposit', { amount: 1000000 }); confirmSign('devnet 資金を受け取る', [['口座', String(k.account)], ['量', fmt(t.amount)], ['チェーン', state.head.chainId]], () => send('request-devnet-funds', t, 'devnet 資金 1,000,000 を受け取り')); }), 'button tonal'),
      cancelButton(() => withPrereq(() => { if (!supports(state.head, 'cancel-all')) throw Error(`このノード（版 ${state.head.codeVersion ?? '不明'}）は全注文の取消に対応していません。何も送信していません。`); const t = buildTx('cancel-all'); confirmSign('市場 #1 の注文をすべて取り消しますか？', [['口座', String(k.account)], ['チェーン', state.head.chainId]], () => send('cancel-all', t, '全注文の取消')); })));
    main.append(acts);
    if (state.head && !supports(state.head, 'cancel-all')) main.append(el('p', 'caption muted', `接続中のノード（版 ${state.head.codeVersion ?? '不明'}）は全注文の取消に対応していません。`));
    const node = el('section', 'card tk-node'); node.append(el('h2', '', 'ノード'));
    if (state.head) { const s = el('div', 'tk-stats'); s.append(stat('チェーン', state.head.chainId), stat('高さ', fmt(state.head.height)), stat('合意', state.head.consensus.startsWith('none') ? '単一シーケンサー' : state.head.consensus)); node.append(s); }
    node.append(fetchButton(state.head ? 'ノードを更新' : 'ノードの状態を取得', [['read-head', 'head']], 'button text')); main.append(node);
    main.append(button('この端末の鍵を削除', () => {
      const d = document.createElement('dialog');
      d.append(el('h2', '', 'この端末の鍵を削除しますか？'), el('p', 'muted', `口座 ${k.account} には、この鍵なしでは二度と署名できません（devnet のみ）。取り消せません。`),
        button('削除', async () => { d.close(); await deleteKey(keyStore); state.key = null; state.account = null; notify('鍵を削除しました。'); draw(); }, 'button danger'), button('残す', () => d.close(), 'button tonal'));
      d.addEventListener('close', () => d.remove(), { once: true }); document.body.append(d); d.showModal();
    }, 'button text'));
  }
  function ticket() {
    const m = state.market, b = state.book;
    main.append(segs([[0, '買い'], [1, '売り']], state.side, (v) => { state.side = v; }, '売買'));
    main.lastChild.classList.add('tk-side', state.side === 0 ? 'buy' : 'sell');
    main.append(segs([[0, '指値'], [1, '成行（すぐ約定・IOC）']], state.flags, (v) => { state.flags = v; }, '注文の種類'));
    const field = (label, id, value, unit, min, max, set) => { const f = el('div', 'field tk-field'), l = el('label', '', label), box = el('div', 'tk-input'), i = el('input'); i.id = id; i.type = 'number'; i.inputMode = 'numeric'; i.step = '1'; i.min = String(min); i.max = String(max); i.value = value === undefined ? '' : String(value); i.addEventListener('change', () => { set(i.valueAsNumber); draw(); }); l.htmlFor = id; box.append(i, el('span', 'muted', unit)); f.append(l, box); return f; };
    state.level ??= m?.mark;
    main.append(field('価格（レベル）', 'tk-level', state.level, '生値', 1, 1048575, (v) => { state.level = v; }));
    const quick = el('div', 'tk-chips'); for (const [l, v] of [['最良売り', b?.asks[0]?.level], ['マーク', m?.mark], ['最良買い', b?.bids[0]?.level]]) if (v) quick.append(button(`${l} ${fmt(v)}`, () => { state.level = v; draw(); }, 'tk-chip neutral tk-pick')); main.append(quick);
    main.append(field('数量', 'tk-qty', state.qty, 'ロット', 1, 1e9, (v) => { state.qty = v; }));
    const qq = el('div', 'tk-chips'); for (const v of [1, 2, 5, 10]) qq.append(button(String(v), () => { state.qty = v; draw(); }, 'tk-chip neutral tk-pick')); main.append(qq);
    const notional = Number.isSafeInteger(state.level) && Number.isSafeInteger(state.qty) ? state.level * state.qty : null;
    const sum = el('section', 'card tk-summary');
    const line = (k, v) => { const r = el('div', 'tk-line'); r.append(el('span', 'muted', k), el('strong', '', v)); sum.append(r); };
    line('注文額（生値）', notional === null ? '—' : fmt(notional));
    line(`必要証拠金（${m?.initialMarginRate ? (m.initialMarginRate / RATE_SCALE * 100).toFixed(2) + '%' : '—'}）`, notional !== null && m?.initialMarginRate ? fmt(Math.ceil(notional * m.initialMarginRate / RATE_SCALE)) : '—');
    line(`手数料（テイカー ${m?.takerFeeRate ? (m.takerFeeRate / RATE_SCALE * 100).toFixed(3) + '%' : '—'}）`, notional !== null && m?.takerFeeRate ? fmt(Math.ceil(notional * m.takerFeeRate / RATE_SCALE)) : '—');
    line('清算価格', '送信前は計算しません'); main.append(sum);
    if (!state.key) { main.append(banner({ tone: 'warning', title: 'この端末の鍵がありません', body: '「口座」で鍵を作成すると発注できます。' })); return; }
    const side = state.side === 0 ? '買い' : '売り';
    const go = button('', () => withPrereq(() => {
      const t = buildTx('order', { side: state.side, level: state.level, qty: state.qty, flags: state.flags });
      confirmSign('この注文を送信しますか？', [['市場', '#1 BTC-PERP'], ['売買', side], ['価格（レベル）', fmt(t.level)], ['数量', fmt(t.qty)], ['種類', t.flags === 1 ? '成行（IOC）' : '指値'], ['口座', String(state.key.account)], ['チェーン', state.head.chainId]],
        () => send('submit-order', t, `${side} ${fmt(t.qty)} @ ${fmt(t.level)}`, true));
    }), `tk-big ${state.side === 0 ? 'up' : 'down'} tk-submit`);
    go.append(el('strong', '', `${side} ${state.qty ?? '—'} を署名して送る`), el('span', 'caption', '送信先と内容を確認する画面が続きます'));
    main.append(go, el('p', 'caption muted', 'devnet・デモ専用。実際の資産は動きません。署名にはこの端末の鍵を使い、秘密鍵は端末の外へ出ません。'));
  }
  function tabs() {
    const nav = el('nav', 'tk-tabs'); nav.setAttribute('aria-label', 'Torihiki');
    for (const [k, l] of [['trade', '取引'], ['chart', 'チャート'], ['account', '口座']]) { const b = button('', () => { state.tab = k; state.view = null; draw(); }, 'tk-tab'); b.setAttribute('aria-pressed', String(state.tab === k)); const pill = el('span', 'tk-pill'); pill.append(icon(k)); b.append(pill, el('span', '', l)); nav.append(b); }
    root.append(nav);
  }
  /** Signing needs this session's devnet /head and the account's next nonce; each read is its own consent. */
  async function withPrereq(go) {
    try {
      const k = state.key; if (!k) throw Error('先に「口座」で鍵を作成してください。');
      const ops = []; if (!state.head) ops.push(['read-head', 'head']); if (!state.account || state.account.account !== k.account) ops.push(['read-account', 'account', k.account]);
      for (const [op, key, arg] of ops) { state[key] = await client.read(op, arg); state.at = new Date(); }
      if (!isDevnet(state.head.chainId)) throw Error(`接続先のチェーン（${state.head.chainId}）は devnet ではないため署名しません。`);
      protocolFor(state.head);
      go();
    } catch (e) { state.notice = denied(e) ? noticeFor(e) : { tone: 'error', title: '送信できません', body: e.message }; draw(); }
  }
  // The person checks what will be signed here; the broker's trusted consent then decides whether it is sent.
  function confirmSign(title, lines, go) {
    const d = document.createElement('dialog');
    const dl = el('dl'); for (const [k, v] of lines) dl.append(el('dt', '', k), el('dd', '', v));
    d.append(el('h2', '', title), dl, el('p', 'caption muted', '次の確認画面で送信を許可すると、この内容を端末の鍵で署名して devnet ノードへ送ります。'),
      button('署名して送信へ', () => { d.close(); go(); }), button('やめる', () => d.close(), 'button tonal'));
    d.addEventListener('close', () => d.remove(), { once: true }); document.body.append(d); d.showModal();
  }
  async function send(operation, t, summary, toTrade) {
    try {
      const r = await client.submit(operation, state.key, state.head, state.account.nextNonce, t);
      if (r.nonceSpent) state.account = { ...state.account, nextNonce: state.account.nextNonce + 1 };
      state.lastTx = { operation, summary, ...r, at: new Date() }; state.notice = null;
      if (toTrade) { state.view = null; state.tab = 'trade'; }
      notify(r.ok ? `${summary}を送信しました（ブロック ${r.height}）` : `受け付けられませんでした: ${REASON_TEXT[r.reason] || r.reason || '理由不明'}`, !r.ok);
    } catch (e) { state.notice = denied(e) ? { tone: 'info', title: '送信をやめました', body: '何も送信していません。署名は破棄しました。' } : { tone: 'error', title: '送信できませんでした', body: e.message }; }
    draw();
  }
}
