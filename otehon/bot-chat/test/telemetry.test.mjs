import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openTelemetry} from '../telemetry.mjs';

test('projects only verified usage, deduplicates a turn, and retries the same OTLP identity', async () => {
  const root = resolve('.agent-output', 'trace-test-' + randomUUID());
  mkdirSync(root, {recursive: true, mode: 0o700});
  const requests = [];
  let reject = true;
  const store = openTelemetry({database: root + '/traces.db', endpoint: 'http://127.0.0.1:4318/v1/traces'},
    {warn: () => {}, fetchTrace: async (url, options) => {
      requests.push(JSON.parse(options.body));
      return Response.json(reject ? {partialSuccess: {rejectedSpans: 1}} : {});
    }});
  const model = 'muse-spark-1.3';
  const input = {thread: 'private-thread', requestId: 'private-request', started: 188, ended: 290, model,
    result: {text: 'private-reply', usageCoverage: 'selected-run-final-cumulative-snapshot',
      usage: {models: [{model, input_tokens: 84, output_tokens: 0}]}}};
  store.record(input);
  await new Promise(resolve => setImmediate(resolve));
  reject = false;
  await store.flush();
  await store.flush();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  store.record(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);

  const recent = store.recent();
  const spans = recent.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans.length, 1);
  assert.equal(spans[0].endTimeUnixNano, '290000000');
  assert.equal(spans[0].status.code, 1);
  const fields = Object.fromEntries(spans[0].attributes.map(({key, value}) => [key, value]));
  assert.equal(fields['gen_ai.usage.input_tokens'].intValue, '84');
  assert.equal(fields['gen_ai.usage.output_tokens'].intValue, '0');
  assert.equal(fields['session.id'].stringValue, fields['langfuse.session.id'].stringValue);
  assert.doesNotMatch(JSON.stringify(recent), /private-/);
});
