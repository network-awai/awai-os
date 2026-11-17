#!/usr/bin/env node
// Read-only check of a local OpenAI-compatible model server. No enrollment.

function options(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--model', '--local-url'].includes(key) || !argv[i + 1] || values[key]) {
      throw new Error('Usage: node-readiness.mjs --model MODEL_ID --local-url http://127.0.0.1:PORT/v1');
    }
    values[key] = argv[i + 1];
  }
  if (!values['--model'] || !values['--local-url']) {
    throw new Error('Both --model and --local-url are required');
  }
  return values;
}

function localBase(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/v1') {
    throw new Error('The model URL must be a local HTTP /v1 endpoint');
  }
  return url;
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Local model server returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const args = options(process.argv.slice(2));
  const model = args['--model'];
  const base = localBase(args['--local-url']);
  const models = await jsonRequest(new URL('models', `${base.href.replace(/\/$/, '')}/`));
  if (!Array.isArray(models.data) || !models.data.some(item => item.id === model)) {
    throw new Error(`Model ${model} is not listed by the local server`);
  }
  const completion = await jsonRequest(new URL('chat/completions', `${base.href.replace(/\/$/, '')}/`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with one short word.' }], max_tokens: 16, stream: false }),
  });
  if (completion.model !== model || typeof completion.choices?.[0]?.message?.content !== 'string'
    || !completion.choices[0].message.content.trim()) {
    throw new Error('Local inference returned no answer from the requested model');
  }
  console.log(`Local inference ready: ${model} at ${base.href}`);
  console.log('This check does not verify GPU acceleration, restart recovery, network admission, or paid jobs.');
}

main().catch(error => {
  console.error(`Local inference not ready: ${error.message}`);
  process.exitCode = 1;
});
