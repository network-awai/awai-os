import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreJourneys,validateJourneyScore} from '../tests/journey-score.mjs';
import {observations} from './fixtures/journey-observations.mjs';
test('required journeys pass; physical paths keep null scores and separate coverage',()=>{
  const score=scoreJourneys(observations());assert.equal(validateJourneyScore(score),score);
  assert.equal(score.coverage.verified,4);assert.equal(score.coverage.total,11);
  assert(score.journeys.every(j=>j.score===100));assert(score.unverified.every(j=>j.score===null));
});
test('missing evidence, lost Esc, excessive steps and safety bypass block release',()=>{
  for(const mutate of [o=>delete o.gui,o=>o.gui.actionsVisible=false,o=>o.gui.escapeReturned=false,o=>o.gui.keys=9,
    o=>o.first.journeys.remote.approvalRequired=false,o=>o.first.journeys.remote.revoked=false,
    o=>o.second.journeys.updates.activationHeld=false,o=>o.second.savedConsent=false,
    o=>o.first.journeys.updates.decisions=NaN,o=>o.gui.accountNotClaimed=false]){
    const o=observations();mutate(o);assert.throws(()=>validateJourneyScore(scoreJourneys(o)),/quality gate/);
  }
});
test('cannot forge score, policy, coverage or evidence into a green result',()=>{
  for(const mutate of [r=>r.journeys[0].score=101,r=>r.policy={...r.policy,minimum:0},
    r=>r.unverified=[],r=>r.observations.gui.escapeReturned=false,r=>r.passed=false]){
    const r=scoreJourneys(observations());mutate(r);assert.throws(()=>validateJourneyScore(r),/quality gate/);
  }
});
