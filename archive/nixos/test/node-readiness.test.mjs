import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../node-readiness.mjs', import.meta.url));
let server;
let base;
let returnedModel = 'test-model';

before(async () => {
  server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    } else if (request.url === '/v1/chat/completions') {
      let body = '';
      for await (const part of request) body += part;
      const payload = JSON.parse(body);
      response.end(JSON.stringify({ model: returnedModel, choices: [{ message: { content: payload.model === 'test-model' ? 'Ready' : '' } }] }));
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function run(model, url = base) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--model', model, '--local-url', url], { timeout: 20000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', part => { stdout += part; });
    child.stderr.on('data', part => { stderr += part; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('responding exact local model passes', async () => {
  const result = await run('test-model');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Local inference ready/);
});

test('absent model fails before inference', async () => {
  const result = await run('other-model');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not listed/);
});

test('remote or non-HTTP URL is refused', async () => {
  for (const url of ['https://example.com/v1', 'http://192.0.2.1/v1', `${base}/../other`]) {
    const result = await run('test-model', url);
    assert.equal(result.status, 1, url);
  }
});

test('a fallback model response fails', async () => {
  returnedModel = 'wrong-model';
  const result = await run('test-model');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requested model/);
});
