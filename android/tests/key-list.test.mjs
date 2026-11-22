// Runs android/tests/key-list-vectors.tsv through android/client/key-list.js. KeyListVectorsTest.java runs the
// same file through KeyList.java, so both implementations must give the same result for every vector.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyKeyList, authentic} from '../client/key-list.js';

const b = s => s === '-' ? new Uint8Array(0) : new Uint8Array(Buffer.from(s, 'base64'));
const rows = readFileSync(new URL('./key-list-vectors.tsv', import.meta.url), 'ascii').split('\n').filter(Boolean).map(l => l.split('\t'));

test('the vector file covers every refusal code and both roles', () => {
  const wants = new Set(rows.map(r => r[7]));
  for (const code of ['keys-size', 'keys-signature', 'keys-format', 'keys-schema', 'keys-number', 'keys-rollback', 'keys-issued',
    'keys-expired', 'keys-role', 'keys-count', 'keys-key', 'keys-duplicate', 'true', 'false']) assert(wants.has(code), code);
});
for (const [kind, name, now, floor, root, raw, sig, want, role, data, dataSig] of rows) {
  test(`${kind} ${name} -> ${want}`, async () => {
    let got;
    try {
      const list = await verifyKeyList(b(raw), b(sig), b(root), Number(now), Number(floor));
      got = kind === 'list' ? `ok:${list.sequence}` : String(await authentic(list, role, b(data), b(dataSig)));
    } catch (e) { got = e.message; }
    assert.equal(got, want);
  });
}
