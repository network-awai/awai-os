import {test} from 'node:test';
import assert from 'node:assert/strict';
import {showUpdates} from '../update-ui.mjs';
const t=(_j,e)=>e;
test('timer start failure never reports successful periodic checks',async()=>{
 const actions=['enable','enable','back'],messages=[],calls=[];
 await showUpdates({menu:()=>actions.shift(),message:s=>messages.push(s)},t,{enable:()=>calls.push('save'),summary:()=>({configured:false,text:''}),run:(name,args)=>{calls.push([name,args]);return {status:1};}});
 assert.match(messages[0],/could not start/);assert.doesNotMatch(messages[0],/checks enabled/);
 assert.deepEqual(calls,['save',['systemctl',['start','aiueos-update.timer']]]);
});
test('saved consent can resume a failed timer without resetting history',async()=>{
 const actions=['resume','back'],messages=[];let called=0;
 await showUpdates({menu:()=>actions.shift(),message:s=>messages.push(s)},t,{enable:()=>assert.fail('must preserve configuration'),summary:()=>({configured:true,text:''}),run:(_name,args)=>{assert.deepEqual(args,['start','aiueos-update.timer']);called++;return {status:0};}});
 assert.equal(called,1);assert.match(messages[0],/resumed/);
});
