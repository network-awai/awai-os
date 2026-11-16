import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importFleet} from '../src/soshiki-fleet.js';
import {blankState} from '../src/soshiki.js';
const catalog = {schema: 'awai.bot-fleet.v1', 'registry-revision': 'a'.repeat(40), organization: {
  circles: [{id:'fleet',name:'Fleet',purpose:'Work','parent-id':null}],
  roles: [{id:'r',name:'Role',purpose:'Work','circle-id':'fleet',assignee:{name:'Bot'}}],
  bots: [{id:'b',name:'Bot',purpose:'Work','circle-ids':['fleet'],'role-ids':['r'],
    approval:'auto',profile:{repository:'cloud-itonami/a',commit:'a'.repeat(40),checksum:'sha256-tree:'+'b'.repeat(64)},
    runtime:{state:'running',grants:['shell']}}]}};
test('imports without granting authority; retry preserves existing work',()=>{
  const original={...blankState(),proposals:[{id:'local',title:'Keep'}]};
  const first=importFleet(original,catalog);
  assert.equal(first.state.bots[0].approval,'ask');
  assert.deepEqual(first.state.bots[0].fleet.runtime,{state:'not-started',grants:[],
    substrate:'itonami-distributed',adapter:'awai-node',authority:'per-occurrence'});
  assert.deepEqual(first.state.proposals,original.proposals);
  assert.deepEqual(importFleet(first.state,catalog),first);
  const changed=structuredClone(first.state); changed.bots[0].purpose='Local edit';
  assert.equal(importFleet(changed,catalog).error,'fleet-conflict');
  assert.equal(changed.bots[0].purpose,'Local edit');
});
test('rejects cycles, foreign references and mutable source pins',()=>{
  for(const mutate of [x=>x.organization.circles[0]['parent-id']='fleet',
    x=>x.organization.bots[0]['role-ids']=['foreign'],
    x=>x.organization.bots[0].profile.commit='main']){
    const bad=structuredClone(catalog);mutate(bad);assert.equal(importFleet(blankState(),bad).error,'bad-fleet');
  }
});
