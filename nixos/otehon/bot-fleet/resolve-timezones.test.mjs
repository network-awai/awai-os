import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTimezones} from './resolve-timezones.mjs';
const decision = {id:'AWAI-2795-owner-timezone-20261112', timezone:'Asia/Tokyo'};
const row = {botId:'p:a',repository:'org/repo',commit:'pin',state:'verified',enabled:false,jobs:[
  {id:'cron',schedule:{kind:'cron',expr:'17 3 * * *'},timezone:null,sourceEnabled:false,paused:true,enabled:false},
  {id:'utc',schedule:{kind:'cron',expr:'4 * * * *'},timezone:'UTC',sourceEnabled:true,enabled:false},
  {id:'nested',schedule:{kind:'cron',expr:'9 2 * * *',timezone:'America/New_York'},timezone:null,enabled:false},
  {id:'interval',schedule:{kind:'interval',minutes:360},timezone:null,enabled:false}]};
const catalog = {schema:'awai.bot-fleet.v1',organization:{bots:[{id:'p:a',profile:{repository:'org/repo',commit:'pin'}}]}};
test('owner timezone changes only missing cron zones, never schedules or disabled states',()=>{
  const before=structuredClone(row), r=resolveTimezones(catalog,[row],decision);
  assert.deepEqual(row,before);
  assert.equal(r.schedules[0].jobs[0].timezone,'Asia/Tokyo');
  assert.equal(r.schedules[0].jobs[0].sourceTimezone,null);
  for(let i=0;i<row.jobs.length;i++) {
    assert.deepEqual(r.schedules[0].jobs[i].schedule,row.jobs[i].schedule);
    assert.equal(r.schedules[0].jobs[i].enabled,row.jobs[i].enabled);
    assert.equal(r.schedules[0].jobs[i].paused,row.jobs[i].paused);
  }
  assert.deepEqual(r.schedules[0].jobs.slice(1),row.jobs.slice(1));
  assert.deepEqual(r.counts,{resolvedCronTimezones:1,preservedCronTimezones:2,unchangedIntervals:1,profiles:1});
  assert.equal(r.originalJobsActivated,false);
  assert.deepEqual(resolveTimezones(r.catalog,r.schedules,decision).schedules,r.schedules);
});
test('invalid decision, pins, duplicate inventory and explicit invalid timezone are refused',()=>{
  assert.throws(()=>resolveTimezones(catalog,[row],{...decision,timezone:'UTC'}));
  assert.throws(()=>resolveTimezones(catalog,[{...row,commit:'changed'}],decision));
  assert.throws(()=>resolveTimezones(catalog,[row,row],decision));
  const invalid=structuredClone(row);invalid.jobs[1].timezone='Not/AZone';
  assert.throws(()=>resolveTimezones(catalog,[invalid],decision));
});
