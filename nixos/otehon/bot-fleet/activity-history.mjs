// Bounded public metadata only. First observation is a baseline, not a new execution.
export function attachActivityHistory(payload, previous) {
  const prior = previous?.schema === payload.schema && previous.catalogSha256 === payload.catalogSha256 ? previous : null;
  const instrumented = prior?.activityCoverage?.history === 'observer-metadata-since-instrumentation';
  const byId = new Map((prior?.bots ?? []).map(b => [b.id,b]));
  for(const bot of payload.bots) {
    const old = byId.get(bot.id), oldJobs = new Map((old?.jobs??[]).map(j=>[j.jobId,j]));
    const events = (old?.activityHistory??[]).map(e=>({...e}));
    for(const job of bot.jobs) {
      const run=job.lastRun, previousRun=oldJobs.get(job.jobId)?.lastRun;
      if(!run)continue;
      run.firstObservedAt = previousRun?.id === run.id ? previousRun.firstObservedAt??prior.observedAt : payload.observedAt;
      run.resultChangedAt = previousRun?.id === run.id ? previousRun.resultChangedAt??null : instrumented && previousRun && run.confirmed ? payload.observedAt : null;
      const existing=events.find(e=>e.runId===run.id && e.jobId===job.jobId);
      if(existing) Object.assign(existing,{confirmed:run.confirmed,provider:run.provider,model:run.model,artifactCid:run.artifactCid??null});
      else events.push({runId:run.id,jobId:job.jobId,
        observedAt:run.firstObservedAt,completedAt:run.completedAt??null,baseline:!instrumented || !previousRun,
        confirmed:run.confirmed,provider:run.provider,model:run.model,scope:job.scope,artifactCid:run.artifactCid??null});
    }
    bot.activityHistory=events.sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)).slice(0,12);
  }
  payload.activityCoverage={execution:'worker-heartbeat-only-when-present',history:'observer-metadata-since-instrumentation',resultTime:'first-observed-is-not-completion-time'};
  return payload;
}
