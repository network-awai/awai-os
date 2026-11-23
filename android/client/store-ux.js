// AWAI-4070: pure Store UX helpers for the catalog / browse / install / update flow.
//
// Conventions referenced:
// - Google Play: top search (name + developer + category), category chips,
//   an install/update/open action on each row, a detail page with version,
//   developer and size.
// - App Store: a quiet single featured item (no autoplay, no rotation), a
//   plain list below, and a per-app update action.
// - Quiet-by-design (Awai Setup 241:3 flow): no badge counts, no promo or
//   urgency copy, no rating stars (the catalog carries no rating data —
//   none is invented), no silent installs, tonal actions, text over color,
//   and nothing leaves the device until the user confirms on the review
//   screen. These helpers stay DOM-free so node tests can pin the copy and
//   the filtering without a browser.

export const FEATURED = 'おすすめ';

export function searchText(app, presentation) {
  return [app.name, app.description, app.publisher, app.id,
    presentation?.category, presentation?.tagline]
    .filter((x) => typeof x === 'string' && x.length)
    .join(' ')
    .toLocaleLowerCase();
}

export function visibleApps(apps, { query = '', category = FEATURED } = {}, { presentationOf, isUnavailable }) {
  const q = String(query).toLocaleLowerCase();
  return apps.filter((app) => !isUnavailable(app)
    && (category === FEATURED || presentationOf(app).category === category)
    && searchText(app, presentationOf(app)).includes(q));
}

export function categories(apps, presentationOf, isUnavailable) {
  const ordered = [FEATURED];
  for (const app of apps) {
    if (isUnavailable(app)) continue;
    const category = presentationOf(app).category;
    if (typeof category === 'string' && category && !ordered.includes(category)) ordered.push(category);
  }
  return ordered;
}

// Featured is the first filtered app; the list below excludes it so the
// App Store / Play "first item is featured, then a plain list" shape does
// not duplicate an entry.
export function featuredAndRest(apps) {
  return apps.length ? { featured: apps[0], rest: apps.slice(1) } : { featured: null, rest: [] };
}

export function deliveryLabel({ viaOnline, installed }) {
  if (installed) return '追加済み';
  return viaOnline ? 'オンライン配信' : '同梱アプリ';
}

export function rowMeta(app, state, viaOnline) {
  return `v${app.versionName} · ${deliveryLabel({ viaOnline, installed: state === 'installed' })}`;
}

export function actionLabel(state) {
  switch (state) {
    case 'installed': return '開く';
    case 'update': return '更新';
    case 'available': return '取得';
    case 'unavailable': return null;
    default: return '取得';
  }
}

export function detailActionLabel(state, appName) {
  switch (state) {
    case 'installed': return `${appName} を開く`;
    case 'update': return '更新内容を確認';
    case 'unavailable': return null;
    default: return '追加内容を確認';
  }
}

export function reviewTitle(app, state) {
  return state === 'update' ? `${app.name} を更新しますか？` : `${app.name} を追加しますか？`;
}

export function reviewConfirmLabel(state) {
  return state === 'update' ? '今回の更新を確認' : '今回の追加を確認';
}

export function reviewCancelLabel(state) {
  return state === 'update' ? '今は更新しない' : '今は追加しない';
}

export function reviewPageTitle(app, state) {
  if (!app) return '確認する前に';
  return state === 'update' ? '更新する前に' : '追加する前に';
}

export function versionTransition(app, installedVersion) {
  return installedVersion == null
    ? `${app.name} v${app.versionName}`
    : `v${installedVersion} → v${app.versionName}`;
}

export function artifactBytes(app, platform, runtime) {
  const artifact = (app.artifacts || []).find(
    (a) => a.platform === platform && a.runtime === runtime);
  return artifact?.bytes ?? null;
}

export function formatSize(bytes) {
  if (bytes == null) return null;
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function catalogStatus(revision, expiresAt) {
  const date = new Date(expiresAt * 1000).toISOString().slice(0, 10);
  return `署名済みカタログ revision ${revision}（${date} まで有効）。リンクを押すまで外部と通信しません。`;
}

export function pendingUpdateLine(count) {
  return count ? `更新があります（${count} 件）。更新は、内容を確かめてから。`
    : '現在、追加済みアプリの更新はありません。';
}
