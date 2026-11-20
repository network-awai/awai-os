import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runProbe, classify, computeInput, computeExpected, computeMismatch, renderCheck, BYTES_PER_ROW, SIZE, CLEAR, FILL, SCHEMA} from '../src/probe.js';

const now = () => '2026-11-18T00:00:00.000Z';

test('missing navigator.gpu is unavailable, never ok', async () => {
  const r = await runProbe({gpu: undefined, now});
  assert.equal(r.schema, SCHEMA);
  assert.equal(r.status, 'unavailable');
  assert.match(r.reason, /navigator\.gpu/);
});

test('a null adapter is unavailable', async () => {
  const r = await runProbe({gpu: {requestAdapter: async () => null}, now});
  assert.equal(r.status, 'unavailable');
  assert.match(r.reason, /null/);
});

test('requestAdapter or requestDevice throwing is failed', async () => {
  const a = await runProbe({gpu: {requestAdapter: async () => { throw new Error('boom'); }}, now});
  assert.equal(a.status, 'failed');
  const adapter = {features: new Set(['f16']), limits: {}, info: {vendor: 'v'}, requestDevice: async () => { throw new Error('no device'); }};
  const d = await runProbe({gpu: {requestAdapter: async () => adapter}, now});
  assert.equal(d.status, 'failed');
  assert.deepEqual(d.errors, ['no device']);
  assert.equal(d.adapter.vendor, 'v');
});

test('compute check accepts only the exact expected output', () => {
  const input = computeInput(), want = computeExpected(input);
  assert.equal(computeMismatch(input, want), -1);
  const off = want.slice(); off[17] += 1;
  assert.equal(computeMismatch(input, off), 17);
  assert.equal(computeMismatch(input, want.slice(0, 10)), 0, 'short output');
  assert.notEqual(computeMismatch(input, input), -1, 'a dispatch that did nothing is a mismatch');
});

function image(fill) {
  const b = new Uint8Array(BYTES_PER_ROW * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) b.set(fill(x, y), y * BYTES_PER_ROW + x * 4);
  return b;
}

test('render check needs the triangle colour inside and the clear colour outside', () => {
  const tri = (x, y) => (Math.abs(x - SIZE / 2) < 4 && y > 4 ? FILL : CLEAR);
  assert.equal(renderCheck(image(tri)).ok, true);
  assert.equal(renderCheck(image(() => CLEAR)).ok, false, 'clear only: nothing drawn');
  assert.equal(renderCheck(image(() => FILL)).ok, false, 'no clear: corner wrong');
  assert.equal(renderCheck(image(() => [0, 0, 0, 0])).ok, false, 'zeroed readback');
});

test('classify is ok only with no errors and both checks ok', () => {
  assert.equal(classify({compute: {ok: true}, render: {ok: true}, errors: []}), 'ok');
  assert.equal(classify({compute: {ok: true}, render: {ok: false}, errors: []}), 'failed');
  assert.equal(classify({compute: {ok: true}, errors: []}), 'failed', 'render missing');
  assert.equal(classify({compute: {ok: true}, render: {ok: true}, errors: ['validation: x']}), 'failed');
  assert.equal(classify({status: 'unavailable'}), 'unavailable');
});
