import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const [app, browserPath, kotobaPath, outputPath] = process.argv.slice(2);
const editors = new Map([
  ['bunsho', ['Bunsho', 'bunsho-worker']],
  ['hyokeisan', ['Hyokeisan', 'hyokeisan-worker']],
  ['zuhyo', ['Zuhyo', 'zuhyo-worker']],
]);
if (!editors.has(app) || !browserPath || !kotobaPath || !outputPath) {
  throw new Error('Usage: node prepare.mjs bunsho|hyokeisan|zuhyo BROWSER_BUILD KOTOBA_REPO NEW_OUTPUT');
}
const [title, workerId] = editors.get(app);
const browser = resolve(browserPath);
const output = resolve(outputPath);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const runtime = execFileSync('git', ['-C', resolve(kotobaPath), 'show',
  'ecbfc15b139280a0d2563a5375d69c9a11156dc2:lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js']);
if (digest(runtime) !== '0926b63b9a80c956e9758fed2cf3159cf8a02f7edf4d3424c2b991dbb7897fc6') {
  throw new Error('Canonical runtime digest mismatch');
}

const receipt = JSON.parse(await readFile(resolve(browser, 'build-receipt.json'), 'utf8'));
const descriptor = JSON.parse(await readFile(resolve(browser, 'client-runtime.json'), 'utf8'));
if (descriptor.schema !== 'kotoba.app.client-runtime.v1' ||
    descriptor.entry !== 'index.html' || descriptor.operations?.length !== 0 ||
    descriptor.workers?.length !== 1 || descriptor.workers[0].id !== workerId ||
    descriptor.workers[0].entry !== 'worker.js') {
  throw new Error('Unexpected Office runtime descriptor');
}
for (const [file, field] of [
  ['program.wasm', 'wasmSha256'], ['draft-policy.wasm', 'draftPolicyWasmSha256'],
  ['worker.js', 'workerSha256'], ['transactional-storage.js', 'transactionalStorageSha256'],
  ['managed-storage.js', 'managedStorageSha256'],
]) {
  if (digest(await readFile(resolve(browser, file))) !== receipt[field]) {
    throw new Error(`Browser build receipt does not match ${file}`);
  }
}
const bundle = await readFile(resolve(browser, 'bundle.js'), 'utf8');
for (const [file, field] of [['program.wasm', 'wasmBase64'], ['draft-policy.wasm', 'draftPolicyBase64']]) {
  const wasm = await readFile(resolve(browser, file));
  if (!bundle.includes(`export const ${field} = ${JSON.stringify(wasm.toString('base64'))};`)) {
    throw new Error(`Embedded Wasm does not match ${file}`);
  }
}

await mkdir(output);
const dist = resolve(output, 'dist');
const tauri = resolve(output, 'src-tauri');
await mkdir(dist);
await mkdir(resolve(tauri, 'src'), { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'bundle.js', 'worker.js',
  'transactional-storage.js', 'managed-storage.js', 'client-runtime.json']) {
  await cp(resolve(browser, file), resolve(dist, file));
}
await writeFile(resolve(dist, 'kotoba-client-runtime.js'), runtime);
const template = resolve(here, '../horei');
for (const file of ['package.json', 'package-lock.json']) {
  const pkg = JSON.parse(await readFile(resolve(template, file), 'utf8'));
  pkg.name = `@itonami/${app}`;
  if (pkg.packages) pkg.packages[''].name = pkg.name;
  if (pkg.scripts) pkg.scripts = { tauri: 'tauri' };
  await writeFile(resolve(output, file), JSON.stringify(pkg, null, 2) + '\n');
}
await cp(resolve(template, 'src-tauri/build.rs'), resolve(tauri, 'build.rs'));
const cargo = (await readFile(resolve(template, 'src-tauri/Cargo.toml'), 'utf8'))
  .replaceAll('horei', 'office_editor');
const lock = (await readFile(resolve(template, 'src-tauri/Cargo.lock'), 'utf8'))
  .replace('name = "horei"\n', 'name = "office_editor"\n');
await writeFile(resolve(tauri, 'Cargo.toml'), cargo);
await writeFile(resolve(tauri, 'Cargo.lock'), lock);
await writeFile(resolve(tauri, 'src/main.rs'), 'fn main() { office_editor_lib::run(); }\n');
await writeFile(resolve(tauri, 'src/lib.rs'), `#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .run(tauri::generate_context!())
        .expect("Office editor initialization failed");
}
`);
const config = {
  $schema: 'https://schema.tauri.app/config/3',
  productName: title,
  version: '0.1.0',
  identifier: `network.itonami.${app}`,
  build: { frontendDist: '../dist' },
  app: {
    windows: [{ label: 'main', title, width: 960, height: 820, useHttpsScheme: true }],
    security: { csp: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; worker-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" },
  },
  bundle: { active: false },
};
await writeFile(resolve(tauri, 'tauri.conf.json'), JSON.stringify(config, null, 2) + '\n');
