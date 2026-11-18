// UI messages by stable key (ja, en). Text the user types is never translated or rewritten.
const ja = {
  'app.title': '法律相談', 'nav.label': '表示の切り替え', 'nav.input': '相談を書く', 'nav.memo': '資料と送付先',
  'env.web': 'Web', 'env.tauri': 'Awai Shell / Tauri v3', 'env.line': '{runtime} · 端末内で動作',
  'host.failed': 'ホストを確認できませんでした。入力は続けられますが、保存できない場合があります。',
  'intro': '相談したい内容を書くと、弁護士に渡すための資料（相談メモ）にまとめます。まとめるのはあなたが書いた言葉だけで、法的な判断や助言はしません。入力はこの端末にだけ保存します。',
  'field.jurisdiction': '相談する国・地域', 'field.choose': '選んでください', 'jurisdiction.JPN': '日本',
  'jurisdiction.note': '今は日本向けのひな形だけがあります。',
  'field.category': '相談の分野', 'field.summary': '相談の概要', 'field.summaryHint': '何が起きていて、何に困っているか',
  'field.timeline': 'これまでの経緯', 'field.date': '日付（分かれば）', 'field.event': '出来事', 'timeline.add': '経緯を追加', 'timeline.remove': 'この経緯を削除',
  'field.otherParty': '相手方（任意）', 'field.wish': '希望すること', 'field.deadline': '期限や日付で気になること（任意）',
  'field.documents': '手元にある資料', 'documents.add': '資料を追加', 'documents.remove': 'この資料を削除', 'field.document': '資料の名前',
  'field.name': 'あなたの名前', 'field.contact': 'あなたの連絡先（メールまたは電話）',
  'category.money': '金銭の貸し借り', 'category.contract': '契約', 'category.work': '労働', 'category.family': '家族・相続',
  'category.housing': '住まい・不動産', 'category.traffic': '交通事故', 'category.other': 'その他',
  'save': '保存', 'saved': 'この端末に保存しました。', 'saveFailed': '保存できませんでした: {code}', 'conflict': '別の画面で更新されたため、最新の内容を読み込み直しました。',
  'assemble': '資料にまとめる', 'problems': '次の項目を確認してください。',
  'draft.invalid': '入力を読み込めませんでした。', 'jurisdiction.required': '相談する国・地域を選んでください。', 'category.required': '相談の分野を選んでください。',
  'summary.required': '相談の概要を書いてください。', 'summary.tooLong': '相談の概要が長すぎます（{max}文字まで）。',
  'timeline.tooMany': '経緯が多すぎます。', 'timeline.date': '経緯の日付は YYYY-MM-DD で書くか、空にしてください。', 'timeline.event': '経緯の出来事を書いてください（{max}文字まで）。',
  'otherParty.tooLong': '相手方が長すぎます。', 'wish.required': '希望することを書いてください。', 'wish.tooLong': '希望することが長すぎます。',
  'deadline.tooLong': '期限の欄が長すぎます。', 'documents.tooMany': '資料が多すぎます。', 'documents.item': '空の資料名があるか、資料名が長すぎます。',
  'name.required': 'あなたの名前を書いてください。', 'contact.required': 'あなたの連絡先を書いてください。',
  'memo.heading': '相談メモ', 'memo.title': '相談メモ（{category}）', 'memo.category': '分野', 'memo.summary': '相談の概要', 'memo.timeline': 'これまでの経緯',
  'memo.otherParty': '相手方', 'memo.wish': '希望すること', 'memo.deadline': '期限や日付で気になること', 'memo.documents': '手元にある資料', 'memo.from': '相談者',
  'memo.notice': 'この資料は、相談者が入力した内容をひな形にまとめたものです。法的な判断・助言は含みません。',
  'memo.incomplete': 'まだ資料にまとめられません。「相談を書く」で入力を確認してください。',
  'memo.check': '送る前に、この内容で間違いがないか確認してください。',
  'recipient.heading': '送付先の弁護士', 'recipient.note': '送付先は、あなたが自分で選んだ弁護士を書いてください。このアプリは弁護士を紹介・推薦しません。',
  'recipient.name': '弁護士の名前', 'recipient.office': '事務所名（任意）', 'recipient.contact': '弁護士の連絡先',
  'recipient.invalid': '送付先を読み込めませんでした。', 'recipient.nameProblem': '弁護士の名前を書いてください。', 'recipient.officeProblem': '事務所名が長すぎます。', 'recipient.contactProblem': '弁護士の連絡先を書いてください。',
  'confirm.label': 'この資料の内容と送付先を確認しました',
  'send': '送付する', 'send.undeclared': '送付の経路はまだ用意されていません。このアプリは今、外部へ何も送りません。',
  'send.blocked': '送付できませんでした。外部への送信はしていません。',
  'footer': '法的助言ではありません。紹介料は誰からも受け取りません。'};
