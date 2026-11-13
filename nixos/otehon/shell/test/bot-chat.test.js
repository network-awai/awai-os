import {test} from 'node:test';import assert from 'node:assert/strict';import {chatRequest,sendChat,readChat,CHAT_MODEL} from '../src/bot-chat.js';
const bot={id:'profile:sample'},id='10000000-0000-4000-8000-000000000000';
test('browser submits one message and Bot identity, never an authoritative client history',()=>{const r=chatRequest(bot,' hello ',id);assert.equal(r.text,'hello');assert.equal(r.history,undefined);assert.throws(()=>chatRequest({id:'../profile'},'hello',id));assert.throws(()=>chatRequest(bot,'',id));});
test('conversation response needs Agent storage readback and the pinned model',async()=>{
 const req=chatRequest(bot,'hello',id);let seen;
 const broker={invoke:async(selector,payload)=>{seen={selector,payload};return {ok:true,json:async()=>({requestId:id,botId:bot.id,provider:'meta',model:CHAT_MODEL,state:'completed',text:'reply',store:{owner:'itonami-agent',readback:true}})};}};
 assert.equal((await sendChat(req,broker)).text,'reply');assert.equal(seen.selector.operation,'send-message');assert.equal(JSON.parse(seen.payload.init.body).history,undefined);
 await assert.rejects(sendChat(req,{invoke:async()=>({ok:true,json:async()=>({requestId:id,botId:bot.id,provider:'meta',model:CHAT_MODEL,state:'completed',text:'reply',store:{owner:'browser',readback:true}})})}));
});
test('history uses a separate broker operation and cancellation never retries',async()=>{
 let calls=0;const broker={invoke:async(s)=>{calls++;assert.equal(s.operation,'read-history');throw Error('client operation was not approved');}};
 await assert.rejects(readChat(bot.id,null,broker));assert.equal(calls,1);
 const value=await readChat(bot.id,null,{invoke:async()=>({ok:true,json:async()=>({botId:bot.id,messages:[],store:{owner:'itonami-agent',readback:true}})})});assert.deepEqual(value.messages,[]);
});
