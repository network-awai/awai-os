// Otehon operator configuration: owner-selected timezone is not activation.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const missing = value => value == null || (typeof value === 'string' && !value.trim());
function checkZone(value) {
  if (typeof value !== 'string' || !value.trim()) throw Error('invalid-timezone');
  try { new Intl.DateTimeFormat('en', {timeZone: value}).format(0); }
  catch { throw Error('invalid-timezone'); }
}
export function resolveTimezones(catalog, schedules, decision) {
  if (catalog.schema !== 'awai.bot-fleet.v1' || !Array.isArray(schedules)
      || decision.id !== 'AWAI-2795-owner-timezone-20261112'
      || decision.timezone !== 'Asia/Tokyo') throw Error('explicit-owner-decision-required');
  checkZone(decision.timezone);
  const next = structuredClone(schedules);
  const byId = new Map(next.map(row => [row.botId, row]));
  if (byId.size !== next.length || byId.size !== catalog.organization.bots.length)
    throw Error('schedule-inventory-mismatch');
  let resolved = 0, preserved = 0, intervals = 0;
  for (const row of next) {
    if (!Array.isArray(row.jobs)) throw Error('invalid-jobs');
    for (const job of row.jobs) {
      if (job.schedule?.kind === 'interval') { intervals++; continue; }
      if (job.schedule?.kind !== 'cron') continue;
      const zone = missing(job.timezone) ? job.schedule.timezone : job.timezone;
      if (!missing(zone)) { checkZone(zone); preserved++; continue; }
      job.sourceTimezone = job.timezone ?? null;
      job.timezone = decision.timezone;
      job.timezoneSource = {kind: 'explicit-owner-decision', id: decision.id};
      resolved++;
    }
  }
  const output = structuredClone(catalog);
  for (const bot of output.organization.bots) {
    const row = byId.get(bot.id);
    if (!row || row.commit !== bot.profile.commit || row.repository !== bot.profile.repository)
      throw Error('schedule-pin-mismatch');
    bot.schedule = row;
  }
  output['schedule-timezone-decision'] = decision;
  return {catalog: output, schedules: next,
    counts: {resolvedCronTimezones: resolved, preservedCronTimezones: preserved,
      unchangedIntervals: intervals, profiles: next.length}, originalJobsActivated: false};
}
async function main() {
  const [catalogPath, schedulesPath, directory] = process.argv.slice(2);
  if (!directory) throw Error('usage: node resolve-timezones.mjs CATALOG SCHEDULES NEW_DIRECTORY');
  const [catalogBytes, scheduleBytes] = await Promise.all([readFile(catalogPath), readFile(schedulesPath)]);
  const decision = {id: 'AWAI-2795-owner-timezone-20261112', issue: 'AWAI-2795',
    timezone: 'Asia/Tokyo', appliesTo: 'missing-cron-timezone-only', ownerDecisionDate: '2026-11-12',
    recordedAt: new Date().toISOString(), sourceCatalogSha256: sha(catalogBytes), sourceSchedulesSha256: sha(scheduleBytes)};
  const result = resolveTimezones(JSON.parse(catalogBytes), JSON.parse(scheduleBytes), decision);
  const catalog = Buffer.from(JSON.stringify(result.catalog));
  const schedules = Buffer.from(JSON.stringify(result.schedules));
  const report = {schema: 'awai.bot-fleet-timezone-resolution.v1', decision,
    ...result.counts, originalJobsActivated: false, catalogSha256: sha(catalog), schedulesSha256: sha(schedules)};
  await mkdir(directory); // Keep previous exports/partial output intact.
  for (const [name, bytes] of [ ['catalog.json', catalog], ['schedules.json', schedules],
    ['catalog.sha256', sha(catalog) + '\n'], ['timezone-decision.json', JSON.stringify(report, null, 2) + '\n'] ])
    await writeFile(join(directory, name), bytes, {flag: 'wx'});
  console.log(JSON.stringify(report));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
