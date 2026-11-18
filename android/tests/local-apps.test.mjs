// AWAI-3502: the local-app table, the host allowlist and the Store presentation name the same apps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const table = JSON.parse(read('../local-apps.json'));
const suffixes = table.apps.map((a) => a.suffix);
test('suffixes are unique Store-safe names', () => {
  assert.equal(new Set(suffixes).size, suffixes.length);
  for (const s of suffixes) assert.match(s, /^[a-z0-9]+$/, s);
  for (const a of table.apps) { assert.ok(a.name && a.description, a.suffix); }
});
test('Catalog.java admits exactly the table', () => {
  const java = read('../shared/src/network/awai/platform/Catalog.java');
  const list = java.match(/LOCAL_APPS = [^;]*Arrays\.asList\(([^)]*)\)/s)[1];
  assert.deepEqual([...list.matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]), suffixes);
});
test('the Store client presents exactly the table as on-device apps', () => {
  const js = read('../client/client.js');
  const set = js.match(/const localApps = new Set\(\[([^\]]*)\]\)/)[1];
  assert.deepEqual([...set.matchAll(/'network\.itonami\.([a-z0-9]+)'/g)].map((m) => m[1]), suffixes);
});
test('no local suffix collides with an app the Store already admits by name', () => {
  const java = read('../shared/src/network/awai/platform/Catalog.java');
  const named = [...java.matchAll(/"network\.itonami\.([a-z0-9.]+)"\.equals\(id\)/g)].map((m) => m[1]);
  for (const s of suffixes) assert.ok(!named.includes(s), s);
});
