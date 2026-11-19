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
