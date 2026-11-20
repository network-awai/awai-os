import {test} from 'node:test';import assert from 'node:assert/strict';
import {botActivity,verifiedExecution,activitySelection} from '../src/fleet-activity.js';
import {attachActivityHistory} from '../../bot-fleet/activity-history.mjs';
const now=Date.parse('2026-11-13T08:00:00Z');
const execution={schema:'awai.bot-execution-observation.v1',source:'worker-heartbeat',botId:'b',jobId:'j',runId:'r',phase:'running',node:'vm-a',startedAt:new Date(now-20000).toISOString(),heartbeatAt:new Date(now-1000).toISOString()};
const bot={id:'b',name:'B',configured:true,state:'waiting',jobs:[{jobId:'j',configured:true,state:'waiting',sourceObservedAt:new Date(now).toISOString(),lastRun:{id:'r',confirmed:true}}]};
test('scheduled waiting breathes without claiming execution; only matched fresh heartbeat rotates',()=>{
 assert.equal(botActivity(bot,now).motion,'breathe');assert.equal(botActivity(bot,now).executionCoverage,'unobserved');
 assert.equal(botActivity({...bot,jobs:[{...bot.jobs[0],execution}]},now).motion,'rotate');
 for(const e of [{...execution,botId:'other'},{...execution,heartbeatAt:new Date(now-45001).toISOString()},{...execution,heartbeatAt:new Date(now+1).toISOString()},{...execution,runId:''}])assert.equal(verifiedExecution(e,'b','j',now),null);
 assert.equal(botActivity({...bot,jobs:[{...bot.jobs[0],execution}]},now,true).motion,'still');
 assert.equal(botActivity({...bot,configured:false},now).motion,'still');assert.equal(botActivity(bot,now+180001).motion,'still');
});
test('first receipt is baseline, repeated observations do not pulse; changed confirmed run pulses once',()=>{
 const payload=()=>({schema:'awai.fleet-state.v1',catalogSha256:'a',observedAt:new Date(now).toISOString(),bots:[structuredClone(bot)]});
 const first=attachActivityHistory(payload(),null);assert.equal(first.bots[0].activityHistory[0].baseline,true);assert.equal(first.bots[0].jobs[0].lastRun.resultChangedAt,null);
 const same=attachActivityHistory(payload(),first);assert.equal(same.bots[0].activityHistory.length,1);assert.equal(botActivity(same.bots[0],now).motion,'breathe');
 const next=payload();next.bots[0].jobs[0].lastRun.id='r2';attachActivityHistory(next,same);
 assert.equal(next.bots[0].activityHistory.length,2);assert.equal(botActivity(next.bots[0],now).motion,'pulse');assert.equal(botActivity(next.bots[0],now+45000).motion,'breathe');
});
test('Circle selection includes each descendant once; Bot and missing selection are bounded',()=>{
 const nodes=[{id:'c',kind:'responsibility',label:'Circle',ancestorIds:[]},{id:'b',kind:'bot',label:'B',ancestorIds:['c']},{id:'other',kind:'bot',ancestorIds:[]}];
 const s=activitySelection(nodes,[bot,{...bot,id:'other'}],'c',now);assert.equal(s.total,1);assert.equal(s.summary.executionObserved,0);
 assert.equal(activitySelection(nodes,[bot],'b',now).total,1);assert.equal(activitySelection(nodes,[bot],'missing',now),null);
});
