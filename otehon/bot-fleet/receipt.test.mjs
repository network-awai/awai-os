import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receipt} from './receipt.mjs';
const binding={issueId:'AWAI-2795',runId:'job-run-1',museRunId:'m1',revision:'a'.repeat(40),
  projectId:'p',initiativeId:'i',acceptanceUnit:'one verified acceptance check'};
const usage=(sequence,input,run='m1')=>({sequence,stream:{kind:'exec.usage',id:'s'},payload_type:'run.usage',
  payload:{run_stream:{id:run},models:[{model:'model',input_tokens:input,output_tokens:5,cached_tokens:2,reasoning_tokens:3}],calls:1}});
test('deduplicates replay and cumulative snapshots; excludes unrelated runs',()=>{
  const r=receipt(binding,[usage(1,5),usage(2,10),usage(2,10),usage(3,999,'other')]);
  assert.equal(r.models[0].inputTokens,10);assert.equal(r.models[0].outputTokens,5);
  assert.equal(r.models[0].cacheReadTokens,'unknown');
  assert.equal(r.normalization.totalTokens,'unknown');assert.equal(r.velocity.value,'unknown');
});
test('refuses conflicting usage and absent attribution; missing is unknown',()=>{
  assert.throws(()=>receipt(binding,[usage(1,5),usage(1,6)]),/conflicting/);
  assert.throws(()=>receipt({...binding,issueId:null},[]),/binding required/);
  assert.equal(receipt(binding,[]).calls,'unknown');
  assert.equal(receipt(binding,[]).telemetryCoverage,'unknown');
});
test('preserves counter discrepancies and rejects incomparable streams',()=>{
  const a=usage(1,5);a.payload.models[0].reasoning_tokens=10;
  assert.deepEqual(receipt(binding,[a]).models[0].counterDiscrepancies,['reasoning-exceeds-output']);
  const b=usage(2,10);b.stream.id='different';assert.throws(()=>receipt(binding,[a,b]),/ambiguous/);
});
