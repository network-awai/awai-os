// UI messages by stable key.
const ja = {
  'app.title': 'Isekai Fork', 'nav.label': '表示の切り替え', 'nav.draft': 'fork を下書き', 'nav.drafts': '下書き', 'nav.operations': '外部操作',
  'env.web': 'Web', 'env.tauri': 'Awai Shell / Tauri v3', 'env.line': '{runtime} · 端末内に保存 · 公開はしません',
  'host.failed': 'ホストを確認できませんでした。', 'state.failed': '保存した下書きを読めませんでした。',
  'draft.heading': 'ゲームの fork を下書き', 'draft.note': 'Isekai のゲームを fork するときの記録（commit）を、端末内で下書きします。公開・署名・支払い・gem の発行はしません。',
  'field.game': 'ゲーム（英小文字・数字・ハイフン）', 'field.parent': '元の fork の CID（任意。空ならゲームの最初の版）', 'field.author': '作者の did:key', 'field.message': '変更の説明',
  'draft.preview': '記録のプレビュー', 'draft.save': '下書きを保存', 'draft.saved': '下書きを保存しました。', 'draft.invalid': '入力を確認してください。',
  'problem.game.format': 'ゲーム名は英小文字か数字で始め、英小文字・数字・ハイフンで 63 文字以内にしてください。',
  'problem.parent.format': 'CID は b で始まる base32（英小文字と 2〜7）の CIDv1 にしてください。',
  'problem.author.format': '作者は did:key:z で始まる did:key にしてください。',
  'problem.message.empty': '変更の説明を入力してください。', 'problem.message.long': '説明は 200 文字以内にしてください。',
  'drafts.heading': '保存した下書き', 'drafts.empty': '下書きはまだありません。', 'drafts.count': '{count}件',
  'drafts.root': 'ゲームの最初の版', 'drafts.parent': '元: {parent}', 'drafts.unpublished': '未公開',
  'drafts.copy': 'JSON をコピー', 'drafts.copied': 'コピーしました。', 'drafts.copyFailed': 'コピーできませんでした。', 'drafts.delete': '削除', 'drafts.deleted': '下書きを削除しました。',
  'save.failed': '保存できませんでした（{code}）。',
  'ops.heading': '外部操作（すべて無効）', 'ops.note': 'この版の実行設定には外部操作が一つもありません。下の操作は後の版で、操作ごとに同意を取ってから行います。', 'ops.disabled': '無効',
  'op.kotobase.publish': 'fork を kotoba-git の台帳に公開する', 'op.x402.pay': 'x402 で fork の利用料を支払う', 'op.gem.mint': 'fork に gem を発行する',
  'footer': '下書きはこの端末だけに保存され、公開されません。'};
const en = {
  'app.title': 'Isekai Fork', 'nav.label': 'Views', 'nav.draft': 'Draft a fork', 'nav.drafts': 'Drafts', 'nav.operations': 'External operations',
  'env.web': 'Web', 'env.tauri': 'Awai Shell / Tauri v3', 'env.line': '{runtime} · saved on this device · never published',
  'host.failed': 'Could not check the host.', 'state.failed': 'Could not read the saved drafts.',
  'draft.heading': 'Draft a game fork', 'draft.note': 'Draft, on this device, the commit an Isekai game fork records. Nothing is published, signed, paid or minted.',
  'field.game': 'Game (lowercase letters, digits, hyphens)', 'field.parent': 'Parent fork CID (optional; empty for the first version of a game)', 'field.author': "Author's did:key", 'field.message': 'What changed',
  'draft.preview': 'Commit preview', 'draft.save': 'Save draft', 'draft.saved': 'Draft saved.', 'draft.invalid': 'Check the fields.',
  'problem.game.format': 'Start the game name with a lowercase letter or digit, and use only lowercase letters, digits and hyphens (up to 63).',
  'problem.parent.format': 'Use a CIDv1 in base32: b followed by lowercase letters and the digits 2–7.',
  'problem.author.format': 'Use a did:key that starts with did:key:z.',
  'problem.message.empty': 'Describe the change.', 'problem.message.long': 'Keep the description to 200 characters.',
  'drafts.heading': 'Saved drafts', 'drafts.empty': 'No drafts yet.', 'drafts.count': '{count}',
  'drafts.root': 'First version of the game', 'drafts.parent': 'Parent: {parent}', 'drafts.unpublished': 'Not published',
  'drafts.copy': 'Copy JSON', 'drafts.copied': 'Copied.', 'drafts.copyFailed': 'Could not copy.', 'drafts.delete': 'Delete', 'drafts.deleted': 'Draft deleted.',
  'save.failed': 'Could not save ({code}).',
  'ops.heading': 'External operations (all disabled)', 'ops.note': 'This version declares no external operations at runtime. A later version will run each of these only after asking you for that operation.', 'ops.disabled': 'Disabled',
  'op.kotobase.publish': 'Publish the fork to the kotoba-git ledger', 'op.x402.pay': 'Pay the fork fee with x402', 'op.gem.mint': 'Mint a gem for the fork',
  'footer': 'Drafts stay on this device and are not published.'};
export const MESSAGES = Object.freeze({ja, en});
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
