// UI messages by stable key. Law titles, numbers and categories are source data, not UI copy, and are never translated.
const ja = {
  'app.title': '法令', 'nav.label': '表示の切り替え', 'nav.search': '法令を探す', 'nav.catalog': '法域の一覧',
  'env.web': 'Web', 'env.tauri': 'Awai Shell / Tauri v3', 'env.line': '{runtime} · {count}件 · 端末内で動作',
  'host.failed': 'ホストを確認できませんでした。閲覧は続けられます。',
  'search.label': '法令名・略称・法令番号で検索', 'search.status': '状態', 'search.all': 'すべて', 'search.current': '現行のみ',
  'search.idle': '日本の法令 {count}件を端末内で検索します。', 'search.none': '該当する法令はありません。',
  'search.count': '{total}件', 'search.countOne': '{total}件', 'search.countTop': '{total}件（上位{shown}件を表示）',
  'law.back': '検索に戻る', 'law.missing': '法令が見つかりません',
  'field.number': '法令番号', 'field.abbrev': '略称', 'field.kind': '種別', 'field.status': '状態', 'field.category': '分野',
  'field.promulgated': '公布日', 'field.effective': '施行日', 'field.repealed': '廃止日', 'field.id': '法令ID', 'field.source': '出典',
  'text.heading': '全文', 'text.absent': '全文はまだこの端末で読めません。', 'text.none': '上流に全文がありません。',
  'text.fetch': '全文を取得', 'text.webOnly': 'この画面を閉じると消えます（Web 版には Awai FS がありません）。', 'text.fetchNote': '取得先は Awai FS（yataverse.com）です。送るのは全文の識別子（CID）だけです。取得の前に確認します。',
  'text.fetching': '全文を取得しています…', 'text.fetched': '全文を取得し、SHA-256 を照合して端末の Awai FS に保存しました。', 'text.cached': '端末の Awai FS に保存した全文です（SHA-256 照合済み）。',
  'text.denied': '取得しませんでした。要求は送っていません。', 'text.mismatch': '受け取ったデータが記録の SHA-256 と一致しないため、表示も保存もしません。',
  'text.remoteAbsent': 'Awai FS にこの全文がまだありません。', 'text.unavailable': '全文を取得できませんでした。通信状況を確認してください。', 'text.format': '全文の形式を読めませんでした。',
  'text.details': '全文の所在', 'text.hash': 'SHA-256: {hash}', 'text.bytes': '{bytes} バイト',
  'rel.incoming': 'この法令を改正した法令（{count}件）', 'rel.outgoing': 'この法令が改正した法令（{count}件）', 'rel.empty': 'ありません。',
  'rel.dateUnknown': '日付不明', 'rel.outside': '収録外', 'rel.unknownAmender': '改正法令の記録なし', 'rel.repeat': '既出',
  'trace.button': '改正の系譜をさかのぼる', 'trace.done': '{count}件の改正関係をたどりました。', 'trace.doneOne': '{count}件の改正関係をたどりました。', 'trace.truncated': '表示上限に達したため、途中で打ち切っています。',
  'catalog.heading': '法域の一覧', 'catalog.note': '{count}の法域の議会・裁判所・一次ソースの台帳です。法令の一覧があるのは日本だけです。',
  'catalog.filter': '法域名・コードで絞り込む', 'catalog.legislatures': '議会', 'catalog.courts': '裁判所', 'catalog.sources': '一次ソース', 'catalog.dataset': 'データセット: {name}',
  'footer': '出典: e-Gov 法令データ。法的助言ではありません。正本は官報・e-Gov で確認してください。',
  'kind.law.kind/constitution': '憲法', 'kind.law.kind/statute': '法律', 'kind.law.kind/cabinet-order': '政令', 'kind.law.kind/imperial-order': '勅令',
  'kind.law.kind/ministerial-ordinance': '府省令', 'kind.law.kind/rule': '規則',
  'status.law.status/in-force': '現行', 'status.law.status/repealed': '廃止', 'status.law.status/expired': '失効',
  'status.law.status/superseded-revision': '旧版', 'status.law.status/lapsed': '効力喪失'};
