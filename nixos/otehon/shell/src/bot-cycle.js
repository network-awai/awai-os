const minute = 60000;
function period(schedule) {
  if (schedule?.kind === 'interval' && Number.isFinite(schedule.minutes) && schedule.minutes > 0) return schedule.minutes * minute;
  const p = schedule?.kind === 'cron' ? schedule.expr?.trim().split(/\s+/) : [];
  if (p.length !== 5) return null;
  if (/^\d+$/.test(p[0]) && Number(p[0]) > 59) return null;
  if (/^\d+$/.test(p[1]) && Number(p[1]) > 23) return null;
  if (/^\d+$/.test(p[0]) && p.slice(1).join(' ') === '* * * *') return 60 * minute;
  if (/^\*\/\d+$/.test(p[0]) && p.slice(1).join(' ') === '* * * *') {
    const step = Number(p[0].slice(2)); return step > 0 && 60 % step === 0 ? step * minute : null;
  }
  if (/^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) && p.slice(2).join(' ') === '* * *') return 1440 * minute;
  if (/^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) && p[2] === '*' && p[3] === '*' && /^[0-6]$/.test(p[4])) return 7 * 1440 * minute;
  return null;
}
// The operational cycle follows the existing source contract. This does not
// create a schedule or claim a worker is executing. Animation time is cosmetic.
export function botCycle(bot, now, stale) {
  const jobs = [...(bot.jobs ?? [])].filter(j => j.configured && j.scope !== 'readiness')
    .sort((a, b) => (a.nextSlot ?? Infinity) - (b.nextSlot ?? Infinity));
  const job = jobs[0];
  const source = bot.sourceJobs?.find(s => s.id === job?.sourceJobId) ?? bot.sourceJobs?.[0];
  const periodMs = period(source?.schedule), nextSlot = Number.isFinite(job?.nextSlot) ? job.nextSlot : null;
  const phase = periodMs && nextSlot !== null ? Math.max(0, Math.min(1, (now - (nextSlot - periodMs)) / periodMs)) : null;
  return { periodMs, nextSlot, phase, sourceSchedule: source?.schedule?.display ?? source?.schedule?.expr ?? null,
    animated: Boolean(!stale && bot.configured && bot.state === 'waiting' && periodMs && nextSlot > now),
    cycleState: stale && bot.configured ? 'unobserved' : !bot.configured ? 'held' : !periodMs ? 'unknown-period' : nextSlot === null ? 'unknown-next-slot' : nextSlot <= now ? 'overdue' : 'scheduled' };
}
