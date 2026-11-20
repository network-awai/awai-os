import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function receipt(binding, events) {
  if (!binding || !/^[A-Z][A-Z0-9]*-\d+$/.test(binding.issueId)
      || !binding.runId || !binding.museRunId || !/^[a-f0-9]{40}$/.test(binding.revision)
      || !binding.projectId || !binding.initiativeId || !binding.acceptanceUnit)
    throw Error('explicit issue/project/initiative/run/revision/acceptance-unit binding required');
  const matches = events.filter(e => e.payload?.run_stream?.id === binding.museRunId);
  const bySequence = new Map();
  for (const event of matches.filter(e => e.payload_type === 'run.usage')) {
    if (!Number.isSafeInteger(event.sequence)) throw Error('usage sequence missing');
    const key = `${event.stream?.kind}:${event.stream?.id}:${event.sequence}`;
    const previous = bySequence.get(key);
    if (previous && JSON.stringify(previous.payload) !== JSON.stringify(event.payload))
      throw Error('conflicting replayed usage record');
    bySequence.set(key, event);
  }
  // run.usage is cumulative. Keep the latest snapshot, never sum snapshots.
  const snapshots = [...bySequence.values()];
  if (new Set(snapshots.map(e => `${e.stream?.kind}:${e.stream?.id}`)).size > 1)
    throw Error('ambiguous usage streams');
  const last = snapshots.sort((a,b) => a.sequence-b.sequence).at(-1)?.payload;
  const configs = matches.filter(e => e.payload_type === 'run.model.configured').map(e=>e.payload);
  const terminals = matches.filter(e=>e.payload_type === 'run.terminal.completed');
  return {
    schema: 'awai.bot-run-receipt.v1', binding,
    provider: configs.length ? [...new Set(configs.map(c=>c.provider_id ?? 'unknown'))] : ['unknown'],
    configuredModels: configs.length ? [...new Set(configs.map(c=>c.model_id ?? 'unknown'))] : ['unknown'],
    terminal: terminals.at(-1)?.payload.terminal ?? 'unknown',
    telemetryCoverage: last ? 'selected-muse-run-final-cli-snapshot' : 'unknown',
    childrenIncluded: last?.children_included ?? 'unknown',
    models: (last?.models ?? []).map(m=>({model:m.model ?? 'unknown',
      inputTokens:m.input_tokens ?? 'unknown', cacheReadTokens:m.cache_read_tokens ?? 'unknown',
      cacheWriteTokens:m.cache_write_tokens ?? 'unknown', outputTokens:m.output_tokens ?? 'unknown',
      reasoningTokens:m.reasoning_tokens ?? 'unknown', rawCachedTokens:m.cached_tokens ?? 'unknown',
      counterDiscrepancies: Number.isFinite(m.reasoning_tokens) && Number.isFinite(m.output_tokens)
        && m.reasoning_tokens > m.output_tokens ? ['reasoning-exceeds-output'] : [],
      calls:m.calls ?? 'unknown'})),
    calls:last?.calls ?? 'unknown', completedCalls:last?.completed_calls ?? 'unknown',
    failedCalls:last?.failed_calls ?? 'unknown', cancelledCalls:last?.cancelled_calls ?? 'unknown',
    normalization:{reasoning:'output subset; do not add',
      cached:'raw provider counter; input relationship unverified; do not add',totalTokens:'unknown'},
    forecast:binding.forecast ?? {metric:'unknown',range:'unknown',basis:'uncalibrated',confidence:'unknown'},
    velocity:{value:'unknown',reason:'inference completion is not verified acceptance-unit completion'},
    unallocatedOverhead:'unknown',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [bindingPath, eventsPath, output] = process.argv.slice(2);
  if (!output) throw Error('usage: node receipt.mjs BINDING.json MUSE_EVENTS.jsonl NEW_RECEIPT.json');
  const binding = JSON.parse(await readFile(bindingPath,'utf8'));
  const events = (await readFile(eventsPath,'utf8')).split('\n').filter(x=>x.trim()).map(x=>JSON.parse(x));
  await writeFile(output, JSON.stringify(receipt(binding,events),null,2)+'\n',{flag:'wx'});
}