const en = {
  'app.title': 'Legal consultation', 'nav.label': 'Views', 'nav.input': 'Write it down', 'nav.memo': 'Memo and recipient',
  'env.web': 'Web', 'env.tauri': 'Awai Shell / Tauri v3', 'env.line': '{runtime} · runs on this device',
  'host.failed': 'Could not check the host. You can keep writing, but saving may fail.',
  'intro': 'Write down what you want to consult about and this app arranges it into a memo for a lawyer. It uses only your own words and gives no legal judgment or advice. What you type is saved on this device only.',
  'field.jurisdiction': 'Country or region', 'field.choose': 'Choose', 'jurisdiction.JPN': 'Japan',
  'jurisdiction.note': 'Only a template for Japan exists so far.',
  'field.category': 'Area', 'field.summary': 'Summary', 'field.summaryHint': 'What happened and what troubles you',
  'field.timeline': 'What happened so far', 'field.date': 'Date (if known)', 'field.event': 'Event', 'timeline.add': 'Add an event', 'timeline.remove': 'Remove this event',
  'field.otherParty': 'Other party (optional)', 'field.wish': 'What you want', 'field.deadline': 'Deadlines or dates that worry you (optional)',
  'field.documents': 'Documents you have', 'documents.add': 'Add a document', 'documents.remove': 'Remove this document', 'field.document': 'Document name',
  'field.name': 'Your name', 'field.contact': 'Your contact (email or phone)',
  'category.money': 'Money lent or owed', 'category.contract': 'Contract', 'category.work': 'Work', 'category.family': 'Family and inheritance',
  'category.housing': 'Housing and property', 'category.traffic': 'Traffic accident', 'category.other': 'Other',
  'save': 'Save', 'saved': 'Saved on this device.', 'saveFailed': 'Could not save: {code}', 'conflict': 'Another window changed it; the latest version was loaded.',
  'assemble': 'Make the memo', 'problems': 'Please check the following.',
  'draft.invalid': 'Could not read the input.', 'jurisdiction.required': 'Choose a country or region.', 'category.required': 'Choose an area.',
  'summary.required': 'Write a summary.', 'summary.tooLong': 'The summary is too long ({max} characters at most).',
  'timeline.tooMany': 'Too many events.', 'timeline.date': 'Write event dates as YYYY-MM-DD, or leave them empty.', 'timeline.event': 'Describe each event ({max} characters at most).',
  'otherParty.tooLong': 'The other party is too long.', 'wish.required': 'Write what you want.', 'wish.tooLong': 'What you want is too long.',
  'deadline.tooLong': 'The deadline field is too long.', 'documents.tooMany': 'Too many documents.', 'documents.item': 'A document name is empty or too long.',
  'name.required': 'Write your name.', 'contact.required': 'Write your contact.',
  'memo.heading': 'Consultation memo', 'memo.title': 'Consultation memo ({category})', 'memo.category': 'Area', 'memo.summary': 'Summary', 'memo.timeline': 'What happened so far',
  'memo.otherParty': 'Other party', 'memo.wish': 'What I want', 'memo.deadline': 'Deadlines or dates', 'memo.documents': 'Documents I have', 'memo.from': 'From',
  'memo.notice': 'This memo arranges what the person consulting typed into a template. It contains no legal judgment or advice.',
  'memo.incomplete': 'The memo cannot be made yet. Check your input under "Write it down".',
  'memo.check': 'Before sending, check that this is correct.',
  'recipient.heading': 'Lawyer to send to', 'recipient.note': 'Enter a lawyer you chose yourself. This app does not introduce or recommend lawyers.',
  'recipient.name': 'Lawyer\'s name', 'recipient.office': 'Office (optional)', 'recipient.contact': 'Lawyer\'s contact',
  'recipient.invalid': 'Could not read the recipient.', 'recipient.nameProblem': 'Write the lawyer\'s name.', 'recipient.officeProblem': 'The office name is too long.', 'recipient.contactProblem': 'Write the lawyer\'s contact.',
  'confirm.label': 'I checked this memo and the recipient',
  'send': 'Send', 'send.undeclared': 'There is no way to send yet. This app sends nothing outside the device for now.',
  'send.blocked': 'Not sent. Nothing left the device.',
  'footer': 'Not legal advice. No referral fee is taken from anyone.'};
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
