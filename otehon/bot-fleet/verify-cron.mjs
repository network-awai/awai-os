// Otehon administration only. Download data, never execute profile code/prompts.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
const exec = promisify(execFile);
const [catalogPath, output] = process.argv.slice(2);
if (!output) throw Error('usage: node verify-cron.mjs CATALOG NEW_OUTPUT_DIRECTORY');
await mkdir(output); // Never overwrite an earlier evidence run.
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const results = new Array(catalog.organization.bots.length);
let next = 0;
async function worker() {
  while (next < results.length) {
    const index = next++, bot = catalog.organization.bots[index], pin = bot.profile;
    const source = pin.files.find(f => f.path === 'cron/jobs.json');
    const result = {botId: bot.id, repository: pin.repository, commit: pin.commit,
      state: 'no-source-cron', enabled: false, jobs: []};
    if (source) {
      try {
        if (!/^[\w.-]+\/[\w.-]+$/.test(pin.repository) || !/^[a-f0-9]{40}$/.test(pin.commit)
            || !/^[\w./-]+$/.test(pin.path) || pin.path.split('/').includes('..')) throw Error('invalid-pin');
        const {stdout} = await exec('gh', ['api', '-H', 'Accept: application/vnd.github.raw+json',
          `repos/${pin.repository}/contents/${pin.path}/cron/jobs.json?ref=${pin.commit}`],
          {encoding: 'buffer', timeout: 30000, maxBuffer: 2 * 1024 * 1024});
        const digest = createHash('sha256').update(stdout).digest('hex');
        if (digest !== source.sha256 || stdout.length !== source.bytes) throw Error('source-digest-mismatch');
        const document = JSON.parse(stdout.toString('utf8'));
        const jobs = Array.isArray(document) ? document : document.jobs;
        if (!Array.isArray(jobs)) throw Error('invalid-jobs');
        result.state = 'verified'; result.sha256 = digest;
        // Keep only scheduling/authority inventory; never copy prompts, historical
        // outputs, connector URLs, credentials or account payloads to the catalog.
        result.jobs = jobs.map(j => ({id: j.id, name: j.name, schedule: j.schedule,
          timezone: j.timezone ?? j.schedule?.timezone ?? null,
          sourceEnabled: j.enabled !== false,
          sourceState: j.state ?? null, paused: Boolean(j.paused_at || j.paused_reason),
          needsScript: Boolean(j.script || j.monitor_script || j.no_agent),
          needsProfileWork: Boolean(j.prompt), enabled: false,
          activation: 'owner-and-capability-binding-required'}));
      } catch (error) {
        result.state = 'verification-failed';
        // Do not retain HTTP stderr, which may contain private paths or payloads.
        result.reason = ['invalid-pin', 'source-digest-mismatch', 'invalid-jobs'].includes(error.message)
          ? error.message : 'source-unavailable-or-invalid';
      }
    }
    results[index] = result;
  }
}
await Promise.all(Array.from({length: 8}, worker));
await writeFile(join(output, 'schedules.json'), JSON.stringify(results, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(results.reduce((counts, row) => {
  counts[row.state] = (counts[row.state] ?? 0) + 1; return counts;
}, {})));
