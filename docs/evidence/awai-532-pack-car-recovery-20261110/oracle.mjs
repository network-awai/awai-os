// One-off reference measurement; this script is not a runtime/build/CI dependency.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CarReader } from '@ipld/car';
import { decode } from '@ipld/dag-cbor';

const [carFile, payloadFile] = process.argv.slice(2);
const bytes = await readFile(carFile);
const expected = await readFile(payloadFile);
const hash = b => createHash('sha256').update(b).digest();
const reader = await CarReader.fromBytes(bytes);
assert.equal(reader.version, 2);
const roots = await reader.getRoots();
assert.equal(roots.length, 1);
const root = roots[0];
assert.equal(root.code, 0x71);
const blocks = [];
for await (const block of reader.blocks()) {
  assert.equal(block.cid.multihash.code, 0x12);
  assert.deepEqual(hash(block.bytes), Buffer.from(block.cid.multihash.digest));
  blocks.push(block);
}
const rootBlock = blocks.at(-1);
assert(root.equals(rootBlock.cid));
const dag = decode(rootBlock.bytes);
assert.deepEqual(Object.keys(dag), ['leaves']);
assert.equal(dag.leaves.length, blocks.length - 1);
const payload = Buffer.concat(blocks.slice(0, -1).map((block, i) => {
  assert.equal(block.cid.code, 0x55);
  assert(block.cid.equals(dag.leaves[i]));
  return block.bytes;
}));
assert.deepEqual(payload, expected);
assert.equal(bytes.readBigUInt64LE(27), 51n);
assert.equal(bytes.readBigUInt64LE(35), BigInt(bytes.length - 51));
assert.equal(bytes.readBigUInt64LE(43), 0n);
console.log(JSON.stringify({
  oracle: '@ipld/car@5.4.7 + @ipld/dag-cbor@10.0.2',
  node: process.version, carVersion: reader.version,
  carBytes: bytes.length, carSha256: hash(bytes).toString('hex'),
  rootCid: root.toString(), blocks: blocks.length, leaves: dag.leaves.length,
  allBlockDigestsVerified: true, dagCborLinksVerified: true,
  payloadBytes: payload.length, payloadSha256: hash(payload).toString('hex'),
  byteEqual: true, indexOffset: 0, pass: true
}, null, 2));
