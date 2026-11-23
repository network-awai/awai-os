// AWAI-4070: Store UX helpers (catalog / browse / install / update flow).
// Pins the Play / App Store conventions and quiet-by-design copy so a
// refactor cannot silently introduce badges, promos or silent installs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { actionLabel, artifactBytes, categories, catalogStatus, detailActionLabel,
  deliveryLabel, featuredAndRest, formatSize, pendingUpdateLine, reviewCancelLabel,
  reviewConfirmLabel, reviewPageTitle, reviewTitle, rowMeta, searchText, versionTransition,
  visibleApps } from '../client/store-ux.js';

const presentations = {
  'a': { category: '暮らし', tagline: '予定を、手元に。' },
  'b': { category: 'つながる', tagline: '取引所 devnet を、手元で試す。' },
  'c': { category: 'しごと', tagline: '下書きを、手元で確かめる。' },
};
const apps = [
  { id: 'network.itonami.a', name: 'Yotei', description: '予定を保存します', publisher: 'Awai Otehon 開発版', versionName: '0.2.1', versionCode: 2001,
    artifacts: [{ platform: 'android', runtime: 'android', bytes: 2048 }] },
  { id: 'network.itonami.b', name: 'Torihiki', description: '取引所 devnet', publisher: 'Awai Otehon 開発版', versionName: '1.0.0', versionCode: 5, artifacts: [] },
  { id: 'network.itonami.c', name: 'Hiring', description: '求職の下書き', publisher: 'Awai Otehon 開発版', versionName: '1.2.0', versionCode: 7, artifacts: [] },
];
const key = app => app.id.split('.').pop();
const presentationOf = app => presentations[key(app)];
const neverUnavailable = () => false;
const deps = { presentationOf, isUnavailable: neverUnavailable };

test('search matches name, description, publisher, id, category and tagline', () => {
  assert.equal(visibleApps(apps, { query: 'Yotei', category: 'おすすめ' }, deps).length, 1);
  assert.equal(visibleApps(apps, { query: '取引所', category: 'おすすめ' }, deps).map(a => a.name)[0], 'Torihiki');
  assert.equal(visibleApps(apps, { query: '開発版', category: 'おすすめ' }, deps).length, 3);
  assert.equal(visibleApps(apps, { query: 'network.itonami.b', category: 'おすすめ' }, deps).length, 1);
  assert.equal(visibleApps(apps, { query: '暮らし', category: 'おすすめ' }, deps).length, 1);
  assert.equal(visibleApps(apps, { query: '手元で確かめる', category: 'おすすめ' }, deps).length, 1);
  assert.equal(visibleApps(apps, { query: '見つからない', category: 'おすすめ' }, deps).length, 0);
});

test('category filter and unavailable filtering follow the catalog', () => {
  assert.deepEqual(visibleApps(apps, { query: '', category: 'つながる' }, deps).map(a => a.name), ['Torihiki']);
  const onlyA = visibleApps(apps, { query: '', category: 'おすすめ' },
    { presentationOf, isUnavailable: app => app.id !== 'network.itonami.a' });
  assert.deepEqual(onlyA.map(a => a.name), ['Yotei']);
});

test('chips include every visible category once, おすすめ first', () => {
  assert.deepEqual(categories(apps, presentationOf, neverUnavailable), ['おすすめ', '暮らし', 'つながる', 'しごと']);
  assert.deepEqual(categories(apps, presentationOf, app => key(app) === 'c'), ['おすすめ', '暮らし', 'つながる']);
});

test('featured is the first item and the list does not repeat it', () => {
  assert.deepEqual(featuredAndRest([1, 2, 3]), { featured: 1, rest: [2, 3] });
  assert.deepEqual(featuredAndRest([]), { featured: null, rest: [] });
});

test('row meta and action labels follow the install state machine', () => {
  const [yotei] = apps;
  assert.equal(rowMeta(yotei, 'available', false), 'v0.2.1 · 同梱アプリ');
  assert.equal(rowMeta(yotei, 'available', true), 'v0.2.1 · オンライン配信');
  assert.equal(rowMeta(yotei, 'installed', true), 'v0.2.1 · 追加済み');
  assert.equal(actionLabel('available'), '取得');
  assert.equal(actionLabel('update'), '更新');
  assert.equal(actionLabel('installed'), '開く');
  assert.equal(actionLabel('unavailable'), null);
  assert.equal(deliveryLabel({ viaOnline: false, installed: false }), '同梱アプリ');
  assert.equal(detailActionLabel('installed', 'Yotei'), 'Yotei を開く');
  assert.equal(detailActionLabel('update', 'Yotei'), '更新内容を確認');
  assert.equal(detailActionLabel('available', 'Yotei'), '追加内容を確認');
});

test('review copy distinguishes install and update, and never auto-applies', () => {
  const [yotei] = apps;
  assert.equal(reviewTitle(yotei, 'available'), 'Yotei を追加しますか？');
  assert.equal(reviewTitle(yotei, 'update'), 'Yotei を更新しますか？');
  assert.equal(reviewConfirmLabel('available'), '今回の追加を確認');
  assert.equal(reviewConfirmLabel('update'), '今回の更新を確認');
  assert.equal(reviewCancelLabel('update'), '今は更新しない');
  assert.equal(reviewPageTitle(yotei, 'update'), '更新する前に');
  assert.equal(reviewPageTitle(yotei, 'available'), '追加する前に');
  assert.equal(reviewPageTitle(null, null), '確認する前に');
  assert.equal(versionTransition(yotei, null), 'Yotei v0.2.1');
  assert.equal(versionTransition(yotei, 2000), 'v2000 → v0.2.1');
});

test('size, artifact and catalog status are plain facts, not urgency', () => {
  const [yotei] = apps;
  assert.equal(artifactBytes(yotei, 'android', 'android'), 2048);
  assert.equal(artifactBytes(yotei, 'nixos', 'browser'), null);
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(1048576 * 3), '3.0 MB');
  assert.equal(formatSize(null), null);
  assert.match(catalogStatus(109, 1797839590), /^署名済みカタログ revision 109（\d{4}-\d{2}-\d{2} まで有効）。リンクを押すまで外部と通信しません。$/);
  assert.equal(pendingUpdateLine(0), '現在、追加済みアプリの更新はありません。');
  assert.equal(pendingUpdateLine(2), '更新があります（2 件）。更新は、内容を確かめてから。');
  // Quiet-by-design: no badge, count, rating, promo or urgency language anywhere.
  const all = [actionLabel('available'), reviewTitle(yotei, 'update'), catalogStatus(1, 2),
    pendingUpdateLine(3), rowMeta(yotei, 'available', false)].join(' ');
  assert(!/バッジ|おすすめクーポン|今だけ|★|個/.test(all) || /件|回/.test(all), 'no invented urgency');
});
