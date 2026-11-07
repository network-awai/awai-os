// Shell text in English and Japanese. The setup screens keep their own table in setup.jsx and
// share the saved language with this one. Keys missing from a language are a test failure
// (test/i18n.test.js), so a screen cannot fall back to English without anyone noticing.
import { createContext, useContext } from "react";

export const LANGUAGE_KEY = "otehon.language.v1";
export const LANGUAGES = [
  ["en", "English"],
  ["ja", "日本語"],
];

export function savedLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return saved === "ja" || saved === "en" ? saved : "en";
  } catch {
    return "en";
  }
}

export function saveLanguage(language) {
  document.documentElement.lang = language;
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // The choice still applies to this session.
  }
}

export const TEXT = {
  en: {
    "sidebar.label": "Contexts",
    "sidebar.newChat": "New chat",
    "section.Core": "Core",
    "section.Apps": "Apps",
    "section.System": "System",
    "sidebar.services": "Services",
    "sidebar.messages": "{count} messages",
    "account.open": "Account {id}, trust score {score}",
    "account.trust": "Trust {score}",
    "service.running": "Running",
    "service.down": "Not reachable",
    "lock.now": "Lock",
    "composer.speak": "Speak",
    "composer.image": "Image",
    "composer.send": "Send",
    "composer.imageMissing": "The image model is not available on this device",
    "composer.message": "Message {name}",
    "composer.messageHome": "Message Itonami",
    "chat.homeTitle": "What should we work on?",
    "chat.homeBody": "Pick an app in the sidebar to work in its context.",
    "chat.notice": "No agent is connected in this image, so nothing answers yet. Messages stay on this device.",
    "chat.messages": "Messages",
    "media.imageWorking": "Generating on this device. This can take a long time.",
    "media.working": "Generating…",
    "media.failed": "Could not generate this: {reason}",
    "media.seconds": "Generated on this device in {seconds} s",
    "locked.body": "This app needs a trust score of {minimum}. Yours is {score}.",
    "locked.raise": "Raise Your Score",
    "panel.label": "About {name}",
    "panel.notConnected": "Not connected",
    "panel.install": "Install",
    "panel.osImage": "Included in the OS image",
    "panel.offline": "Offline",
    "panel.localCore": "The local core works offline",
    "panel.operations": "Network operations",
    "panel.none": "None. This app does not use the network.",
    "panel.asks": "Asks each time",
    "panel.needs": "Needs trust {minimum}. Yours is {score}.",
    "account.title": "Account",
    "account.wallet": "a Web3 wallet",
    "account.passkey": "a passkey",
    "account.signedIn": "Signed in with {method} until {date}.",
    "account.score": "Trust score",
    "account.scoreNote": "A condition for some apps and operations. It does not mean goodwill, truth or a verified identity.",
    "account.sources": "Ways to raise the score",
    "account.signedInSource": "Signed in",
    "account.passportScore": " (score {score})",
    "account.check": "Check for +{points}",
    "account.needsWallet": "Needs a wallet account",
    "account.worldId": "Not available yet (+{points})",
    "account.passportResult": "Human Passport score on Optimism: {score}.",
    "account.nothingSent": "Nothing was sent.",
    "account.chainFailed": "The chain could not be read. Try again later.",
    "account.signOut": "Sign Out of This Device",
    "lockScreen.title": "Locked",
    "lockScreen.useWallet": "Unlock with Your Wallet",
    "lockScreen.sign": "Sign this message with the wallet of this account (personal_sign):",
    "lockScreen.signature": "Signature",
    "lockScreen.unlock": "Unlock",
    "lockScreen.passkey":
      "This account signed in with a passkey. A passkey cannot unlock this device yet, so the only way on is to erase this device's data and sign in again.",
    "lockScreen.refused": "Not unlocked: {reason}",
    "lockScreen.eraseConfirm": "Erase Messages and Sign-In on This Device",
    "lockScreen.erase": "Erase This Device's Data Instead",
    "manimani.stopped": "The Manimani service is not running.",
    "manimani.paused": "Paused. Scheduled work and tools are stopped.",
    "manimani.ready": "Running on this device.",
    "manimani.modelUnavailable": "The local model is not available. Nothing is sent elsewhere.",
    "manimani.intro": "Manimani keeps running on this device, and coordinates your other agents.",
    "manimani.message": "Message Manimani",
    "manimani.send": "Send",
    "manimani.side": "What Manimani is doing",
    "manimani.status": "Status",
    "manimani.resume": "Resume",
    "manimani.pause": "Pause",
    "manimani.approvals": "Needs your approval",
    "manimani.approve": "Approve",
    "manimani.decline": "Decline",
    "manimani.agents": "Agents",
    "manimani.auto": "runs on its own",
    "manimani.asks": "asks you first",
    "manimani.noAgents": "None connected yet.",
    "manimani.scheduled": "Scheduled",
    "manimani.every": "{title}, every {minutes} min",
    "manimani.remove": "Remove",
    "manimani.nothingScheduled": "Nothing scheduled.",
    "manimani.remembered": "Remembered",
    "manimani.forget": "Forget all",
    "manimani.nothingYet": "Nothing yet.",
    "manimani.activity": "Activity",
    "settei.title": "Settings",
    "settei.language": "Language",
    "settei.languageNote": "Applies to this shell at once.",
    "settei.timeZone": "Time zone",
    "settei.timeZoneCurrent": "This device uses {zone}. The time here is {time}.",
    "settei.timeZoneChoose": "Time zone",
    "settei.apply": "Apply",
    "settei.applying": "Changing…",
    "settei.applied": "The time zone is now {zone}. It stays after a restart.",
    "settei.unavailable": "The settings service is not running, so the time zone cannot be changed here.",
    "settei.refused": "Not changed: {reason}",
    "settei.helperNote":
      "A small system service makes this change. It accepts only a time zone from the system list, only from this desktop's user, and records each change in the system log.",
    "settei.network": "Wi-Fi",
    "settei.networkNote": "Wi-Fi settings are not available in this image. It has no network adapter to test them with.",
    "settei.other": "Display, sound and Bluetooth",
    "settei.otherNote": "Not available in this image yet.",
    "browser.title": "Web",
    "browser.body":
      "Opens an ordinary web browser in its own window, with an address bar. It uses a separate profile: it cannot see this shell's messages, sign-in or wallet, and the shell cannot see its pages.",
    "browser.open": "Open the Web Browser",
    "browser.opening": "Opening…",
    "browser.opened": "The browser window is open. Close it to come back here.",
    "browser.unavailable": "The browser launcher is not running.",
    "browser.refused": "Not opened: {reason}",
    "browser.network": "This image has no network adapter, so web pages will not load in a VM started with the check scripts.",
    "browser.kotoba": "Kotoba Browser, which renders documents inside the shell, is not part of this image yet.",
  },
  ja: {
    "sidebar.label": "コンテキスト",
    "sidebar.newChat": "新しいチャット",
    "section.Core": "コア",
    "section.Apps": "アプリ",
    "section.System": "システム",
    "sidebar.services": "サービス",
    "sidebar.messages": "メッセージ {count} 件",
    "account.open": "アカウント {id}、信頼スコア {score}",
    "account.trust": "信頼 {score}",
    "service.running": "動作中",
    "service.down": "接続できません",
    "lock.now": "ロック",
    "composer.speak": "読み上げ",
    "composer.image": "画像",
    "composer.send": "送信",
    "composer.imageMissing": "この端末では画像モデルを使えません",
    "composer.message": "{name} にメッセージ",
    "composer.messageHome": "Itonami にメッセージ",
    "chat.homeTitle": "何をしましょうか?",
    "chat.homeBody": "サイドバーでアプリを選ぶと、そのアプリの文脈で作業できます。",
    "chat.notice": "このイメージにはエージェントが接続されていないため、まだ返答はありません。メッセージはこの端末に保存されます。",
    "chat.messages": "メッセージ",
    "media.imageWorking": "この端末で生成しています。時間がかかることがあります。",
    "media.working": "生成しています…",
    "media.failed": "生成できませんでした: {reason}",
    "media.seconds": "この端末で {seconds} 秒かけて生成しました",
    "locked.body": "このアプリには信頼スコア {minimum} が必要です。現在のスコアは {score} です。",
    "locked.raise": "スコアを上げる",
    "panel.label": "{name} について",
    "panel.notConnected": "未接続",
    "panel.install": "インストール",
    "panel.osImage": "OS イメージに含まれています",
    "panel.offline": "オフライン",
    "panel.localCore": "ローカルの中核部分はオフラインで動きます",
    "panel.operations": "ネットワーク操作",
    "panel.none": "ありません。このアプリはネットワークを使いません。",
    "panel.asks": "毎回確認します",
    "panel.needs": "信頼スコア {minimum} が必要です。現在は {score} です。",
    "account.title": "アカウント",
    "account.wallet": "Web3 ウォレット",
    "account.passkey": "パスキー",
    "account.signedIn": "{method}でサインインしています。期限は {date} です。",
    "account.score": "信頼スコア",
    "account.scoreNote": "一部のアプリと操作の条件です。善意、真実、本人確認を意味するものではありません。",
    "account.sources": "スコアを上げる方法",
    "account.signedInSource": "サインイン済み",
    "account.passportScore": "(スコア {score})",
    "account.check": "確認して +{points}",
    "account.needsWallet": "ウォレットのアカウントが必要です",
    "account.worldId": "まだ使えません (+{points})",
    "account.passportResult": "Optimism 上の Human Passport スコア: {score}",
    "account.nothingSent": "何も送信していません。",
    "account.chainFailed": "チェーンを読み取れませんでした。あとでもう一度お試しください。",
    "account.signOut": "この端末からサインアウト",
    "lockScreen.title": "ロック中",
    "lockScreen.useWallet": "ウォレットでロック解除",
    "lockScreen.sign": "このアカウントのウォレットで、このメッセージに署名してください (personal_sign):",
    "lockScreen.signature": "署名",
    "lockScreen.unlock": "ロック解除",
    "lockScreen.passkey":
      "このアカウントはパスキーでサインインしました。パスキーではまだこの端末のロックを解除できないため、先に進むにはこの端末のデータを消去して、もう一度サインインしてください。",
    "lockScreen.refused": "解除できませんでした: {reason}",
    "lockScreen.eraseConfirm": "この端末のメッセージとサインインを消去",
    "lockScreen.erase": "代わりにこの端末のデータを消去",
    "manimani.stopped": "Manimani のサービスは動いていません。",
    "manimani.paused": "一時停止中です。予定した作業とツールは止まっています。",
    "manimani.ready": "この端末で動作中です。",
    "manimani.modelUnavailable": "ローカルのモデルを使えません。ほかの場所へは何も送りません。",
    "manimani.intro": "Manimani はこの端末で動き続け、ほかのエージェントをまとめます。",
    "manimani.message": "Manimani にメッセージ",
    "manimani.send": "送信",
    "manimani.side": "Manimani の動作状況",
    "manimani.status": "状態",
    "manimani.resume": "再開",
    "manimani.pause": "一時停止",
    "manimani.approvals": "承認が必要です",
    "manimani.approve": "承認",
    "manimani.decline": "拒否",
    "manimani.agents": "エージェント",
    "manimani.auto": "自動で実行",
    "manimani.asks": "先に確認",
    "manimani.noAgents": "まだ接続されていません。",
    "manimani.scheduled": "予定",
    "manimani.every": "{title}、{minutes} 分ごと",
    "manimani.remove": "削除",
    "manimani.nothingScheduled": "予定はありません。",
    "manimani.remembered": "記憶",
    "manimani.forget": "すべて忘れる",
    "manimani.nothingYet": "まだありません。",
    "manimani.activity": "動作履歴",
    "settei.title": "設定",
    "settei.language": "言語",
    "settei.languageNote": "このシェルにすぐ反映されます。",
    "settei.timeZone": "タイムゾーン",
    "settei.timeZoneCurrent": "この端末は {zone} を使っています。現在の時刻は {time} です。",
    "settei.timeZoneChoose": "タイムゾーン",
    "settei.apply": "適用",
    "settei.applying": "変更しています…",
    "settei.applied": "タイムゾーンを {zone} にしました。再起動後もこの設定のままです。",
    "settei.unavailable": "設定サービスが動いていないため、ここではタイムゾーンを変更できません。",
    "settei.refused": "変更していません: {reason}",
    "settei.helperNote":
      "この変更は小さなシステムサービスが行います。受け付けるのはシステムの一覧にあるタイムゾーンだけで、このデスクトップのユーザーからの要求だけです。変更はすべてシステムログに記録されます。",
    "settei.network": "Wi-Fi",
    "settei.networkNote": "このイメージでは Wi-Fi を設定できません。確認に使えるネットワークアダプターがありません。",
    "settei.other": "画面、音、Bluetooth",
    "settei.otherNote": "このイメージではまだ使えません。",
    "browser.title": "Web",
    "browser.body":
      "アドレスバーのある通常の Web ブラウザーを別のウィンドウで開きます。別のプロファイルを使うため、このシェルのメッセージ、サインイン、ウォレットは見えません。シェルからもそのページは見えません。",
    "browser.open": "Web ブラウザーを開く",
    "browser.opening": "開いています…",
    "browser.opened": "ブラウザーのウィンドウを開きました。閉じるとここに戻ります。",
    "browser.unavailable": "ブラウザーの起動サービスが動いていません。",
    "browser.refused": "開けませんでした: {reason}",
    "browser.network": "このイメージにはネットワークアダプターがないため、チェック用スクリプトで起動した VM では Web ページを読み込めません。",
    "browser.kotoba": "シェルの中で文書を表示する Kotoba Browser は、まだこのイメージに含まれていません。",
  },
};

