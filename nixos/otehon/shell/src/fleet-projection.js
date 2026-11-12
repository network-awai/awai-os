// Public control-plane receipt projection. This module never grants capabilities.
export const FLEET_SCHEMA = 'awai.fleet-state.v1';
const id = s => typeof s === 'string' && /^[\w.-]+\/[\w.-]+$/.test(s);
const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const states = new Set(['queued','waiting','held','unknown','completed','already-completed']);
const closed = new Set(['Done','Canceled','Cancelled','Duplicate']);
export function scheduleHolds(bot, job) {
  const reasons=[];
  if(bot.linear?.state!=='bound')reasons.push('linear-unresolved');
  if(!bot.linear?.issues?.some(i=>!closed.has(i.status)))reasons.push('unfinished-issue-required');
  if(bot.schedule?.state!=='verified')reasons.push(bot.schedule?.state==='no-source-cron'?'no-source-schedule':'source-verification-required');
  if(!job)return reasons;
  if(job.sourceEnabled!==true||job.paused)reasons.push('source-disabled-or-paused');
  if(job.needsScript)reasons.push('script-executor-review-required');
  if(job.schedule?.kind==='cron')reasons.push('calendar-executor-required');
  if(job.schedule?.kind==='cron'&&!job.timezone)reasons.push('timezone-required');
  return reasons;
}
function normalized(report,mode,now) {
  const schema=mode==='readiness'?'awai.bot-readiness-observation.v1':'awai.original-job-observation.v1';
  const scope=mode==='readiness'?'public-readiness-only':'original-bounded-jobs';
  const at=Date.parse(report?.observedAt);
  if(report?.schema!==schema||report.scope!==scope||!Number.isFinite(at)||!Array.isArray(report.jobs)
     ||report.jobs.length>1000||typeof report.serviceLoaded!=='boolean')return {state:'invalid-or-missing',jobs:[]};
  const rows=report.jobs.map(j=>({botId:j.botId??j['catalog-bot-id'],jobId:j.jobId??j['job-id'],state:j.state,
    nextSlot:j.nextSlot??j['next-slot']??null,run:mode==='readiness'?j.lastRun:(j['last-result']??j),health:j['vm-health']??null,mode}));
  if(rows.some(j=>!j.botId||!j.jobId||!states.has(j.state))
    ||new Set(rows.map(j=>`${j.botId}/${j.jobId}`)).size!==rows.length)return {state:'invalid-or-missing',jobs:[]};
  const fresh=at<=now&&now-at<=180000;
  return {state:!fresh?(at>now?'future':'stale'):report.serviceLoaded?'fresh':'service-unloaded',
    observedAt:report.observedAt,ageSeconds:at<=now?Math.floor((now-at)/1000):null,
    jobs:rows,fresh:fresh&&report.serviceLoaded};
}
export function projectFleet(catalog,reports,bindings,now=Date.now(),catalogSha256,connections,physicsPlan) {
  if(catalog?.schema!=='awai.bot-fleet.v1'||!hash(catalogSha256)||!/^[a-f0-9]{40}$/.test(catalog['registry-revision'])
    ||!Array.isArray(catalog.organization?.bots)||catalog.organization.bots.length>10000
    ||!Array.isArray(bindings)||new Set(catalog.organization.bots.map(b=>b.id)).size!==catalog.organization.bots.length)
    throw Error('invalid-projection-input');
  const sources={readiness:normalized(reports.readiness,'readiness',now),original:normalized(reports.original,'original',now),adapted:normalized(reports.adapted,'adapted',now),physics:normalized(reports.physics,'adapted',now),material:normalized(reports.material,'adapted',now),vm:normalized(reports.vm,'adapted',now)};
  const keys=bindings.map(b=>`${b.mode}/${b.botId}/${b.jobId}`);
  if(new Set(keys).size!==keys.length)throw Error('duplicate-approved-binding');
  const bots=catalog.organization.bots.map(bot=>{
    const bound=bindings.filter(b=>b.botId===bot.id);
    const jobs=bound.map(b=>{
      const source=sources[b.reportSource??b.mode];
      const matches=bot.linear?.state==='bound'&&b.projectId===bot.linear.project?.uuid
        &&b.profileCommit===bot.profile.commit&&b.profileChecksum===bot.profile.checksum
        &&bot.linear.issues.some(i=>i.id===b.issueId)&&bot.schedule.jobs?.some(j=>j.id===b.sourceJobId);
      const row=matches?source?.jobs.find(j=>j.botId===bot.id&&j.jobId===b.jobId):null;
      const run=row?.run;
      const complete=b.mode==='readiness'?run?.state==='completed':['completed','already-completed'].includes(run?.state);
      const confirmed=complete&&(b.mode==='readiness'?run?.linearResultConfirmed===true:
        run?.['linear-result-confirmed']===true&&run?.artifact?.readback===true);
      const runId=b.mode==='readiness'?run?.runId:run?.['run-id'];
      const modelMatch=run?.provider===b.provider&&run?.model===b.model;
      const health=row?.health;
      const currentReplicas=source?.fresh&&Array.isArray(health)&&health.length===2
        &&new Set(health.map(r=>r.node)).size===2&&health.every(r=>['vm-levi','vm-benjamin'].includes(r.node)&&typeof r.readback==='boolean')
        ?health.filter(r=>r.readback).length:null;
      return {jobId:b.jobId,sourceJobId:b.sourceJobId,scope:b.mode,adaptation:b.adaptation??null,
        issueId:b.issueId,projectId:b.projectId,configured:matches,
        state:!matches?'binding-mismatch':!source?.fresh?(source?.state??'unobserved'):
          run?.['domain-result']?.status==='unobserved'?'unobserved-result':row?.state??'unobserved',
        lastRun:runId?{id:runId,confirmed:!!(confirmed&&modelMatch),provider:run.provider,model:run.model,
          inputTokens:b.mode==='readiness'?run.inputTokens??null:null,outputTokens:b.mode==='readiness'?run.outputTokens??null:null,
          tokenMetric:b.mode==='readiness'?'provider-input-output':'not-applicable',
          artifactCid:b.mode!=='readiness'?run.artifact?.cid??null:null,
          measurement:run['domain-result']?.schema==='itonami.otehon.physics-measurement.v1'?{
            status:run['domain-result'].status,scope:run['domain-result'].scope,
            count:run['domain-result']['probe-summary']?.count??null,expected:run['domain-result']['probe-summary']?.expected??null,
            nativeTests:run['domain-result']['native-tests'],actuation:run['domain-result'].actuation,
            compute:run['domain-result'].compute??null,computeNode:run['domain-result']['execution-node']??null,
            replicaNode:run['domain-result']['replica-node']??null,replicas:run['domain-result'].replicas??null}:null}:null,
        nextSlot:row?.nextSlot??null,owner:b.owner,capabilities:b.capabilities,grantCid:b.grantCid??null,service:b.service??null,calendarCompiled:b.calendarCompiled===true,
        currentReplicas,sourceObservedAt:source?.observedAt??null};
    });
    const active=jobs.some(j=>j.configured);
    const sourceJobs=(bot.schedule?.jobs??[]).map(j=>{
      const running=jobs.find(r=>r.configured&&r.scope==='original'&&r.sourceJobId===j.id);
      const adapted=jobs.find(r=>r.configured&&r.scope==='adapted'&&r.sourceJobId===j.id);
      return {id:j.id,name:j.name,schedule:j.schedule,timezone:j.timezone??null,
        enabled:!!running,adaptedJobId:adapted?.jobId??null,
        holds:running?[]:[...scheduleHolds(bot,j).filter(reason=>reason!=='calendar-executor-required'||!adapted?.calendarCompiled),'scoped-executor-and-grant-required']};
    });
    const holds=[...new Set(sourceJobs.length?sourceJobs.flatMap(j=>j.holds):scheduleHolds(bot,null))];
    const repo=bot.linear?.repository??bot.profile?.repository;
    if(!id(repo))throw Error('invalid-repository');
    const connected=jobs.filter(j=>j.configured&&j.scope!=='readiness');
    const original=connected.filter(j=>j.scope==='original');
    const proposed=physicsPlan?.rows?.find(r=>r.botId===bot.id);
    const rollout=proposed?{state:proposed.sourceProfile?.commit===bot.profile.commit?proposed.state:'pin-mismatch',reason:proposed.reason??null}:null;
    const repository=(connections?.repositories??[]).find(r=>(r.requestedRepository??r.repository)===repo);
    const repositoryAge=now-Date.parse(repository?.observedAt);
    const repositoryState=!repository?'unobserved':!Number.isFinite(repositoryAge)||repositoryAge<0||repositoryAge>21600000?'stale':
      repository.disabled?'disabled':repository.archived?'archived':repository.private?'available-private':'available-public';
    return {id:bot.id,name:bot.name,repository:repo,sourceRepository:bot.profile.repository,circleIds:bot['circle-ids'],
      app:{id:`repo:${repo}`,kind:'repository-workspace',serviceConnected:connected.some(j=>j.service),
        service:connected.find(j=>j.service)?.service??null,
        repositoryConnection:{state:repositoryState,observedAt:repository?.observedAt??null,botGrant:false},
        contractState:connected.some(j=>j.service)?'bounded-operator-connection':bot.name==='mail-relay'?'mail-account-required':'service-contract-required'},
      linear:{state:bot.linear?.state,project:bot.linear?.project?.name??null,projectId:bot.linear?.project?.uuid??null,
        initiativeId:bot.linear?.initiative?.id??null,issues:(bot.linear?.issues??[]).map(i=>i.id)},
      configured:active,state:!active?'held':jobs.some(j=>!['queued','waiting','completed','already-completed'].includes(j.state))?'attention':jobs.some(j=>j.state==='queued')?'queued':'waiting',
      originalJobsConfigured:original.length,adaptedJobsConfigured:connected.length-original.length,physicsRollout:rollout,jobs,sourceJobs,holds};
  });
  const count=fn=>bots.filter(fn).length;
  return {schema:FLEET_SCHEMA,observedAt:new Date(now).toISOString(),catalogSha256,registryRevision:catalog['registry-revision'],
    authority:'display-only-operator-receipts',sources:Object.fromEntries(Object.entries(sources).map(([k,{jobs,...v}])=>[k,v])),
    totals:{registered:bots.length,configured:count(b=>b.configured),held:count(b=>!b.configured),
      attention:count(b=>b.state==='attention'),queued:count(b=>b.state==='queued'),jobsConfigured:bots.flatMap(b=>b.jobs).filter(j=>j.configured).length,
      originalJobsConfigured:bots.reduce((n,b)=>n+b.originalJobsConfigured,0),
      adaptedJobsConfigured:bots.reduce((n,b)=>n+b.adaptedJobsConfigured,0),
      vmJobsConfigured:bots.flatMap(b=>b.jobs).filter(j=>j.configured&&j.service?.startsWith('awai.network-vm:')).length,
      vmReplicasHealthy:bots.flatMap(b=>b.jobs).filter(j=>j.configured&&j.currentReplicas===2).length,
      confirmedRuns:bots.flatMap(b=>b.jobs).filter(j=>j.lastRun?.confirmed).length,
      sourceJobs:bots.reduce((n,b)=>n+b.sourceJobs.length,0),linearBound:count(b=>b.linear.state==='bound'),
      circles:catalog.organization.circles.length,repositoryCircles:catalog.organization.circles.filter(c=>c.id.startsWith('repo:')).length},bots};
}
export function validateFleet(value) {
  if(value?.schema!==FLEET_SCHEMA||value.authority!=='display-only-operator-receipts'||!hash(value.catalogSha256)
    ||!Number.isFinite(Date.parse(value.observedAt))||!Array.isArray(value.bots)||value.bots.length>10000
    ||value.totals?.registered!==value.bots.length||new Set(value.bots.map(b=>b.id)).size!==value.bots.length
    ||value.bots.some(b=>typeof b.name!=='string'||!id(b.repository)||!Array.isArray(b.jobs)||!Array.isArray(b.sourceJobs)
      ||!['queued','held','attention','waiting'].includes(b.state)))throw Error('invalid-fleet-state');
  return value;
}
export async function decodeFleetEnvelope(envelope,crypto) {
  if(envelope?.schema!=='awai.fleet-artifact.v1'||!hash(envelope.sha256))throw Error('invalid-fleet-artifact');
  const bytes=new TextEncoder().encode(JSON.stringify(envelope.payload));
  const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(actual!==envelope.sha256)throw Error('fleet-artifact-digest-mismatch');
  return validateFleet(envelope.payload);
}
