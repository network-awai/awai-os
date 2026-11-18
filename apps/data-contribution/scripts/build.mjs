// Static build: dist/ holds every file the app needs, each pinned in release.json.
import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import {mkdir, copyFile, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const app = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(app, '../..'), out = resolve(app, 'dist');
const sha = b => createHash('sha256').update(b).digest('hex');
await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});
for (const name of ['index.html', 'style.css', 'app.js', 'model.js', 'messages.js', 'edn.js']) await copyFile(resolve(app, 'src', name), resolve(out, name));
await copyFile(resolve(repo, 'packages/awai-shell/host.js'), resolve(out, 'host.js'));
await copyFile(resolve(app, 'src-tauri/icons/32x32.png'), resolve(out, 'icon.png'));
const pins = JSON.parse(await readFile(resolve(repo, 'otehon/shell/vendor/PINS.json'), 'utf8'));
for (const [input, output] of [['kotoba-client-runtime.js', 'runtime.js'], ['kotoba-client-consent.css', 'runtime-consent.css']]) {
  const bytes = await readFile(resolve(repo, 'otehon/shell/vendor', input));
  if (sha(bytes) !== pins.files[input]) throw Error('canonical runtime pin drift');
  await writeFile(resolve(out, output), bytes);
}
// The one external operation (submit a contribution) and the CSP connect-src are derived from the same declaration.
const {runtimeDescriptor, SELECTOR} = await import('../src/model.js');
const {clientRuntimeProblems, clientRuntimeConnectSrc} = await import('../../../otehon/shell/vendor/kotoba-client-runtime.js');
const descriptor = runtimeDescriptor();
if (clientRuntimeProblems(descriptor, [SELECTOR.capability], 'https://tauri.localhost').length) throw Error('invalid runtime descriptor');
const connect = 'connect-src ipc: http://ipc.localhost ' + clientRuntimeConnectSrc(descriptor, [SELECTOR.capability], [], 'https://tauri.localhost').slice('connect-src '.length) + ';';
const html = await readFile(resolve(app, 'src/index.html'), 'utf8');
const tauriCsp = JSON.parse(await readFile(resolve(app, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
for (const [name, csp] of [['index.html', html], ['tauri.conf.json', tauriCsp]]) if (!csp.includes(connect)) throw Error('CSP connect-src differs from the descriptor: ' + name);
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
await writeFile(resolve(out, 'release.json'), JSON.stringify({schema: 'awai.app.artifact.v1', id: 'network.itonami.datacontribution', version: '0.1.0',
  host: 'awai.shell.host.v1', tauri: '3.0.0-alpha.6', externalOperations: descriptor.operations.length, payout: false, files}, null, 2) + '\n');
console.log('Data Contributions static build: ' + Object.keys(files).length + ' pinned files');
