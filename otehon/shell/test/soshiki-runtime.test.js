import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeView,validateObservation} from '../src/soshiki-runtime.js';
const revision='a'.repeat(40),at='2026-11-12T02:00:00Z';
const state={bots:[{id:'profile:a',name:'a',circleIds:['x'],fleet:{registryRevision:revision}}]};
const report={schema:'awai.bot-fleet-observation.v1',scope:'host-prerequisites-only',continuousMonitoring:false,
 registryRevision:revision,catalogSha256:'b'.repeat(64),observedAt:at,runs:[],
 nodes:[{node:'levi',status:'observed',tools:{bb:true,muse:true,itonami:true,'itonami-agent':false},unattributedProcessCount:10}]};
test('CLI availability and unallocated processes never become running bots',()=>{
 const v=runtimeView(state,report,Date.parse(at)+1000);
 assert.equal(v.status,'prerequisites-only');assert.equal(v.observedRunning,null);
 assert.equal(v.unknown,1);assert.equal(v.bots[0].state,'unobserved');assert.equal(v.ageSeconds,1);
});
test('future, other registry, unsupported runs and duplicate nodes fail closed',()=>{
 assert.equal(runtimeView(state,report,Date.parse(at)-1).status,'future-observation');
 assert.equal(runtimeView(state,{...report,registryRevision:'c'.repeat(40)},Date.parse(at)).status,'catalog-mismatch');
 assert.throws(()=>validateObservation({...report,runs:[{state:'running'}]}));
 assert.throws(()=>validateObservation({...report,nodes:[...report.nodes,...report.nodes]}));
 assert.equal(runtimeView(state,null).observedRunning,null);
});
test('circle filtering preserves unknown as unknown',()=>{
 const v=runtimeView(state,report,Date.parse(at),'other');
 assert.equal(v.selected,0);assert.equal(v.observedRunning,null);assert.equal(v.completed,null);
});
