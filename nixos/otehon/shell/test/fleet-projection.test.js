import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto,createHash} from 'node:crypto';
import {projectFleet,decodeFleetEnvelope} from '../src/fleet-projection.js';
const now=Date.parse('2026-11-12T06:00:00Z'),sha='a'.repeat(64);
const bot={id:'profile:a',name:'a',profile:{repository:'org/app'},'circle-ids':['repo:org/app'],linear:{state:'bound',project:{uuid:'p'},issues:[{id:'AWAI-1',status:'Backlog'}]},schedule:{state:'verified',jobs:[{id:'source',sourceEnabled:true,schedule:{kind:'cron',cron:'0 9 * * *'},timezone:'Asia/Tokyo'}]}};
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
