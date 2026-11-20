// UI messages by stable key.
const ja = {
  'app.title': 'x402 Pay', 'nav.label': '表示の切り替え', 'nav.draft': '支払い要求を作る', 'nav.drafts': '下書き', 'nav.operations': '外部操作',
  'env.web': 'Web', 'env.tauri': 'Awai Shell / Tauri v3', 'env.line': '{runtime} · Base Sepolia（テスト用のお金） · 端末内に保存',
  'host.failed': 'ホストを確認できませんでした。', 'state.failed': '保存した下書きを読めませんでした。',
  'state.unreadable': '保存した下書きの形式を読めません。上書きしないよう、保存と削除を止めています。', 'state.readOnly': '保存した下書きを読めないため、保存と削除はできません。',
  'save.conflict': '別の画面で下書きが変わっていたので、読み直しました。もう一度操作してください。', 'drafts.full': '下書きは {max} 件までです。不要な下書きを削除してから保存してください。',
  'draft.heading': 'x402 支払い要求の下書き', 'draft.note': '売り手が HTTP 402 で返す支払い条件を、端末内で下書きします。送信・署名・決済はしません。',
  'field.amount': '金額（USD、USDC で支払い）', 'field.payTo': '受取アドレス（payTo）', 'field.resource': '対象リソース（/path または https://…）', 'field.description': '説明（任意）',
  'draft.preview': '402 応答のプレビュー', 'draft.save': '下書きを保存', 'draft.saved': '下書きを保存しました。', 'draft.invalid': '入力を確認してください。',
  'problem.amount.empty': '金額を入力してください。', 'problem.amount.format': '金額は 0.01 のように、小数 6 桁までの数で入力してください。',
  'problem.amount.zero': '金額は 0 より大きくしてください。', 'problem.amount.max': '下書きの上限は 1,000 USD です。',
  'problem.payTo.format': '受取アドレスは 0x で始まる 40 桁の 16 進数です。', 'problem.payTo.zero': 'ゼロアドレスは使えません。',
  'problem.resource.empty': '対象リソースを入力してください。', 'problem.resource.format': '対象リソースは / で始まるパスか https の URL にしてください。',
  'problem.description.long': '説明は 200 文字以内にしてください。',
  'drafts.heading': '保存した下書き', 'drafts.empty': '下書きはまだありません。', 'drafts.count': '{count}件',
  'drafts.copy': 'JSON をコピー', 'drafts.copied': 'コピーしました。', 'drafts.copyFailed': 'コピーできませんでした。', 'drafts.delete': '削除', 'drafts.deleteConfirm': 'もう一度押すと削除', 'drafts.deleteArmed': '下書きは元に戻せません。削除するにはもう一度押してください。', 'drafts.deleted': '下書きを削除しました。',
  'drafts.amount': '{amount} USD', 'drafts.network': 'Base Sepolia', 'save.failed': '保存できませんでした（{code}）。',
  'ops.heading': '外部操作（すべて無効）', 'ops.note': 'この版の実行設定には外部操作が一つもありません。下の操作は後の版で、操作ごとに同意を取ってから行います。', 'ops.disabled': '無効',
  'op.seller.challenge': '売り手のリソースから 402 支払い要求を受け取る', 'op.wallet.sign': '自分のウォレットで支払いに署名する', 'op.facilitator.verify-settle': 'x402.nexus で支払いを検証・精算する',
  'footer': 'Base Sepolia はテスト用のネットワークです。本物のお金は動きません。金融や法律の助言ではありません。'};
const en = {
  'app.title': 'x402 Pay', 'nav.label': 'Views', 'nav.draft': 'New request', 'nav.drafts': 'Drafts', 'nav.operations': 'External operations',
  'env.web': 'Web', 'env.tauri': 'Awai Shell / Tauri v3', 'env.line': '{runtime} · Base Sepolia (test money) · saved on this device',
  'host.failed': 'Could not check the host.', 'state.failed': 'Could not read the saved drafts.',
  'state.unreadable': 'The saved drafts are in a format this app cannot read. Saving and deleting are off so they are not overwritten.', 'state.readOnly': 'The saved drafts cannot be read, so saving and deleting are off.',
  'save.conflict': 'The drafts changed in another window and were read again. Try once more.', 'drafts.full': 'You can keep up to {max} drafts. Delete one before saving.',
  'draft.heading': 'Draft an x402 payment request', 'draft.note': 'Draft, on this device, the payment terms a seller returns with HTTP 402. Nothing is sent, signed or settled.',
  'field.amount': 'Amount (USD, paid in USDC)', 'field.payTo': 'Receiving address (payTo)', 'field.resource': 'Resource (/path or https://…)', 'field.description': 'Description (optional)',
  'draft.preview': '402 response preview', 'draft.save': 'Save draft', 'draft.saved': 'Draft saved.', 'draft.invalid': 'Check the fields.',
  'problem.amount.empty': 'Enter an amount.', 'problem.amount.format': 'Enter a number such as 0.01, with up to 6 decimal places.',
  'problem.amount.zero': 'The amount must be more than 0.', 'problem.amount.max': 'A draft can be at most USD 1,000.',
  'problem.payTo.format': 'The address is 0x followed by 40 hexadecimal digits.', 'problem.payTo.zero': 'The zero address cannot be used.',
  'problem.resource.empty': 'Enter the resource.', 'problem.resource.format': 'Use a path starting with / or an https URL.',
  'problem.description.long': 'Keep the description to 200 characters.',
  'drafts.heading': 'Saved drafts', 'drafts.empty': 'No drafts yet.', 'drafts.count': '{count} saved',
  'drafts.copy': 'Copy JSON', 'drafts.copied': 'Copied.', 'drafts.copyFailed': 'Could not copy.', 'drafts.delete': 'Delete', 'drafts.deleteConfirm': 'Tap again to delete', 'drafts.deleteArmed': 'A deleted draft cannot be restored. Tap again to delete it.', 'drafts.deleted': 'Draft deleted.',
  'drafts.amount': 'USD {amount}', 'drafts.network': 'Base Sepolia', 'save.failed': 'Could not save ({code}).',
  'ops.heading': 'External operations (all disabled)', 'ops.note': 'This version declares no external operations at runtime. A later version will run each of these only after asking you for that operation.', 'ops.disabled': 'Disabled',
  'op.seller.challenge': 'Receive a 402 payment request from a seller resource', 'op.wallet.sign': 'Sign the payment in your own wallet', 'op.facilitator.verify-settle': 'Verify and settle the payment with x402.nexus',
  'footer': 'Base Sepolia is a test network; no real money moves. Not financial or legal advice.'};
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
