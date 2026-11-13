import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto,createHash} from 'node:crypto';
import {projectFleet,decodeFleetEnvelope} from '../src/fleet-projection.js';
const now=Date.parse('2026-11-12T06:00:00Z'),sha='a'.repeat(64);
const bot={id:'profile:a',name:'a',profile:{repository:'org/app',commit:'c'.repeat(40),checksum:`sha256-tree:${sha}`},'circle-ids':['repo:org/app'],linear:{state:'bound',project:{uuid:'p'},issues:[{id:'AWAI-1',status:'Backlog'}]},schedule:{state:'verified',jobs:[{id:'source',sourceEnabled:true,schedule:{kind:'cron',cron:'0 9 * * *'},timezone:'Asia/Tokyo'}]}};
const catalog={schema:'awai.bot-fleet.v1','registry-revision':'b'.repeat(40),organization:{bots:[bot],circles:[{id:'fleet'},{id:'repo:org/app'}]}};
const bindings=[{botId:bot.id,jobId:'source-readiness',sourceJobId:'source',mode:'readiness',issueId:'AWAI-1',projectId:'p',profileCommit:bot.profile.commit,profileChecksum:bot.profile.checksum,provider:'meta',model:'m',capabilities:['inference_muse']}];
const reports={readiness:{schema:'awai.bot-readiness-observation.v1',scope:'public-readiness-only',observedAt:new Date(now).toISOString(),serviceLoaded:true,jobs:[{botId:bot.id,jobId:'source-readiness',state:'waiting',lastRun:{runId:'r',provider:'meta',model:'m',state:'completed',linearResultConfirmed:true}}]}};
test('readiness never grants original business effects or erases holds',()=>{const r=projectFleet(catalog,reports,bindings,now,sha);assert.equal(r.totals.configured,1);assert.equal(r.totals.originalJobsConfigured,0);assert.equal(r.totals.confirmedRuns,1);assert.equal(r.bots[0].app.serviceConnected,false);assert.ok(r.bots[0].holds.includes('calendar-executor-required'));});
test('stale, future, duplicates, missing and changed project do not become healthy',()=>{
 for(const at of [now-180001,now+1]){const r=projectFleet(catalog,{readiness:{...reports.readiness,observedAt:new Date(at).toISOString()}},bindings,now,sha);assert.equal(r.totals.attention,1);}
 assert.equal(projectFleet(catalog,{},bindings,now,sha).totals.attention,1);
 const duplicate={...reports.readiness,jobs:[...reports.readiness.jobs,...reports.readiness.jobs]};assert.equal(projectFleet(catalog,{readiness:duplicate},bindings,now,sha).sources.readiness.state,'invalid-or-missing');
 assert.equal(projectFleet(catalog,reports,[{...bindings[0],projectId:'other'}],now,sha).totals.configured,0);
 assert.throws(()=>projectFleet(catalog,reports,[...bindings,...bindings],now,sha));
});
test('artifact tampering is rejected before display',async()=>{const payload=projectFleet(catalog,reports,bindings,now,sha);const envelope={schema:'awai.fleet-artifact.v1',payload,sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};assert.equal((await decodeFleetEnvelope(envelope,webcrypto)).totals.registered,1);envelope.payload.totals.registered=999;await assert.rejects(decodeFleetEnvelope(envelope,webcrypto));});
test('operator repository visibility does not grant a bot; changed profile cannot inherit admission',()=>{
 const connections={repositories:[{repository:'org/app',private:true,archived:false,disabled:false,observedAt:new Date(now).toISOString()}]};
 const r=projectFleet(catalog,{},[],now,sha,connections);assert.equal(r.bots[0].app.repositoryConnection.state,'available-private');assert.equal(r.totals.configured,0);assert.equal(r.bots[0].app.repositoryConnection.botGrant,false);
 assert.equal(projectFleet(catalog,reports,[{...bindings[0],profileCommit:'d'.repeat(40)}],now,sha).totals.configured,0);
});
test('staged simulations stay queued until an actual bounded receipt arrives',()=>{
 const b={...bindings[0],mode:'adapted',reportSource:'physics',provider:'none',model:'deterministic',service:'Otehon pinned simulation'};
 const report={schema:'awai.original-job-observation.v1',scope:'original-bounded-jobs',observedAt:new Date(now).toISOString(),serviceLoaded:true,
  jobs:[{'catalog-bot-id':bot.id,'job-id':b.jobId,state:'queued'}]};
 const r=projectFleet(catalog,{physics:report},[b],now,sha);assert.equal(r.totals.queued,1);assert.equal(r.totals.confirmedRuns,0);assert.equal(r.totals.originalJobsConfigured,0);assert.equal(r.totals.adaptedJobsConfigured,1);
 report.jobs[0]={...report.jobs[0],state:'waiting','last-result':{state:'completed','run-id':'physical-one',provider:'none',model:'deterministic','linear-result-confirmed':true,artifact:{readback:true,cid:'cid'},'domain-result':{status:'unobserved'}}};
 assert.equal(projectFleet(catalog,{physics:report},[b],now,sha).totals.attention,1);
 const plan={rows:[{botId:bot.id,sourceProfile:{commit:bot.profile.commit},state:'eligible'}]};
 const qualified={...b,calendarCompiled:true};
 const admitted=projectFleet(catalog,{physics:report},[qualified],now,sha,undefined,plan);
 assert.equal(admitted.bots[0].physicsRollout.state,'eligible');
 assert.ok(!admitted.bots[0].holds.includes('calendar-executor-required'));
 assert.equal(projectFleet(catalog,{},[],now,sha,undefined,plan).totals.configured,0);
 plan.rows[0].sourceProfile.commit='e'.repeat(40);
 assert.equal(projectFleet(catalog,{},[],now,sha,undefined,plan).bots[0].physicsRollout.state,'pin-mismatch');
});
test('VM placement and current replica reads remain separate from historical completed receipts',()=>{
 const b={...bindings[0],mode:'adapted',reportSource:'vm',provider:'none',model:'deterministic',service:'awai.network-vm:enrolled'};
 const row={'catalog-bot-id':bot.id,'job-id':b.jobId,state:'waiting','vm-health':[{node:'vm-levi',readback:true},{node:'vm-benjamin',readback:true}],
  'last-result':{state:'completed','run-id':'vm-one',provider:'none',model:'deterministic','linear-result-confirmed':true,artifact:{readback:true},
    'domain-result':{schema:'itonami.otehon.physics-measurement.v1',status:'measured',compute:'awai-network-vm','execution-node':'vm-levi','replica-node':'vm-benjamin',replicas:2}}};
 const report={schema:'awai.original-job-observation.v1',scope:'original-bounded-jobs',observedAt:new Date(now).toISOString(),serviceLoaded:true,jobs:[row]};
 const good=projectFleet(catalog,{vm:report},[b],now,sha);assert.equal(good.totals.vmJobsConfigured,1);assert.equal(good.totals.vmReplicasHealthy,1);
 assert.equal(good.bots[0].jobs[0].lastRun.measurement.computeNode,'vm-levi');
 row['vm-health'][1].readback=false;assert.equal(projectFleet(catalog,{vm:report},[b],now,sha).totals.vmReplicasHealthy,0);
 report.observedAt=new Date(now-180001).toISOString();assert.equal(projectFleet(catalog,{vm:report},[b],now,sha).bots[0].jobs[0].currentReplicas,null);
 assert.equal(projectFleet(catalog,{vm:report},[],now,sha).totals.configured,0);
});
test('manifest audit is identified as a bounded nonphysics observation',()=>{
 const b={...bindings[0],mode:'adapted',reportSource:'manifest',provider:'none',model:'deterministic'};
 const report={schema:'awai.original-job-observation.v1',scope:'original-bounded-jobs',observedAt:new Date(now).toISOString(),serviceLoaded:true,jobs:[{'catalog-bot-id':bot.id,'job-id':b.jobId,state:'waiting','last-result':{state:'completed','run-id':'manifest-one',provider:'none',model:'deterministic','linear-result-confirmed':true,artifact:{readback:true},'domain-result':{kind:'fleet-manifest-drift',status:'measured',drift:false}}}]};
 const row=projectFleet(catalog,{manifest:report},[b],now,sha).bots[0].jobs[0];
 assert.equal(row.lastRun.manifestAudit.status,'measured');assert.equal(row.lastRun.manifestAudit.drift,false);assert.equal(row.lastRun.measurement,null);assert.equal(row.lastRun.tokenMetric,'not-applicable');
});
