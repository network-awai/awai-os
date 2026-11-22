#!/usr/bin/env node
// Writes android/tests/key-list-vectors.tsv: test vectors for itonami.store.keys.v1 that the Java
// (KeyListVectorsTest.java) and JavaScript (key-list.test.mjs) implementations must both agree on.
//
// Keys are generated here for this run only. The file holds public keys, list bytes and signatures;
// no private key is written anywhere. Regenerate only when the vectors themselves change:
//   node android/tests/key-list-vectors.mjs > android/tests/key-list-vectors.tsv
//
// Columns (tab-separated, base64 for bytes, "-" for empty):
//   kind name now floor root raw signature want [role data dataSignature]
// kind "list": want is "ok:<sequence>" or the refusal code.
// kind "auth": the list must verify; want is "true" or "false" for authentic(role, data, dataSignature).
import {generateKeyPairSync, sign} from 'node:crypto';

const NOW = 1800000000, DAY = 86400;
const rsa = bits => generateKeyPairSync('rsa', {modulusLength: bits});
const spki = k => k.publicKey.export({type: 'spki', format: 'der'});
const b64 = b => b.length ? Buffer.from(b).toString('base64') : '-';
const signWith = (k, data) => sign('sha256', data, k.privateKey);
const text = s => Buffer.from(s, 'latin1');
const list = (seq, issued, expires, lines) =>
  `itonami.store.keys.v1\nsequence ${seq}\nissued ${issued}\nexpires ${expires}\n` + lines.map(l => l + '\n').join('');

const root = rsa(2048), other = rsa(2048), c1 = rsa(2048), c2 = rsa(2048), p1 = rsa(2048), p2 = rsa(2048), weak = rsa(1024);
const ec = generateKeyPairSync('ec', {namedCurve: 'P-256'});
const cat = k => 'key catalog ' + b64(spki(k));
const ptr = k => 'key pointer ' + b64(spki(k));
const good = list(3, NOW - DAY, NOW + 90 * DAY, [cat(c1), ptr(p1)]);

const rows = [];
function row(name, want, rawText, {signer = root, rootKey = root, now = NOW, floor = 0, rawBytes, sig} = {}) {
  const raw = rawBytes ?? text(rawText);
  const signature = sig ?? (raw.length ? signWith(signer, raw) : Buffer.alloc(0));
  rows.push(['list', name, now, floor, b64(spki(rootKey)), b64(raw), b64(signature), want]);
}
function auth(name, want, role, signer, data = text('itonami catalog bytes')) {
  const raw = text(good);
  rows.push(['auth', name, NOW, 0, b64(spki(root)), b64(raw), b64(signWith(root, raw)), want, role, b64(data), b64(signWith(signer, data))]);
}

