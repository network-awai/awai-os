// Immutable registration through the explicitly selected Awai FS mount.
// File readback is evidence of this hosted service only, not distributed recovery.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const [catalogPath, schedulesPath, directory] = process.argv.slice(2);
if (!directory) throw Error('usage: node persist.mjs CATALOG SCHEDULES NEW_DIRECTORY_ON_AWAI_FS');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const schedules = JSON.parse(await readFile(schedulesPath, 'utf8'));
if (catalog.schema !== 'awai.bot-fleet.v1') throw Error('invalid catalog');
const contract = catalog['execution-contract'];
if (contract?.kind !== 'itonami.distributed-execution.v1'
    || contract.substrate !== 'itonami-distributed' || contract.adapter !== 'awai-node'
    || contract.authority !== 'per-occurrence'
    || catalog.organization.bots.some(b => b.runtime?.substrate !== contract.substrate
      || b.runtime?.adapter !== contract.adapter || b.runtime?.authority !== contract.authority))
  throw Error('Itonami distributed execution contract required');
const byId = new Map(schedules.map(s => [s.botId, s]));
if (byId.size !== schedules.length || byId.size !== catalog.organization.bots.length)
  throw Error('schedule inventory mismatch');
for (const bot of catalog.organization.bots) {
  const source = byId.get(bot.id);
  if (!source || source.commit !== bot.profile.commit || source.repository !== bot.profile.repository)
    throw Error('schedule pin mismatch');
  bot.schedule = source;
}
const bytes = Buffer.from(JSON.stringify(catalog));
const sha256 = createHash('sha256').update(bytes).digest('hex');
await mkdir(directory); // Refuse an existing registration, including partial writes.
await writeFile(join(directory, 'catalog.json'), bytes, {flag: 'wx'});
await writeFile(join(directory, 'catalog.sha256'), sha256 + '\n', {flag: 'wx'});
const readback = await readFile(join(directory, 'catalog.json'));
if (!bytes.equals(readback)) throw Error('Awai FS readback mismatch; preserve directory for reconciliation');
console.log(JSON.stringify({directory, sha256, bytes: bytes.length,
  profiles: catalog.organization.bots.length, circles: catalog.organization.circles.length,
  runtimeStarted: 0, scope: 'hosted-filesystem-write-and-readback'}));
