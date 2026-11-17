// Awai release manifest: make and verify (AWAI-3067). Verification uses only the committed
// public key, never Keychain.
//
//   node manifest.mjs make <image-dir> <build-report.json> <source-revision> <out.json>
//   node manifest.mjs verify <manifest.json> <manifest.sig> <public-key-file> [image-dir]
import {createHash, createPublicKey, verify} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const sha256 = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const imageNames = ['kernel', 'ramdisk-all-combined.img', 'system.img', 'system_dlkm.img', 'vendor.img', 'vendor_dlkm.img', 'firmware.img'];

async function make(dir, reportPath, revision, out) {
  assert.match(revision, /^[0-9a-f]{40}$/, 'full source revision required');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const files = {};
  for (const name of imageNames) files[name] = {bytes: (await stat(join(dir, name))).size, sha256: await sha256(join(dir, name))};
  const manifest = {
    schema: 'awai.os.release-manifest.v1',
    kind: 'derived-development-image',
    releasedAsAwaiOs: false,
    note: 'Derived from a pinned third-party prebuilt PC Live image for development and verification. Not an Awai OS release; see AWAI-3061.',
    issue: 'AWAI-3067',
    keyId: 'release-2026-11',
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

async function check(manifestPath, sigPath, keyPath, dir) {
  const bytes = await readFile(manifestPath);
  const raw = Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'base64');
  assert.equal(raw.length, 32, 'Ed25519 raw public key expected');
  const key = createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki'});
  const signature = Buffer.from((await readFile(sigPath, 'utf8')).trim(), 'base64');
  assert(verify(null, bytes, key, signature), 'signature does not verify');
  const manifest = JSON.parse(bytes);
  if (dir) {
    const present = new Set(await readdir(dir));
    for (const [name, pin] of Object.entries(manifest.files)) {
      assert(present.has(name), `missing ${name}`);
      assert.equal((await stat(join(dir, name))).size, pin.bytes, `size ${name}`);
      assert.equal(await sha256(join(dir, name)), pin.sha256, `digest ${name}`);
    }
  }
  console.log(JSON.stringify({signatureVerified: true, filesVerified: Boolean(dir), files: Object.keys(manifest.files).length}));
}

const [command, ...args] = process.argv.slice(2);
if (command === 'make' && args.length === 4) await make(...args);
else if (command === 'verify' && (args.length === 3 || args.length === 4)) await check(...args);
else { console.error('usage: make <dir> <report> <revision> <out> | verify <manifest> <sig> <pubkey> [dir]'); process.exit(2); }