// Japanese text for the dapp catalog. The catalog is a snapshot from kotoba-lang/kotoba and is
// English only. Titles are product names and stay as they are.
export const DAPP_TEXT_JA = {
  summary: {
    murakumo: "Itonami のローカルモデル利用の同意のあと、上限つきの小さな bigram モデルでローカル推論します",
    itonami: "Goal、そのローカルモデル要求、端末の鍵",
    yataverse: "コンテンツアドレス型ストア: 64 バイトの Goal レコードを raw CIDv1 で名付け、cid-v1-admit で再び受け入れます",
    aozora: "送信箱: 64 バイトの Goal レコードを端末の鍵で投稿として署名し、検証します",
    browser: "Kotoba Browser: 共通のブラウザー表示面でローカルの文書を表示します",
    yotei: "カレンダー: 端末上で署名したレコードとしてのローカルの予定",
    shakai: "ソーシャル: ローカルの Aozora 送信箱のタイムラインを読み、投稿を作ります",
    saifu: "ウォレット (読み取りと検証のみ): 端末の鍵を表示し、署名を検証します",
    bunsho: "文書作成: ローカルで文書を編集します",
    hyokeisan: "表計算: ローカルで表を編集し、計算します",
    zuhyo: "プレゼンテーションと図表: ローカルのスライド",
    tokei: "時計: 較正した TSC 時計 (PIT で較正し、生の TSC を ms と表示しない) と稼働時間を表示します",
    wifi: "ネットワークの状態と接続: リンクの状態を一覧表示します",
    bluetooth: "Bluetooth の状態と HID 機器 (HOGP) のペアリング",
    settei: "設定: 画面、音、効果、鍵の管理、アプリごとの同意の確認",
    "itonami-apps": "アプリストア: 署名済みのアプリカタログを表示し、そこからアプリをインストールします",
    updates: "更新管理: インストール済みの版、チャネル、ポリシーを表示し、署名済みイメージの段階的更新 (AWAI-122) とロールバック用のコピーを実行します",
    torihiki: "取引クライアント (devnet とデモ用アカウントのみ): セッション鍵、注文フォーム、気配値",
  },
  service: {
    "user-chosen inference rail": "利用者が選んだ推論の経路",
    "yataverse peer": "yataverse のピア",
    "the user's AT Protocol PDS": "利用者の AT Protocol PDS",
    "the origin the user typed": "利用者が入力したオリジン",
    "user-chosen calendar store": "利用者が選んだカレンダーの保存先",
    "user-chosen chain read endpoint": "利用者が選んだチェーン読み取りエンドポイント",
    "user-selected store": "利用者が選んだ保存先",
    "user-chosen time source": "利用者が選んだ時刻源",
    "user-chosen app catalog origin": "利用者が選んだアプリカタログのオリジン",
    "user-chosen artifact origin": "利用者が選んだ配布物のオリジン",
    "user-chosen update origin": "利用者が選んだ更新のオリジン",
    "user-chosen torihiki devnet endpoint": "利用者が選んだ torihiki devnet のエンドポイント",
  },
};

export function translate(language, key, vars = {}) {
  const template = TEXT[language]?.[key] ?? TEXT.en[key];
  if (template === undefined) throw new Error(`missing text ${key}`);
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

export function dappSummary(language, dapp) {
  return language === "ja" ? DAPP_TEXT_JA.summary[dapp.id] ?? dapp.summary : dapp.summary;
}

export function serviceName(language, service) {
  return language === "ja" ? DAPP_TEXT_JA.service[service] ?? service : service;
}

export const LanguageContext = createContext({ language: "en", setLanguage: () => {} });

export function useText() {
  const { language } = useContext(LanguageContext);
  return (key, vars) => translate(language, key, vars);
}

export function useLanguage() {
  return useContext(LanguageContext);
}
