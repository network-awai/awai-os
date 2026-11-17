import test from 'node:test';
import assert from 'node:assert/strict';
import {registerWithUI,registrationFailure} from '../registration-ui.mjs';
const t=(_ja,en)=>en;
test('phone approval closes QR before returning the bound account',async()=>{
  const events=[],receipt={accountDid:'did:key:approved'};
  const result=await registerWithUI({t,ui:{message:()=>assert.fail()},screen:async()=>{events.push('qr');return async()=>events.push('closed');},link:async({onFlow})=>{await onFlow({});events.push('approved');return receipt;}});
  assert.equal(result,receipt);assert.deepEqual(events,['qr','approved','closed']);
});
test('defer aborts poll and leaves no completion message',async()=>{
  const events=[];
  const result=await registerWithUI({t,ui:{message:()=>assert.fail()},screen:async(_flow,controller)=>{controller.abort(new DOMException('Deferred','AbortError'));return async()=>events.push('closed');},link:async({onFlow,signal})=>{await onFlow({});signal.throwIfAborted();assert.fail();}});
  assert.equal(result,null);assert.deepEqual(events,['closed']);
});
test('expiry closes QR before actionable error; service failure needs no QR',async()=>{
  const events=[];
  await registerWithUI({t,ui:{message:m=>events.push(m)},screen:async()=>async()=>events.push('closed'),link:async({onFlow})=>{await onFlow({});throw Object.assign(Error(),{code:'expired'});}});
  assert.equal(events[0],'closed');assert.match(events[1],/new QR/);
  assert.match(registrationFailure({code:'service'},t),/service is unavailable/);
  assert.match(registrationFailure({code:'revoked'},t),/revoked/);
});
