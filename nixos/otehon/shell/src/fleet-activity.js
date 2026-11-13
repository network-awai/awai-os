// Read-only activity semantics. Schedules and loaded services do not prove execution.
export const ACTIVITY_STATES = ['running', 'recovering', 'attention', 'queued', 'updated', 'waiting', 'held', 'unknown'];
export const ACTIVITY_LABELS = {running:'実行中',recovering:'復旧処理中',attention:'要確認',queued:'実行待ち',updated:'結果更新',waiting:'定期待機',held:'未有効',unknown:'観測待ち'};
const age = (at, now) => { const t = typeof at === 'number' ? at : Date.parse(at); return Number.isFinite(t) && t <= now ? now - t : null; };
export function verifiedExecution(value, botId, jobId, now) {
  if(value?.schema !== 'awai.bot-execution-observation.v1' || value.botId !== botId || value.jobId !== jobId
    || !['running','recovering'].includes(value.phase) || typeof value.runId !== 'string' || !value.runId
    || typeof value.node !== 'string' || !value.node || value.source !== 'worker-heartbeat') return null;
  const elapsed = age(value.heartbeatAt, now), start = age(value.startedAt, now);
  if(elapsed === null || elapsed > 45000 || start === null || start < elapsed) return null;
  return {schema:value.schema,botId,jobId,phase:value.phase,runId:value.runId,node:value.node,source:value.source,heartbeatAt:value.heartbeatAt,startedAt:value.startedAt};
}
export function botActivity(bot, now, stale = false) {
  const jobs = bot.jobs ?? [];
  const fresh = jobs.filter(j => j.configured && age(j.sourceObservedAt,now) !== null && age(j.sourceObservedAt,now) <= 180000);
  let state = 'unknown';
  if(!bot.configured) state = 'held';
  else if(!stale && fresh.length) {
    const execution = fresh.map(j => verifiedExecution(j.execution,bot.id,j.jobId,now)).filter(Boolean);
    if(execution.some(e => e.phase === 'running')) state = 'running';
    else if(execution.some(e => e.phase === 'recovering')) state = 'recovering';
    else if(bot.state === 'attention' || fresh.some(j => ['running','recovering'].includes(j.state))) state = 'attention';
    else if(fresh.some(j => j.state === 'queued')) state = 'queued';
    else if(fresh.some(j => j.lastRun?.confirmed && age(j.lastRun.resultChangedAt,now) !== null && age(j.lastRun.resultChangedAt,now) < 45000)) state = 'updated';
    else if(bot.state === 'waiting') state = 'waiting';
  }
  return {state,label:ACTIVITY_LABELS[state],motion:({running:'rotate',recovering:'recover',attention:'alert',queued:'blink',updated:'pulse',waiting:'breathe'})[state] ?? 'still',
    executionCoverage: fresh.some(j => verifiedExecution(j.execution,bot.id,j.jobId,now)) ? 'observed' : 'unobserved',
    lastObservedAt: fresh.map(j => j.sourceObservedAt).sort().at(-1) ?? null};
}
export function activitySummary(bots, now, stale = false) {
  const counts = Object.fromEntries(ACTIVITY_STATES.map(s => [s,0]));
  let executionObserved = 0;
  for(const bot of bots) { const a=botActivity(bot,now,stale); counts[a.state]++; if(a.executionCoverage==='observed')executionObserved++; }
  const state = ACTIVITY_STATES.find(s => counts[s]) ?? 'unknown';
  return {state,label:ACTIVITY_LABELS[state],motion:({running:'rotate',recovering:'recover',attention:'alert',queued:'blink',updated:'pulse',waiting:'breathe'})[state] ?? 'still',counts,executionObserved};
}
export function activitySelection(nodes, bots, selectedId, now, stale = false) {
  const scope = nodes.find(n => n.id === selectedId);
  if(!scope) return null;
  const ids = new Set(nodes.filter(n => n.kind === 'bot' && (n.id === selectedId || n.ancestorIds.includes(selectedId))).map(n => n.id));
  const selected = bots.filter(b => ids.has(b.id));
  const agents = selected.map(bot => ({...bot,activity:botActivity(bot,now,stale)})).sort((a,b)=>ACTIVITY_STATES.indexOf(a.activity.state)-ACTIVITY_STATES.indexOf(b.activity.state)||a.name.localeCompare(b.name));
  return {id:scope.id,label:scope.label,kind:scope.kind,total:agents.length,summary:activitySummary(selected,now,stale),agents,
    events:agents.flatMap(b=>(b.activityHistory??[]).map(e=>({...e,botId:b.id,botName:b.name})))
      .sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)).slice(0,40)};
}
