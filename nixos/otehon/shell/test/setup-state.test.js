import test from 'node:test';import assert from 'node:assert/strict';
import {createSetupState} from '../src/setup-state.js';
const state=complete=>({schema:'awai.setup.state.v1',complete});
const storage=value=>({getItem:()=>value,setItem:()=>{throw Error('browser-store-must-not-be-used-for-native-commit')}});
test('completion waits for durable native ack and never writes WebStorage',async()=>{
 let finish;const gate=new Promise(r=>finish=r);let completed=false;
 const store=createSetupState({storage:storage(null),invoke:async(cmd,args)=>{assert.equal(cmd,'awai_setup_state');assert.deepEqual(args,{action:'complete'});await gate;return state(true)}});
 const call=store.complete().then(()=>completed=true);await Promise.resolve();assert.equal(completed,false);finish();await call;assert.equal(completed,true);
});
test('failed/unknown/false native acknowledgement cannot complete setup',async()=>{
 for(const invoke of [async()=>{throw Error('disk-full')},async()=>({schema:'unknown',complete:true}),async()=>state(false)])await assert.rejects(createSetupState({storage:storage(null),invoke}).complete());
});
test('existing completion migrates only by a successful native commit',async()=>{
 const actions=[];const store=createSetupState({storage:storage('done'),invoke:async(_,r)=>{actions.push(r.action);return state(r.action==='complete')}});assert.equal(await store.read(),true);assert.deepEqual(actions,['read','complete']);
});
test('native read failure never falls back to the old browser marker',async()=>{
 await assert.rejects(createSetupState({storage:storage('done'),invoke:async()=>{throw Error('invalid-record')}}).read());
});
