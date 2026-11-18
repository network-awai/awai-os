import {createHash} from 'node:crypto';
import {readFileSync, statSync} from 'node:fs';
import {dirname, isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export const tracePath = '/v1/bot-chat/traces';
const retain = 500;
const attr = (key, value) => ({key, value: {stringValue: value}});
const hash = (value, length) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
const nanos = ms => (BigInt(ms) * 1000000n).toString();
const batch = spans => ({resourceSpans: [{resource: {attributes: [attr('service.name', 'itonami-agent')]},
  scopeSpans: [{scope: {name: 'itonami-agent.conversation'}, spans}]}]});

export function openTelemetry(config, {fetchTrace = fetch, warn = () => console.error('Itonami Agent telemetry operation failed')} = {}) {
  if (!config) return null;
  if (!isAbsolute(config.database ?? '')) throw Error('telemetry requires an absolute database path');
  const directory = statSync(dirname(config.database));
  if (!directory.isDirectory() || (directory.mode & 0o077)) throw Error('telemetry database directory must be private');
  if (config.authorizationFile && !config.endpoint) throw Error('telemetry authorization requires endpoint');
  let endpoint;
  const headers = {'content-type': 'application/json', 'x-langfuse-ingestion-version': '4'};
  if (config.endpoint) {
    endpoint = new URL(config.endpoint);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if ((endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !endpoint.pathname.endsWith('/v1/traces')) throw Error('invalid OTLP HTTP traces endpoint');
    if (config.authorizationFile) {
      const tokenMode = statSync(config.authorizationFile);
      if (!tokenMode.isFile() || (tokenMode.mode & 0o077)) throw Error('OTLP authorization file must be private');
      const authorization = readFileSync(config.authorizationFile, 'utf8').trim();
      if (!/^(Basic|Bearer) [A-Za-z0-9+/_=.-]+$/.test(authorization)) throw Error('invalid OTLP authorization');
      headers.authorization = authorization;
    }
  }

  const db = new DatabaseSync(config.database, {timeout: 250});
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS spans (id TEXT PRIMARY KEY, finished INTEGER NOT NULL, span TEXT NOT NULL, sent INTEGER NOT NULL) STRICT');
  const insert = db.prepare('INSERT OR IGNORE INTO spans VALUES (?, ?, ?, ?)');
  const trim = db.prepare('DELETE FROM spans WHERE id IN (SELECT id FROM spans ORDER BY finished DESC, id DESC LIMIT -1 OFFSET ?)');
  const latest = db.prepare('SELECT span FROM spans ORDER BY finished DESC, id DESC LIMIT ?');
  const pending = db.prepare('SELECT id, span FROM spans WHERE sent = 0 ORDER BY finished, id LIMIT 32');
  const deliver = db.prepare('UPDATE spans SET sent = 1 WHERE id = ?');
  let sending = false;
  let timer;
  const flush = async () => {
    if (!endpoint || sending) return;
    sending = true;
    try {
      const rows = pending.all();
      if (!rows.length) return;
      const response = await fetchTrace(endpoint, {method: 'POST', headers, redirect: 'error',
        signal: AbortSignal.timeout(5000), body: JSON.stringify(batch(rows.map(row => JSON.parse(row.span))))});
      if (!response.ok || Number((await response.json()).partialSuccess?.rejectedSpans ?? 0) !== 0) throw Error('OTLP delivery refused');
      for (const {id} of rows) deliver.run(id);
    } catch {
      warn();
    } finally {
      sending = false;
    }
  };

  return {
    record({thread, requestId, started, ended, result, model}) {
      try {
        const traceId = hash(['itonami.conversation.turn', thread, requestId], 32);
        const sessionId = hash(['itonami.conversation.session', thread], 32);
        const fields = [attr('session.id', sessionId), attr('langfuse.session.id', sessionId),
          attr('gen_ai.operation.name', 'chat'), attr('langfuse.observation.type', 'generation'),
          attr('gen_ai.request.model', model), attr('gen_ai.provider.name', 'meta')];
        const usageModels = result?.usageCoverage === 'selected-run-final-cumulative-snapshot'
          && Array.isArray(result.usage?.models) ? result.usage.models.filter(row => row?.model === model) : [];
        for (const key of ['input', 'output']) {
          const value = usageModels.length === 1 ? usageModels[0][key + '_tokens'] : undefined;
          if (Number.isSafeInteger(value) && value >= 0) {
            fields.push({key: 'gen_ai.usage.' + key + '_tokens', value: {intValue: String(value)}});
          }
        }
        const span = {traceId, spanId: hash([traceId, 'inference'], 16), name: 'itonami-agent.turn', kind: 3,
          startTimeUnixNano: nanos(started), endTimeUnixNano: nanos(Math.max(started, ended)),
          status: {code: result ? 1 : 2}, attributes: fields};
        insert.run(traceId, ended, JSON.stringify(span), endpoint ? 0 : 1);
        trim.run(retain);
        void flush();
      } catch {
        warn();
      }
    },
    recent() { return batch(latest.all(100).map(row => JSON.parse(row.span))); },
    flush,
    start() {
      if (!endpoint || timer) return;
      timer = setInterval(() => void flush(), 10000);
      timer.unref();
      void flush();
    },
  };
}