row('accepted', 'ok:3', good);
row('two keys per role', 'ok:4', list(4, NOW - DAY, NOW + 90 * DAY, [cat(c1), cat(c2), ptr(p1), ptr(p2)]));
row('issued within the clock skew', 'ok:3', list(3, NOW + 300, NOW + 90 * DAY, [cat(c1), ptr(p1)]));
row('sequence equal to the floor', 'ok:3', good, {floor: 3});
row('empty', 'keys-size', '', {rawBytes: Buffer.alloc(0), sig: Buffer.from([1])});
row('over 16384 bytes', 'keys-size', good + 'x'.repeat(16384));
row('signed by another key', 'keys-signature', good, {signer: other});
row('weak root', 'keys-signature', good, {signer: weak, rootKey: weak});
row('changed after signing', 'keys-signature', good, {sig: signWith(root, text(good.replace('sequence 3', 'sequence 4')))});
row('CR line ending', 'keys-format', good.replace(/\n/g, '\r\n'));
row('tab', 'keys-format', good.replace('sequence 3', 'sequence\t3'));
row('no final LF', 'keys-format', good.slice(0, -1));
row('empty line', 'keys-format', good.replace('\nkey pointer', '\n\nkey pointer'));
row('non-ASCII byte', 'keys-format', '', {rawBytes: Buffer.concat([text(good.slice(0, -1)), Buffer.from([0xc3, 0xa9, 0x0a])])});
row('too few lines', 'keys-format', 'itonami.store.keys.v1\nsequence 3\nissued 1\n');
row('wrong field name', 'keys-format', good.replace('issued ', 'issue '));
row('key line with four parts', 'keys-format', good.replace('key pointer ', 'key pointer x '));
row('other schema', 'keys-schema', good.replace('itonami.store.keys.v1', 'itonami.store.keys.v2'));
row('leading zero', 'keys-number', good.replace('sequence 3', 'sequence 03'));
row('sign', 'keys-number', good.replace('sequence 3', 'sequence +3'));
row('sixteen digits', 'keys-number', good.replace('sequence 3', 'sequence 1000000000000000'));
row('zero', 'keys-number', good.replace('sequence 3', 'sequence 0'));
row('below the floor', 'keys-rollback', good, {floor: 4});
row('issued in the future', 'keys-issued', list(3, NOW + 301, NOW + 90 * DAY, [cat(c1), ptr(p1)]));
row('expired', 'keys-expired', list(3, NOW - 100 * DAY, NOW, [cat(c1), ptr(p1)]));
row('lifetime over 190 days', 'keys-expired', list(3, NOW - DAY, NOW - DAY + 190 * DAY + 1, [cat(c1), ptr(p1)]));
row('unknown role', 'keys-role', list(3, NOW - DAY, NOW + 90 * DAY, [cat(c1), 'key apk ' + b64(spki(c2)), ptr(p1)]));
row('catalog after pointer', 'keys-role', list(3, NOW - DAY, NOW + 90 * DAY, [cat(c1), ptr(p1), cat(c2)]));
row('no pointer key', 'keys-count', list(3, NOW - DAY, NOW + 90 * DAY, [cat(c1)]));
row('no catalog key', 'keys-count', list(3, NOW - DAY, NOW + 90 * DAY, [ptr(p1)]));
row('five catalog keys', 'keys-count', list(3, NOW - DAY, NOW + 90 * DAY,
  [...[1, 2, 3, 4, 5].map(() => cat(rsa(2048))), ptr(p1)]));
// A 3072-bit SPKI is 422 bytes, so its base64 ends in one '='. Without it, both decoders accept the text
// but it is not the canonical spelling.
const padded = rsa(3072);
if (!cat(padded).endsWith('=')) throw new Error('expected a padded key');
row('canonical base64 with padding', 'ok:3', list(3, NOW - DAY, NOW + 90 * DAY, [cat(padded), ptr(p1)]));
row('non-canonical base64 (padding removed)', 'keys-key', list(3, NOW - DAY, NOW + 90 * DAY, [cat(padded).replace(/=+$/, ''), ptr(p1)]));
row('base64 with an extra character', 'keys-key', list(3, NOW - DAY, NOW + 90 * DAY, [cat(c1) + 'A', ptr(p1)]));
row('weak role key', 'keys-key', list(3, NOW - DAY, NOW + 90 * DAY, [cat(weak), ptr(p1)]));
row('not an RSA key', 'keys-key', list(3, NOW - DAY, NOW + 90 * DAY, ['key catalog ' + b64(ec.publicKey.export({type: 'spki', format: 'der'})), ptr(p1)]));
row('same key twice in one role', 'keys-duplicate', list(3, NOW - DAY, NOW + 90 * DAY, [cat(c1), cat(c1), ptr(p1)]));
row('same key in both roles', 'keys-duplicate', list(3, NOW - DAY, NOW + 90 * DAY, [cat(c1), ptr(c1)]));
row('root listed', 'keys-duplicate', list(3, NOW - DAY, NOW + 90 * DAY, [cat(root), ptr(p1)]));
auth('catalog key signs a catalog', 'true', 'catalog', c1);
auth('pointer key signs a pointer', 'true', 'pointer', p1);
auth('catalog key signs a pointer', 'false', 'pointer', c1);
auth('pointer key signs a catalog', 'false', 'catalog', p1);
auth('root signs a catalog', 'false', 'catalog', root);
auth('unlisted key', 'false', 'catalog', c2);
auth('unknown role', 'false', 'apk', c1);

process.stdout.write(rows.map(r => r.join('\t')).join('\n') + '\n');