const en = {
  'app.title': 'Horei', 'nav.label': 'Views', 'nav.search': 'Find laws', 'nav.catalog': 'Jurisdictions',
  'env.web': 'Web', 'env.tauri': 'Awai Shell / Tauri v3', 'env.line': '{runtime} · {count} laws · runs on this device',
  'host.failed': 'Could not check the host. You can keep browsing.',
  'search.label': 'Search by title, short title or law number', 'search.status': 'Status', 'search.all': 'All', 'search.current': 'In force only',
  'search.idle': 'Search {count} Japanese laws on this device.', 'search.none': 'No matching laws.',
  'search.count': '{total} results', 'search.countOne': '{total} result', 'search.countTop': '{total} results (showing the top {shown})',
  'law.back': 'Back to search', 'law.missing': 'Law not found',
  'field.number': 'Law number', 'field.abbrev': 'Short title', 'field.kind': 'Type', 'field.status': 'Status', 'field.category': 'Field',
  'field.promulgated': 'Promulgated', 'field.effective': 'In effect', 'field.repealed': 'Repealed', 'field.id': 'Law ID', 'field.source': 'Source',
  'text.heading': 'Full text', 'text.absent': 'The full text cannot be read on this device yet.', 'text.none': 'The source has no full text.',
  'text.fetch': 'Get the full text', 'text.webOnly': 'Kept only until you close this page (the Web version has no Awai FS).', 'text.fetchNote': 'It comes from Awai FS (yataverse.com). Only the text identifier (CID) is sent. You will be asked first.',
  'text.fetching': 'Getting the full text…', 'text.fetched': 'Got the full text, checked its SHA-256 and saved it in Awai FS on this device.', 'text.cached': 'Full text saved in Awai FS on this device (SHA-256 checked).',
  'text.denied': 'Not retrieved. No request was sent.', 'text.mismatch': 'The data received does not match the recorded SHA-256, so it is neither shown nor saved.',
  'text.remoteAbsent': 'Awai FS does not have this text yet.', 'text.unavailable': 'Could not get the full text. Check the connection.', 'text.format': 'Could not read the format of the full text.',
  'text.details': 'Where the full text is', 'text.hash': 'SHA-256: {hash}', 'text.bytes': '{bytes} bytes',
  'rel.incoming': 'Amended by ({count})', 'rel.outgoing': 'Amends ({count})', 'rel.empty': 'None.',
  'rel.dateUnknown': 'Date unknown', 'rel.outside': 'not in this collection', 'rel.unknownAmender': 'No record of the amending law', 'rel.repeat': 'shown above',
  'trace.button': 'Trace the amendment history', 'trace.done': 'Traced {count} amendments.', 'trace.doneOne': 'Traced {count} amendment.', 'trace.truncated': 'Stopped at the display limit.',
  'catalog.heading': 'Jurisdictions', 'catalog.note': 'Registers of legislatures, courts and primary sources for {count} jurisdictions. Only Japan has a list of laws.',
  'catalog.filter': 'Filter by name or code', 'catalog.legislatures': 'Legislatures', 'catalog.courts': 'Courts', 'catalog.sources': 'Primary sources', 'catalog.dataset': 'Dataset: {name}',
  'footer': 'Source: e-Gov law data. Not legal advice. Check the official gazette or e-Gov for the authoritative text.',
  'kind.law.kind/constitution': 'Constitution', 'kind.law.kind/statute': 'Act', 'kind.law.kind/cabinet-order': 'Cabinet Order', 'kind.law.kind/imperial-order': 'Imperial Ordinance',
  'kind.law.kind/ministerial-ordinance': 'Ministerial Ordinance', 'kind.law.kind/rule': 'Rule',
  'status.law.status/in-force': 'In force', 'status.law.status/repealed': 'Repealed', 'status.law.status/expired': 'Expired',
  'status.law.status/superseded-revision': 'Earlier version', 'status.law.status/lapsed': 'Lapsed'};
export const MESSAGES = {ja, en};
export function pickLocale(languages) {
  for (const l of languages ?? []) { const base = String(l).toLowerCase().split('-')[0]; if (base in MESSAGES) return base; }
  return 'ja';
}
export function translator(locale) {
  const table = MESSAGES[locale] ?? ja;
  return (key, params = {}) => {
    const text = table[key] ?? ja[key];
    if (text === undefined) throw Error('missing message ' + key);
    return text.replace(/\{(\w+)\}/g, (_, name) => { if (!(name in params)) throw Error(`missing ${name} for ${key}`); return String(params[name]); });
  };
}
