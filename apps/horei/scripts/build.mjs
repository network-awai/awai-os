// Static build: dist/ holds every file the app needs, each pinned in release.json.
// The law data is checked against data/PROVENANCE.json before it is packaged.
import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import {mkdir, copyFile, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const app = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(app, '../..'), out = resolve(app, 'dist');
const sha = b => createHash('sha256').update(b).digest('hex');
await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});
for (const name of ['index.html', 'style.css', 'app.js', 'model.js', 'messages.js']) await copyFile(resolve(app, 'src', name), resolve(out, name));
await copyFile(resolve(repo, 'packages/awai-shell/host.js'), resolve(out, 'host.js'));
await copyFile(resolve(app, 'src-tauri/icons/32x32.png'), resolve(out, 'icon.png'));
const pins = JSON.parse(await readFile(resolve(repo, 'otehon/shell/vendor/PINS.json'), 'utf8'));
for (const [input, output] of [['kotoba-client-runtime.js', 'runtime.js'], ['kotoba-client-consent.css', 'runtime-consent.css']]) {
  const bytes = await readFile(resolve(repo, 'otehon/shell/vendor', input));
  if (sha(bytes) !== pins.files[input]) throw Error('canonical runtime pin drift');
  await writeFile(resolve(out, output), bytes);
}
// Data is packaged as ES modules so the page needs no fetch/connect-src for its own files.
const provenance = JSON.parse(await readFile(resolve(app, 'data/PROVENANCE.json'), 'utf8'));
const dataFiles = {[`${provenance.coverage.dataset}.json`]: 'corpus.js', 'catalog.json': 'catalog.js'};
for (const [input, output] of Object.entries(dataFiles)) {
  const bytes = await readFile(resolve(app, 'data', input));
  const pin = provenance.outputs[input];
  if (!pin || bytes.length !== pin.bytes || sha(bytes) !== pin.sha256) throw Error('data drift: ' + input);
  JSON.parse(bytes);
  await writeFile(resolve(out, output), 'export default ' + bytes.toString('utf8').trimEnd() + ';\n');
}
await copyFile(resolve(app, 'data/PROVENANCE.json'), resolve(out, 'data-provenance.json'));
const descriptor = {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
  'local-state': {adapter: 'memory', schema: 'itonami.horei.state.v1', version: 1}, workers: [], operations: []};
await writeFile(resolve(out, 'descriptor.json'), JSON.stringify(descriptor, null, 2) + '\n');
await distributeUi(out);
async function list(dir, rel = '') {
  const result = [];
  for (const e of await readdir(resolve(dir, rel), {withFileTypes: true})) {
    const n = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) result.push(...await list(dir, n)); else if (e.isFile() && n !== 'release.json') result.push(n);
  }
  return result.sort();
}
const files = {};
for (const n of await list(out)) files[n] = sha(await readFile(resolve(out, n)));
await writeFile(resolve(out, 'release.json'), JSON.stringify({schema: 'awai.app.artifact.v1', id: 'network.itonami.horei', version: '0.1.0',
  host: 'awai.shell.host.v1', tauri: '3.0.0-alpha.6', data: {source: provenance.source, dataset: provenance.coverage.dataset, fullTextBytesHeld: 0}, files}, null, 2) + '\n');
console.log('Horei static build: ' + Object.keys(files).length + ' pinned files');
