// Regenerates data/ from a local checkout of kotoba-lang/app-itonami-global-legislation-datoms.
//   node scripts/import-corpus.mjs <path-to-checkout> [dataset=jp.go.e-gov.elaws]
// Each corpus shard is checked against the sha256 in data/corpus/manifest.edn before it is read.
// The checkout must be clean so the recorded commit names exactly the bytes that were read.
// Output carries metadata and text addresses only; no legislative full text is copied.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEdn} from './edn.mjs';

const [source, dataset = 'jp.go.e-gov.elaws'] = process.argv.slice(2);
if (!source) throw Error('usage: import-corpus.mjs <checkout> [dataset]');
const app = fileURLToPath(new URL('../', import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex');
const git = (...a) => execFileSync('git', ['-C', source, ...a], {encoding: 'utf8'}).trim();
if (git('status', '--porcelain')) throw Error('source checkout is dirty');
const commit = git('rev-parse', 'HEAD');

const manifest = parseEdn(await readFile(resolve(source, 'data/corpus/manifest.edn'), 'utf8'));
const shards = manifest['corpus/shards'].filter(s => s.dataset === dataset);
const coverage = manifest['corpus/sources'].find(s => s.dataset === dataset);
if (!shards.length || !coverage) throw Error('dataset not in manifest: ' + dataset);

async function readShard(s) {
  const bytes = await readFile(resolve(source, s.path));
  if (bytes.length !== s.bytes || sha(bytes) !== s.sha256) throw Error('shard drift: ' + s.path);
  const rows = parseEdn(bytes.toString('utf8'));
  if (rows.length !== s.entities) throw Error('entity count drift: ' + s.path);
  return rows;
}
const laws = [], relations = [];
for (const s of shards) (s.path.includes('/laws-') ? laws : relations).push(...await readShard(s));
if (laws.length !== coverage.laws || relations.length !== coverage.relations) throw Error('coverage mismatch');

// Compact rows. Enumerations are stored once and referenced by index.
const kinds = [], statuses = [], relKinds = [];
const idx = (list, v) => { let k = list.indexOf(v); if (k < 0) k = list.push(v) - 1; return k; };
const urlBase = 'https://laws.e-gov.go.jp/law/';
const prefix = laws[0]['law/key'].split(':')[0] + ':';
const byKey = new Map();
const lawRows = laws.map((l, n) => {
  const key = l['law/key'];
  if (!key.startsWith(prefix) || key.slice(prefix.length) !== l['law/local-id']) throw Error('unexpected key ' + key);
  if (l['law/url'] !== urlBase + l['law/local-id']) throw Error('unexpected url ' + l['law/url']);
  if (byKey.has(key)) throw Error('duplicate key ' + key);
  byKey.set(key, n);
  return [l['law/local-id'], l['law/title'] ?? '', l['law/abbrev'] ?? '', l['law/number'] ?? '',
    idx(kinds, l['law/kind']), idx(statuses, l['law/status']), l['law/category'] ?? '',
    l['law/promulgated-at'] ?? '', l['law/effective-at'] ?? '', l['law/repealed-at'] ?? '',
    l['law.text/sha256'] ?? '', l['law.text/bytes'] ?? 0];
});
const relRows = relations.map(r => {
  const from = byKey.get(r['law.rel/from']), to = byKey.get(r['law.rel/to']);
  // Either end may lie outside this projection (e.g. an amending act that is not
  // itself in the corpus). Such ends stay as their key string, never dropped.
  if ((to !== undefined) !== r['law.rel/resolved?']) throw Error('resolved? mismatch: ' + r['law.rel/id']);
  return [from ?? r['law.rel/from'], to ?? r['law.rel/to'], idx(relKinds, r['law.rel/kind']), r['law.rel/at'] ?? '', r['law.rel/evidence'] ?? ''];
});
const corpus = {schema: 'itonami.horei.corpus.v1', dataset, jurisdiction: coverage.jurisdiction,
  keyPrefix: prefix, urlBase, kinds, statuses, relationKinds: relKinds,
  columns: ['localId', 'title', 'abbrev', 'number', 'kind', 'status', 'category', 'promulgatedAt', 'effectiveAt', 'repealedAt', 'textSha256', 'textBytes'],
  relationColumns: ['from', 'to', 'kind', 'at', 'evidence'],
  laws: lawRows, relations: relRows};

const txBytes = await readFile(resolve(source, 'data/datascript-tx.edn'));
const catalog = {schema: 'itonami.horei.catalog.v1', entities: parseEdn(txBytes.toString('utf8'))};

await mkdir(resolve(app, 'data'), {recursive: true});
const out = {};
for (const [name, value] of [[`${dataset}.json`, corpus], ['catalog.json', catalog]]) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  await writeFile(resolve(app, 'data', name), bytes);
  out[name] = {sha256: sha(bytes), bytes: bytes.length};
}
const provenance = {schema: 'itonami.horei.data-provenance.v1',
  source: {repository: 'kotoba-lang/app-itonami-global-legislation-datoms', commit},
  inputs: [...shards.map(s => ({path: s.path, sha256: s.sha256, entities: s.entities})),
    {path: 'data/datascript-tx.edn', sha256: sha(txBytes), entities: catalog.entities.length}],
  coverage, fullTextBytesHeld: 0, outputs: out};
await writeFile(resolve(app, 'data/PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(`imported ${lawRows.length} laws, ${relRows.length} relations, ${catalog.entities.length} catalog entities from ${commit.slice(0, 7)}`);
