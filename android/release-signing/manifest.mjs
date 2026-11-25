// Awai release manifests (AWAI-3067, AWAI-3062). Verification uses only the committed
// public key, never Keychain.
//
//   node manifest.mjs make <image-dir> <build-report.json> <source-revision> <out.json>
//   node manifest.mjs verify <manifest.json> <manifest.sig> <public-key-file> [image-dir]
//   node manifest.mjs make-pc <image-file> <source-revision> <out.json>
//   node manifest.mjs verify-pc <manifest.json> <manifest.sig> <public-key-file> <image-dir>
//   node manifest.mjs make-ota <ota.zip> <source-revision> <out.json>
//   node manifest.mjs verify-ota <manifest.json> <manifest.sig> <public-key-file>
import {createHash, createPublicKey, verify} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import assert from 'node:assert/strict';

const sha256 = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const imageNames = ['kernel', 'ramdisk-all-combined.img', 'system.img', 'system_dlkm.img', 'vendor.img', 'vendor_dlkm.img', 'firmware.img'];
const schema = 'awai.os.release-manifest.v1';
const pcKind = 'source-built-pc-image';
const otaKind = 'pc-ab-ota';
const keyId = 'release-2026-11';
const revisionPattern = /^[0-9a-f]{40}$/;
const filenamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

async function make(dir, reportPath, revision, out) {
  assert.match(revision, revisionPattern, 'full source revision required');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const files = {};
  for (const name of imageNames) files[name] = {bytes: (await stat(join(dir, name))).size, sha256: await sha256(join(dir, name))};
  const manifest = {
    schema,
    kind: 'derived-development-image',
    releasedAsAwaiOs: false,
    note: 'Derived from a pinned third-party prebuilt PC Live image for development and verification. Not an Awai OS release; see AWAI-3061.',
    issue: 'AWAI-3067',
    keyId,
    base: {
      isoSha256: '63c15c052ff4a9841c680f550c77f1dedaadc6455eca828edd6143f9d5e547e3',
      pins: 'android/desktop/pc-evaluation-pins.json',
      systemSha256: '4c95555125385e1091183d4d8a8b4bdbd8c2a83b34ab56c4a180d9142588ae56',
      vendorSha256: 'de90b3edef88f547e2eab90821764a9eee8c1f528da622284220544d6235b2ca'
    },
    derivation: {
      sourceRevision: revision,
      script: 'android/desktop/derived-image/build-images.sh',
      productApps: Object.fromEntries(Object.entries(report.artifacts).map(([name, a]) => [name, {sha256: a.sha256, bytes: a.bytes}])),
      vendorProperties: {'vendor.hwc.drm.primary_display': 'DP-1'},
      unchanged: 'All other files keep content, mode, owner and xattrs; symlink mode bits become 0777 (not checked by Linux or Android).'
    },
    files
  };
  await writeFile(out, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  console.log(out);
}

async function makePc(imagePath, revision, out, kind = pcKind) {
  assert.match(revision, revisionPattern, 'full source revision required');
  const filename = basename(imagePath);
  assert.match(filename, filenamePattern, 'plain image filename required');
  if (kind === otaKind) assert.match(filename, /\.zip$/, 'OTA ZIP required');
  const image = await lstat(imagePath);
  assert(image.isFile() && image.size > 0, 'non-empty regular image file required');
  const manifest = {
    schema,
    kind,
    target: 'pc-x86_64',
    keyId,
    sourceRevision: revision,
    files: {[filename]: {bytes: image.size, sha256: await sha256(imagePath)}},
  };
  await writeFile(out, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  console.log(out);
}

async function check(manifestPath, sigPath, keyPath, dir, expectedKind) {
  const bytes = await readFile(manifestPath);
  const raw = Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'base64');
  assert.equal(raw.length, 32, 'Ed25519 raw public key expected');
  const key = createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki'});
  const signature = Buffer.from((await readFile(sigPath, 'utf8')).trim(), 'base64');
  assert(verify(null, bytes, key, signature), 'signature does not verify');
  const manifest = JSON.parse(bytes);
  if (expectedKind) {
    assert.equal(manifest.schema, schema, 'unexpected manifest schema');
    assert.equal(manifest.kind, expectedKind, expectedKind === pcKind
      ? 'source-built PC manifest required' : 'PC A/B OTA manifest required');
    assert.equal(manifest.target, 'pc-x86_64', 'unexpected PC target');
    assert.equal(manifest.keyId, keyId, 'unexpected release key id');
    assert.match(manifest.sourceRevision, revisionPattern, 'full source revision required');
    assert(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), 'image pins required');
    const entries = Object.entries(manifest.files);
    assert.equal(entries.length, 1, 'exactly one image pin required');
    const [[name, pin]] = entries;
    assert.match(name, filenamePattern, 'plain image filename required');
    if (expectedKind === otaKind) assert.match(name, /\.zip$/, 'OTA ZIP required');
    assert(Number.isSafeInteger(pin?.bytes) && pin.bytes > 0, 'positive image byte count required');
    assert.match(pin.sha256, /^[0-9a-f]{64}$/, 'SHA-256 image digest required');
  }
  if (dir) {
    const present = new Set(await readdir(dir));
    for (const [name, pin] of Object.entries(manifest.files)) {
      assert(present.has(name), `missing ${name}`);
      const path = join(dir, name);
      const image = await (expectedKind ? lstat(path) : stat(path));
      if (expectedKind) assert(image.isFile(), `regular image file required: ${name}`);
      assert.equal(image.size, pin.bytes, `size ${name}`);
      assert.equal(await sha256(path), pin.sha256, `digest ${name}`);
    }
  }
  if (expectedKind === otaKind) {
    console.log(JSON.stringify(manifest.files));
  } else {
    console.log(JSON.stringify({signatureVerified: true, filesVerified: Boolean(dir), files: Object.keys(manifest.files).length}));
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'make' && args.length === 4) await make(...args);
else if (command === 'make-pc' && args.length === 3) await makePc(...args);
else if (command === 'verify' && (args.length === 3 || args.length === 4)) await check(...args);
else if (command === 'verify-pc' && args.length === 4) await check(...args, pcKind);
else if (command === 'make-ota' && args.length === 3) await makePc(...args, otaKind);
else if (command === 'verify-ota' && args.length === 3) await check(...args, undefined, otaKind);
else { console.error('usage: make <dir> <report> <revision> <out> | verify <manifest> <sig> <pubkey> [dir] | make-pc <image> <revision> <out> | verify-pc <manifest> <sig> <pubkey> <dir>'); process.exit(2); }
