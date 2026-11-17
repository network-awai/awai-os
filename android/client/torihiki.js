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
// torihiki.address: ids below FLOOR are genesis roles; ids live in 2^45.
const FLOOR = 100000, SPACE = 35184372088832;

const tx = { method: 'POST', path: '/tx', 'query-params': [] };
const operations = [
  [READ, 'read-head', { method: 'GET', path: '/head', 'query-params': [] }, ['request-ip']],
  [READ, 'read-market', { method: 'GET', path: '/market', 'query-params': ['id'], 'query-values': { id: TORIHIKI_MARKET } }, ['request-ip', 'market-id']],
  [READ, 'read-book', { method: 'GET', path: '/book', 'query-params': ['market', 'depth'], 'query-values': { market: TORIHIKI_MARKET, depth: '15' } }, ['request-ip', 'market-id']],
  [READ, 'read-account', { method: 'GET', path: '/account', 'query-params': ['id'] }, ['request-ip', 'account-id']],
  [TRADE, 'request-devnet-funds', tx, ['request-ip', 'account-id', 'public-key', 'signed-transaction']],
  [TRADE, 'submit-order', tx, ['request-ip', 'account-id', 'public-key', 'signed-transaction', 'order']],
  [TRADE, 'cancel-all', tx, ['request-ip', 'account-id', 'public-key', 'signed-transaction', 'market-id']],
];
export const torihikiUrls = {
  'read-head': `${TORIHIKI_NODE}/head`,
  'read-market': `${TORIHIKI_NODE}/market?id=${TORIHIKI_MARKET}`,
  'read-book': `${TORIHIKI_NODE}/book?market=${TORIHIKI_MARKET}&depth=15`,
};
export const accountUrl = (id) => `${TORIHIKI_NODE}/account?id=${accountId(id)}`;
export const TX_URL = `${TORIHIKI_NODE}/tx`;

export function torihikiRuntime(base) {
  return { ...base, operations: operations.map(([capability, operation, route, categories]) => ({
    capability, service: SERVICE, operation, consent: 'each-operation',
    'data-categories': categories,
    endpoint: { origin: TORIHIKI_NODE, routes: [route] },
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
export function signingPayload(chainId, account, nonce, t) {
  if (typeof chainId !== 'string' || !/^[\x21-\x7e]{1,80}$/.test(chainId) || !int(account) || !inRange(nonce, 1, 9007199254740991)) throw Error('署名の前提を確認できません。');
  const allowed = { order: ['tx', 'market', 'side', 'level', 'qty', 'flags'], 'cancel-all': ['tx', 'market'], deposit: ['tx', 'amount'] }[t?.tx];
  if (!allowed || Object.keys(t).some((k) => !allowed.includes(k))) throw Error('この版で扱わない取引です。');
  const f = Array(FIELD_COUNT).fill('');
  const put = (i, v) => { if (v !== undefined) f[i] = String(v); };
  // f0 tx, f1 market, f2 side, f3 level, f4 qty, f5 flags, f6 oid, f7 amount
  put(0, t.tx); put(1, t.market); put(2, t.side); put(3, t.level); put(4, t.qty); put(5, t.flags); put(7, t.amount);
  return `torihiki/tx/v1\nchain=${chainId}\naccount=${account}\nnonce=${nonce}\n${f.map((v, i) => `f${i}=${v}`).join('\n')}\n`;
}

export async function signEnvelope(key, chainId, nonce, t) {
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, enc.encode(signingPayload(chainId, key.account, nonce, t)));
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
    consensus: typeof v.consensus === 'string' ? v.consensus.slice(0, 120) : '不明' };
}
export function marketView(v) {
  if (!v || typeof v !== 'object' || String(v.id) !== TORIHIKI_MARKET
      || ![v.mark, v.oracle, v.last, v['open-interest'], v['funding-rate']].every(int)
      || !optionalInt(v['max-leverage']) || typeof v['oracle-stale'] !== 'boolean') throw Error('市場の応答を確認できません。');
  return { id: v.id, mark: v.mark, oracle: v.oracle, last: v.last, openInterest: v['open-interest'],
    fundingRate: v['funding-rate'], maxLeverage: v['max-leverage'] ?? null, oracleStale: v['oracle-stale'] };
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
      : operation === 'read-book' ? bookView(body) : accountView(body, account);
  }
  /** Sign and send one transaction. `head` must be this session's /head read and name a devnet. */
  async function submit(operation, key, head, nonce, t) {
    const kind = { 'request-devnet-funds': 'deposit', 'submit-order': 'order', 'cancel-all': 'cancel-all' }[operation];
    if (!kind || capability(operation) !== TRADE || t?.tx !== kind) throw Error('未宣言の操作です。');
    if (!head || !isDevnet(head.chainId)) throw Error('devnet と確認できないノードには署名しません。');
    const envelope = await signEnvelope(key, head.chainId, nonce, t);
    const response = await broker.invoke({ capability: TRADE, service: SERVICE, operation },
      { input: TX_URL, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) } });
    return txView(response.status, JSON.parse(await boundedText(response)));
  }
  return { runtime, read, submit };
}

