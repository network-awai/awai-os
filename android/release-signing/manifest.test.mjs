import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./manifest.mjs', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [script, ...args], {encoding:'utf8'});
const revision = 'a'.repeat(40);

test('PC manifest verification requires authentic metadata and matching image bytes', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'awai-pc-manifest-'));
  t.after(() => rm(folder, {recursive:true, force:true}));
  const image = join(folder, 'candidate.iso');
  const manifest = join(folder, 'manifest.json');
  const signature = join(folder, 'manifest.sig');
  const publicKeyPath = join(folder, 'key.pub');
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const publicKeyBytes = publicKey.export({format:'der', type:'spki'}).subarray(-32);
  await writeFile(publicKeyPath, publicKeyBytes.toString('base64'));
  await writeFile(image, 'candidate bytes');
  const made = cli('make-pc', image, revision, manifest);
  assert.equal(made.status, 0, made.stderr);
  const original = await readFile(manifest);
  const signManifest = bytes => writeFile(signature, sign(null, bytes, privateKey).toString('base64'));
  const run = () => cli('verify-pc', manifest, signature, publicKeyPath, folder);
  await signManifest(original);
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), {signatureVerified:true, filesVerified:true, files:1});

  await writeFile(image, 'candidate byteZ');
  assert.match(run().stderr, /digest candidate\.iso/);
  await rm(image);
  assert.match(run().stderr, /missing candidate\.iso/);

  const derived = {...JSON.parse(original), kind:'derived-development-image'};
  const derivedBytes = Buffer.from(JSON.stringify(derived));
  await writeFile(manifest, derivedBytes);
  assert.match(run().stderr, /signature does not verify/);
  await signManifest(derivedBytes);
  assert.match(run().stderr, /source-built PC manifest required/);

  const ota = join(folder, 'candidate.zip');
  await writeFile(ota, 'abc');
  await rm(manifest);
  const madeOta = cli('make-ota', ota, revision, manifest);
  assert.equal(madeOta.status, 0, madeOta.stderr);
  await signManifest(await readFile(manifest));
  const verifiedOta = cli('verify-ota', manifest, signature, publicKeyPath);
  assert.equal(verifiedOta.status, 0, verifiedOta.stderr);
  assert.deepEqual(JSON.parse(verifiedOta.stdout), {
    'candidate.zip': {bytes:3, sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'},
  });
});

test('historical derived manifest still verifies with the existing public key', () => {
  const path = relative => fileURLToPath(new URL(relative, import.meta.url));
  const result = cli('verify',
    path('../desktop/derived-image/evidence/awai-manifest.json'),
    path('../desktop/derived-image/evidence/awai-manifest.json.sig'),
    path('./keys/release-2026-11.pub'));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {signatureVerified:true, filesVerified:false, files:7});
});

test('OTA manifest pins a ZIP and requires an authentic OTA manifest', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'awai-ota-manifest-'));
  t.after(() => rm(folder, {recursive:true, force:true}));
  const zip = join(folder, 'test.zip');
  const manifest = join(folder, 'ota-manifest.json');
  const signature = join(folder, 'ota-manifest.sig');
  const publicKeyPath = fileURLToPath(new URL('./keys/release-2026-11.pub', import.meta.url));
  await writeFile(zip, 'abc');
  const made = cli('make-ota', zip, revision, manifest);
  assert.equal(made.status, 0, made.stderr);
  const bytes = JSON.parse(await readFile(manifest));
  assert.equal(bytes.kind, 'pc-ab-ota');
  assert.deepEqual(bytes.files, {
    'test.zip': {bytes:3, sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'},
  });

  await writeFile(signature, 'invalid');
  assert.match(cli('verify-ota', manifest, signature, publicKeyPath).stderr, /signature does not verify/);
  assert.match(cli('make-ota', manifest, revision, join(folder, 'invalid.json')).stderr, /OTA ZIP required/);

  const path = relative => fileURLToPath(new URL(relative, import.meta.url));
  const wrongKind = cli('verify-ota',
    path('../desktop/derived-image/evidence/awai-manifest.json'),
    path('../desktop/derived-image/evidence/awai-manifest.json.sig'),
    publicKeyPath);
  assert.match(wrongKind.stderr, /PC A\/B OTA manifest required/);
});
