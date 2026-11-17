import { clientRuntimeProblems, createClientConsentHost, createClientOperationBroker } from './runtime.js';

// Torihiki devnet viewer. Read-only: no keys, no orders, no faucet (AWAI-491).
// The node is a single sequencer with unbacked devnet collateral; it is not a
// market for real assets. Every request is its own operation with its own
// trusted user choice through the canonical broker; denial sends nothing.
export const TORIHIKI_NODE = 'https://torihiki-node.04-feasts-minded.workers.dev';
export const TORIHIKI_MARKET = '1';
const CAPABILITY = 'torihiki-read';
const SERVICE = 'torihiki-devnet';
const MAX_RESPONSE_BYTES = 65536;
const routes = {
  'read-head': { method: 'GET', path: '/head', 'query-params': [] },
  'read-market': { method: 'GET', path: '/market', 'query-params': ['id'], 'query-values': { id: TORIHIKI_MARKET } },
  'read-book': { method: 'GET', path: '/book', 'query-params': ['market', 'depth'], 'query-values': { market: TORIHIKI_MARKET, depth: '15' } },
};
export const torihikiUrls = {
  'read-head': `${TORIHIKI_NODE}/head`,
  'read-market': `${TORIHIKI_NODE}/market?id=${TORIHIKI_MARKET}`,
  'read-book': `${TORIHIKI_NODE}/book?market=${TORIHIKI_MARKET}&depth=15`,
};

export function torihikiRuntime(base) {
  return { ...base, operations: Object.entries(routes).map(([operation, route]) => ({
    capability: CAPABILITY, service: SERVICE, operation, consent: 'each-operation',
    'data-categories': ['request-ip', 'market-id'],
    endpoint: { origin: TORIHIKI_NODE, routes: [route] },
  })) };
}

const int = (x) => Number.isSafeInteger(x);
const optionalInt = (x) => x === null || int(x);
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
    fundingRate: v['funding-rate'], maxLeverage: v['max-leverage'], oracleStale: v['oracle-stale'] };
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

async function boundedJson(response) {
  if (!response.ok) throw Error(`ノードが ${response.status} を返しました。`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw Error('応答が大きすぎます。');
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw Error('応答が大きすぎます。');
  return JSON.parse(text);
}

export function createTorihiki(base, appOrigin = location.origin) {
  const runtime = torihikiRuntime(base);
  if (clientRuntimeProblems(runtime, [CAPABILITY], appOrigin).length) throw Error('Torihiki の通信宣言を確認できません。');
  const broker = createClientOperationBroker({ runtime, requestedCapabilities: [CAPABILITY], approvedOperations: runtime.operations,
    hostSupportedOperations: runtime.operations.map((o) => [o.capability, o.service, o.operation]), consentHost: createClientConsentHost() });
  // Eligibility is a ceiling. Each read still needs the canonical trusted user choice.
  return { runtime, async read(operation) {
    if (!Object.hasOwn(torihikiUrls, operation)) throw Error('未宣言の操作です。');
    const response = await broker.invoke({ capability: CAPABILITY, service: SERVICE, operation },
      { input: torihikiUrls[operation], init: { method: 'GET' } });
    const body = await boundedJson(response);
    return operation === 'read-head' ? headView(body) : operation === 'read-market' ? marketView(body) : bookView(body);
  } };
}

export function renderTorihiki({ root, page, el, button, notify, client, state }) {
  const p = page('Torihiki');
  p.append(el('span', 'badge', 'devnet・デモ専用'),
    el('p', 'muted', '取引所 devnet の状態を読み取って表示します。実際の資産は扱いません。発注・鍵の作成はこの版にはありません。'),
    el('p', 'caption muted', `接続先: ${TORIHIKI_NODE}（単一シーケンサー・担保は裏付けなし）。取得のたびに確認画面が開き、拒否すると何も送信しません。`));
  if (!client) { p.append(el('p', 'empty muted', 'この端末では通信の宣言を確認できないため、取得できません。')); return; }
  const actions = el('div', 'actions');
  const load = (operation, key, label) => button(label, async () => {
    try { state[key] = await client.read(operation); state.at = new Date(); notify('devnet から取得しました。'); render(); }
    catch (error) { notify(/not approved/.test(error.message) ? '取得を中止しました。何も送信していません。' : '取得できません。' + error.message, true); }
  }, 'button tonal');
  actions.append(load('read-market', 'market', '価格を取得'), load('read-book', 'book', '板を取得'), load('read-head', 'head', 'ノードの状態を取得'));
  p.append(actions);
  const body = el('div', 'torihiki-body');
  p.append(body);
  function render() {
    body.replaceChildren();
    const fmt = (n) => new Intl.NumberFormat('ja-JP').format(n);
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
      for (const [k, v] of [['チェーン', h.chainId], ['ブロック高', fmt(h.height)], ['合意', h.consensus], ['状態ルート', h.stateRoot.slice(0, 16) + '…']])
        dl.append(el('dt', '', k), el('dd', '', v));
      card.append(el('h2', '', 'ノードの状態'), dl);
      body.append(card);
    }
    if (state.at) body.append(el('p', 'caption muted', `最終取得: ${new Intl.DateTimeFormat('ja-JP', { timeStyle: 'medium' }).format(state.at)}（自動更新はしません）`));
    else body.append(el('p', 'empty muted', 'まだ取得していません。'));
  }
  render();
}