// ── page ─────────────────────────────────────────────────────────────────────

const REASON_TEXT = {
  'bad-nonce': '順番番号が古くなっています。口座を取得し直してください。', 'bad-signature': '署名をノードが受け付けませんでした（ノードの版が違う可能性）。',
  'wrong-key': 'この口座は別の鍵に結び付いています。', 'not-your-account': 'この鍵の口座ではありません。',
  'insufficient-margin': '証拠金が足りません。devnet 資金を受け取ってください。', 'bad-price-level': '価格（レベル）を確認してください。',
  'bad-quantity': '数量を確認してください。', 'bad-amount': '量を確認してください。', 'not-the-bridge': 'このノードでは資金を受け取れません。',
};

export function renderTorihiki({ root, page, el, button, notify, client, state, keyStore }) {
  const p = page('Torihiki');
  p.append(el('span', 'badge', 'devnet・デモ専用'),
    el('p', 'muted', '取引所 devnet の状態を読み取り、devnet で発注できます。実際の資産は扱いません。'),
    el('p', 'caption muted', `接続先: ${TORIHIKI_NODE}（単一シーケンサー・担保は裏付けなし）。通信のたびに確認画面が開き、拒否すると何も送信しません。`));
  if (!client) { p.append(el('p', 'empty muted', 'この端末では通信の宣言を確認できないため、取得できません。')); return; }
  const fail = (error) => notify(/not approved/.test(error.message) ? '中止しました。何も送信していません。' : '実行できません。' + error.message, true);
  const run = (fn) => async () => { try { await fn(); } catch (error) { fail(error); } render(); };
  const load = (operation, key, label) => button(label, run(async () => {
    state[key] = await client.read(operation); state.at = new Date(); notify('devnet から取得しました。');
  }), 'button tonal');
  const actions = el('div', 'actions');
  actions.append(load('read-market', 'market', '価格を取得'), load('read-book', 'book', '板を取得'), load('read-head', 'head', 'ノードの状態を取得'));
  p.append(actions);
  const trade = el('section', 'card torihiki-trade');
  const body = el('div', 'torihiki-body');
  p.append(trade, body);
  if (state.key === undefined) {
    state.key = null;
    loadKey(keyStore).then((k) => { state.key = k; render(); }).catch(() => { state.key = null; });
  }

  // Ask the person to check what will be signed, then hand over to the broker's trusted consent.
  function confirmSign(title, lines, go) {
    const d = document.createElement('dialog');
    const dl = el('dl'); for (const [k, v] of lines) dl.append(el('dt', '', k), el('dd', '', v));
    d.append(el('h2', '', title), dl,
      el('p', 'caption muted', '次の確認画面で送信を許可すると、この内容を端末の鍵で署名して devnet ノードへ送ります。'),
      button('署名して送信へ', () => { d.close(); run(go)(); }), button('やめる', () => d.close(), 'button tonal'));
    d.addEventListener('close', () => d.remove(), { once: true });
    document.body.append(d); d.showModal();
  }
  async function send(operation, t, done) {
    if (!state.head) throw Error('先に「ノードの状態を取得」で devnet であることを確認してください。');
    if (!isDevnet(state.head.chainId)) throw Error(`接続先のチェーン（${state.head.chainId}）は devnet ではないため署名しません。`);
    if (!state.account || state.account.account !== state.key.account) throw Error('先に「口座を取得」で順番番号を確認してください。');
    const r = await client.submit(operation, state.key, state.head, state.account.nextNonce, t);
    if (r.nonceSpent) state.account = { ...state.account, nextNonce: state.account.nextNonce + 1 };
    state.lastTx = { operation, ...r, at: new Date() };
    notify(r.ok ? `${done}（ブロック ${r.height}）` : `受け付けられませんでした: ${REASON_TEXT[r.reason] || r.reason || '理由不明'}`, !r.ok);
  }
  const intField = (label, id, value, min, max) => {
    const f = el('div', 'field'), l = el('label', '', label), i = el('input');
    i.id = id; i.type = 'number'; i.inputMode = 'numeric'; i.step = '1'; i.min = String(min); i.max = String(max); i.value = String(value); i.required = true;
    l.htmlFor = id; f.append(l, i); return [f, i];
  };
  const fmt = (n) => new Intl.NumberFormat('ja-JP').format(n);

  function renderTrade() {
    trade.replaceChildren(el('h2', '', '発注（devnet）'));
    if (!state.key) {
      trade.append(el('p', 'muted', '発注にはこの端末の鍵が必要です。鍵の秘密部分は端末の外へ出せない形で保存され、送信されるのは公開鍵と署名だけです。'),
        button('鍵を作成', run(async () => { state.key = await createKey(keyStore); state.account = null; notify('鍵を作成しました。通信はしていません。'); })));
      return;
    }
    const k = state.key, a = state.account?.account === k.account ? state.account : null;
    const dl = el('dl');
    const rows = [['口座番号', String(k.account)], ['公開鍵', k.pubkey.slice(0, 16) + '…']];
    if (a) rows.push(['担保', fmt(a.collateral)], ['純資産', fmt(a.equity)], ['使える証拠金', fmt(a.freeCollateral)], ['次の順番番号', String(a.nextNonce)],
      ['ポジション', a.positions.length ? a.positions.map((x) => `#${x.market} ${x.size > 0 ? '買' : '売'} ${fmt(Math.abs(x.size))} @ ${fmt(x.entry)}`).join(' / ') : 'なし']);
    for (const [kk, v] of rows) dl.append(el('dt', '', kk), el('dd', '', v));
    trade.append(dl, button('口座を取得', run(async () => { state.account = await client.read('read-account', k.account); notify('口座を取得しました。'); }), 'button tonal'));
    if (!state.head || !isDevnet(state.head.chainId)) trade.append(el('p', 'caption muted', '署名の前に「ノードの状態を取得」で、接続先が devnet であることを確認します。'));
    if (!a) { trade.append(el('p', 'caption muted', '発注の前に「口座を取得」で順番番号を確認します。')); }

    const [af, amount] = intField('受け取る devnet 資金', 'tk-amount', 1000000, 1, 1e12);
    trade.append(af, button('devnet 資金を受け取る', () => {
      try {
        const t = buildTx('deposit', { amount: amount.valueAsNumber });
        confirmSign('devnet 資金を受け取る', [['口座', String(k.account)], ['量', fmt(t.amount)], ['チェーン', state.head?.chainId ?? '未確認']],
          () => send('request-devnet-funds', t, 'devnet 資金を受け取りました'));
      } catch (error) { fail(error); }
    }, 'button tonal'));

    const sideField = el('div', 'field'), sideLabel = el('label', '', '売買'), side = el('select');
    side.id = 'tk-side'; sideLabel.htmlFor = side.id;
    for (const [v, t] of [['0', '買い'], ['1', '売り']]) { const o = el('option', '', t); o.value = v; side.append(o); }
    sideField.append(sideLabel, side);
    const mark = state.market?.mark ?? 68000;
    const [lf, level] = intField('価格（レベル）', 'tk-level', mark, 1, 1048575);
    const [qf, qty] = intField('数量', 'tk-qty', 1, 1, 1e9);
    const flagField = el('div', 'field'), flagLabel = el('label', '', '注文条件'), flags = el('select');
    flags.id = 'tk-flags'; flagLabel.htmlFor = flags.id;
    for (const [v, t] of [['0', '指値（残りは板に残す）'], ['1', 'IOC（約定しない分は取り消し）'], ['2', 'メイカーのみ'], ['4', '決済のみ']]) { const o = el('option', '', t); o.value = v; flags.append(o); }
    flagField.append(flagLabel, flags);
    trade.append(sideField, lf, qf, flagField, button('注文を送信', () => {
      try {
        const t = buildTx('order', { side: Number(side.value), level: level.valueAsNumber, qty: qty.valueAsNumber, flags: Number(flags.value) });
        confirmSign('この注文を送信しますか？', [['市場', `#${t.market}`], ['売買', t.side === 0 ? '買い' : '売り'], ['価格（レベル）', fmt(t.level)],
          ['数量', fmt(t.qty)], ['注文条件', flags.selectedOptions[0].textContent], ['口座', String(k.account)], ['チェーン', state.head?.chainId ?? '未確認']],
          () => send('submit-order', t, '注文を送信しました'));
      } catch (error) { fail(error); }
    }), button('すべて取り消す', () => {
      const t = buildTx('cancel-all');
      confirmSign('市場 #1 の注文をすべて取り消しますか？', [['口座', String(k.account)], ['チェーン', state.head?.chainId ?? '未確認']],
        () => send('cancel-all', t, '取り消しを送信しました'));
    }, 'button tonal'));
    if (state.lastTx) trade.append(el('p', 'caption muted', `直近の送信: ${state.lastTx.ok ? '受付' : '不受理'}${state.lastTx.reason ? `（${state.lastTx.reason}）` : ''}`));
    trade.append(button('鍵を削除', () => {
      const d = document.createElement('dialog');
      d.append(el('h2', '', 'この端末の鍵を削除しますか？'), el('p', 'muted', `口座 ${k.account} には、この鍵なしでは二度と署名できません（devnet のみ）。`),
        button('削除', run(async () => { d.close(); await deleteKey(keyStore); state.key = null; state.account = null; notify('鍵を削除しました。'); }), 'button danger'),
        button('残す', () => d.close(), 'button tonal'));
      d.addEventListener('close', () => d.remove(), { once: true });
      document.body.append(d); d.showModal();
    }, 'button text'));
  }

  function render() {
    renderTrade();
    body.replaceChildren();
    if (state.market) {
      const m = state.market, card = el('section', 'card'), dl = el('dl');
      for (const [k, v] of [['市場', `#${m.id}`], ['マーク価格', fmt(m.mark)], ['オラクル価格', fmt(m.oracle) + (m.oracleStale ? '（古い値）' : '')],
        ['直近約定', fmt(m.last)], ['建玉', fmt(m.openInterest)], ['資金調達率（生値）', String(m.fundingRate)], ['最大レバレッジ', m.maxLeverage === null ? '未設定' : `${m.maxLeverage} 倍`]])
        dl.append(el('dt', '', k), el('dd', '', v));
      card.append(el('h2', '', '価格'), dl, el('p', 'caption muted', '値はノードが返す整数のままです。通貨単位への換算はしていません。'));
      body.append(card);
    }
    if (state.book) {
      const card = el('section', 'card');
      card.append(el('h2', '', '板（上位 15 段）'));
      for (const [title, rows] of [['売り', [...state.book.asks].reverse()], ['買い', state.book.bids]]) {
        const table = el('table', 'book'), cap = el('caption', '', title), head = el('tr');
        head.append(el('th', '', '価格'), el('th', '', '数量'));
        table.append(cap, head);
        for (const r of rows) { const tr = el('tr'); tr.append(el('td', '', fmt(r.level)), el('td', '', fmt(r.qty))); table.append(tr); }
        if (!rows.length) { const tr = el('tr'); const td = el('td', 'muted', '注文なし'); td.colSpan = 2; tr.append(td); table.append(tr); }
        card.append(table);
      }
      body.append(card);
    }
    if (state.head) {
      const h = state.head, card = el('section', 'card'), dl = el('dl');
      for (const [k, v] of [['チェーン', h.chainId + (isDevnet(h.chainId) ? '' : '（devnet ではないため署名しません）')], ['ブロック高', fmt(h.height)], ['合意', h.consensus], ['状態ルート', h.stateRoot.slice(0, 16) + '…']])
        dl.append(el('dt', '', k), el('dd', '', v));
      card.append(el('h2', '', 'ノードの状態'), dl);
      body.append(card);
    }
    if (state.at) body.append(el('p', 'caption muted', `最終取得: ${new Intl.DateTimeFormat('ja-JP', { timeStyle: 'medium' }).format(state.at)}（自動更新はしません）`));
    else body.append(el('p', 'empty muted', 'まだ取得していません。'));
  }
  render();
}
