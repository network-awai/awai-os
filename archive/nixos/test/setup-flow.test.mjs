import test from 'node:test';
import assert from 'node:assert/strict';
import {runSetup,registerWithUI} from '../registration-ui.mjs';
const t=(_ja,en)=>en;
async function guide(actions,{readSaved=async()=>null,network=async()=> 'connected',register=async()=>null,poweroff=async()=>true}={}) {
  const screens=[],events=[];let firstChoice=true;
  await runSetup({t,readSaved,
    ui:{busy:()=>{},menu:(message,items)=>{
      if(message.startsWith('Choose how to use')&&firstChoice){firstChoice=false;return 'connect';}
      screens.push(message);const action=actions.shift();assert.notEqual(action,undefined,'unexpected screen');
      if(action!==null)assert.ok(items.some(([key])=>key===action),`missing action ${action}`);return action;
    }},
    network:async options=>{events.push('network');return network(options);},
    register:async fail=>{events.push('register');return register(fail);},
    poweroff:async()=>{events.push('shutdown');return poweroff();}});
  assert.equal(actions.length,0);return {screens,events};
}
test('service unavailable offers retry directly, then defer without background claims',async()=>{
  const {screens,events}=await guide(['retry','later',null,'shutdown'],{register:async fail=>fail({code:'service'})});
  assert.deepEqual(events,['network','register','register','shutdown']);
  assert.match(screens[0],/OS: installed/);assert.match(screens[0],/service is unavailable/);
  assert.match(screens[2],/registration pending/);
});
test('offline install finishes on a page, connect resumes phone approval and shows owner',async()=>{
  let count=0;
  const {screens,events}=await guide(['connect','shutdown'],{
    network:async()=>++count===1?'offline':'connected',
    register:async()=>({accountDid:'did:key:owner',deviceDid:'did:key:node'})});
  assert.deepEqual(events,['network','network','register','shutdown']);
  assert.match(screens[0],/registration pending/);assert.match(screens[1],/verified during this boot/);
  assert.match(screens[1],/did:key:owner/);
});
test('phone cancellation returns to mode choice without silently retrying or claiming completion',async()=>{
  const {events,screens}=await guide(['shutdown']);assert.deepEqual(events,['network','register','shutdown']);assert.match(screens[0],/^Choose how to use/);
});
test('network back returns to mode choice without registration or claiming completion',async()=>{
  const {events,screens}=await guide(['shutdown'],{network:async()=> 'back',register:()=>assert.fail('unexpected registration')});
  assert.deepEqual(events,['network','shutdown']);assert.match(screens[0],/^Choose how to use/);
});
test('expired approval closes QR before showing retry options',async()=>{
  const order=[];
  await guide(['retry','shutdown'],{register:async fail=>registerWithUI({t,onFailure:fail,ui:{message:()=>assert.fail()},
    screen:async()=>async()=>order.push('close'),link:async({onFlow})=>{await onFlow({});throw Object.assign(Error(),{code:'expired'});}})});
  assert.deepEqual(order,['close','close']);
});
test('unreadable saved receipt blocks claims but still allows network settings and shutdown',async()=>{
  const {screens,events}=await guide(['network','shutdown'],{readSaved:async()=>{throw Error();},register:()=>assert.fail()});
  assert.deepEqual(events,['network','shutdown']);assert.match(screens[0],/registration information is preserved/);
});
test('network and unexpected registration errors stay in the guide; shutdown failure can retry',async()=>{
  let shutdowns=0,networks=0;
  const {screens}=await guide(['connect','retry','shutdown','shutdown'],{
    network:async()=>{if(!networks++)throw Error();return 'connected';},
    register:async()=>{throw Error('invalid registration flow');},
    poweroff:async()=>++shutdowns>1});
  assert.match(screens[0],/Could not check the network/);
  assert.match(screens[1],/Reinstallation is not needed/);
  assert.match(screens[3],/Could not shut down/);
});
test('Node details returns to setup without claiming an account or touching network',async()=>{let details=0;const actions=['status','network','status','shutdown'];await runSetup({t,readSaved:async()=>null,ui:{menu:(_,items)=>{const action=actions.shift();assert.ok(items.some(([id])=>id===action));return action;}},showStatus:async()=>{details++;},network:async()=> 'offline',register:async()=>assert.fail('status must not register'),poweroff:async()=>true});assert.equal(details,2);assert.equal(actions.length,0);});
test('updates is available before and after local completion without registering',async()=>{let opened=0;const actions=['updates','local','updates','shutdown'];await runSetup({t,readSaved:async()=>null,readLocal:async()=>null,completeLocal:async()=>({deviceDid:'did:key:local'}),showUpdates:async()=>{opened++;},ui:{menu:(_,items)=>{const a=actions.shift();assert.ok(items.some(([id])=>id===a));return a;}},network:async()=>assert.fail('updates must not alter network'),register:async()=>assert.fail('updates must not register'),poweroff:async()=>true});assert.equal(opened,2);assert.equal(actions.length,0);});

test('legacy evidence offers explicit relinking without an automatic claim on boot',async()=>{
  const {screens,events}=await guide(['connect','shutdown'],{readSaved:async()=>{throw Object.assign(Error(),{code:'legacy-proof-required'});},register:async()=>({accountDid:'did:pkh:eip155:8453:0x'+'1'.repeat(40),deviceDid:'did:key:node'})});
  assert.match(screens[0],/fresh user signature/);assert.deepEqual(events,['network','register','shutdown']);assert.doesNotMatch(screens[1],/Previous registration/);
});
test('legacy notice can be deferred without any registration call',async()=>{
  const {events}=await guide(['shutdown'],{readSaved:async()=>{throw Object.assign(Error(),{code:'legacy-proof-required'});},register:()=>assert.fail()});
  assert.deepEqual(events,['shutdown']);
});
