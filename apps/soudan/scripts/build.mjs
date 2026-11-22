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
for (const name of ['style.css', 'app.js', 'model.js', 'messages.js', 'operations.js', 'send.js']) await copyFile(resolve(app, 'src', name), resolve(out, name));
await copyFile(resolve(repo, 'packages/awai-shell/host.js'), resolve(out, 'host.js'));
// The page icon is inlined: Android WebView re-requests a linked icon on every URL change.
const icon = 'data:image/png;base64,' + (await readFile(resolve(app, 'src-tauri/icons/32x32.png'))).toString('base64');
const html = await readFile(resolve(app, 'src/index.html'), 'utf8');
if (!html.includes('href="icon.png"')) throw Error('index.html icon link missing');
await writeFile(resolve(out, 'index.html'), html.replace('href="icon.png"', `href="${icon}"`));
const pins = JSON.parse(await readFile(resolve(repo, 'otehon/shell/vendor/PINS.json'), 'utf8'));
for (const [input, output] of [['kotoba-client-runtime.js', 'runtime.js'], ['kotoba-client-consent.css', 'runtime-consent.css']]) {
  const bytes = await readFile(resolve(repo, 'otehon/shell/vendor', input));
  if (sha(bytes) !== pins.files[input]) throw Error('canonical runtime pin drift');
  await writeFile(resolve(out, output), bytes);
}
// The only declared operation hands the memo to the OS share sheet (a browser-action with the
// user-selected-app recipient), which causes no fetch from the page: connect-src carries only the
// Tauri IPC. Both CSPs must say so.
const {runtimeDescriptor, REQUESTED_CAPABILITIES, SEND_SELECTOR} = await import('../src/operations.js');
const {clientRuntimeProblems, clientRuntimeConnectSrc} = await import('../../../otehon/shell/vendor/kotoba-client-runtime.js');
const descriptor = runtimeDescriptor();
if (clientRuntimeProblems(descriptor, [...REQUESTED_CAPABILITIES], 'http://tauri.localhost').length) throw Error('invalid runtime descriptor');
if (descriptor.operations.length !== 1
  || descriptor.operations[0].capability !== SEND_SELECTOR.capability
  || descriptor.operations[0].service !== SEND_SELECTOR.service
  || descriptor.operations[0].operation !== SEND_SELECTOR.operation
  || clientRuntimeConnectSrc(descriptor, [...REQUESTED_CAPABILITIES], [], 'http://tauri.localhost') !== "connect-src 'none'") throw Error('unexpected external operation');
const tauriCsp = JSON.parse(await readFile(resolve(app, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
for (const [name, csp] of [['index.html', html], ['tauri.conf.json', tauriCsp]]) if (!csp.includes('connect-src ipc: http://ipc.localhost;')) throw Error('CSP connect-src must be IPC only: ' + name);
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
await writeFile(resolve(out, 'release.json'), JSON.stringify({schema: 'awai.app.artifact.v1', id: 'network.itonami.soudan', version: '0.1.0',
  host: 'awai.shell.host.v1', tauri: '3.0.0-alpha.6', files}, null, 2) + '\n');
console.log('Soudan static build: ' + Object.keys(files).length + ' pinned files');
