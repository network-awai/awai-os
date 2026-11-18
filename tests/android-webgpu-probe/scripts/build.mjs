// Static build: dist/ holds every file the app needs, each pinned in release.json.
import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import {mkdir, copyFile, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const app = fileURLToPath(new URL('../', import.meta.url)), out = resolve(app, 'dist');
const sha = b => createHash('sha256').update(b).digest('hex');
await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});
for (const name of ['index.html', 'style.css', 'app.js', 'probe.js']) await copyFile(resolve(app, 'src', name), resolve(out, name));
await copyFile(resolve(app, 'src-tauri/icons/32x32.png'), resolve(out, 'icon.png'));
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
await writeFile(resolve(out, 'release.json'), JSON.stringify({schema: 'awai.app.artifact.v1', id: 'network.awai.webgpuprobe', version: '0.1.0',
  host: 'awai.shell.host.v1', tauri: '3.0.0-alpha.6', externalOperations: 0, files}, null, 2) + '\n');
console.log('WebGPU Probe static build: ' + Object.keys(files).length + ' pinned files');
