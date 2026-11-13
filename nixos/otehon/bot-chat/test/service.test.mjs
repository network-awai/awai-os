import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {handler} from '../service.mjs';import {database} from '../database.mjs';
const origin='http://127.0.0.1:8906',owner='synthetic-owner@example.invalid',model='muse-spark-1.3';
const databaseRoot=path.resolve(process.env.CHAT_TEST_ROOT??'.agent-output',`chat-service-${randomUUID()}`);await fs.mkdir(databaseRoot,{recursive:true,mode:0o700});
const cfg={origins:[origin],ownerLogin:owner,model,bb:process.env.BB_BIN??'bb',databaseRoot};
const bot={id:'profile:synthetic',name:'synthetic',chatPersona:{available:true}};
async function serve(execute){const server=http.createServer(handler(cfg,{loadBots:async()=>[bot],execute}));await new Promise(r=>server.listen(0,'127.0.0.1',r));return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};}
const post=(s,p,body,headers={})=>fetch(s.url+p,{method:'POST',headers:{origin,'tailscale-user-login':owner,'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('identity, registered Bot, request idempotency and real database recovery precede inference',async()=>{
 let calls=0;const s=await serve(async()=>{calls++;return {provider:'meta',model,text:'Synthetic response (test executor only)',runId:'synthetic-run'};});
 const req={schema:'awai.bot-chat-request.v1',requestId:randomUUID(),botId:bot.id,model,text:'Synthetic persistence test'};
 try{
  assert.equal((await post(s,'/v1/bot-chat/turn',req,{'tailscale-user-login':'other'})).status,403);assert.equal((await post(s,'/v1/bot-chat/turn',req,{origin:'https://untrusted.invalid'})).status,403);assert.equal(calls,0);
  const r=await post(s,'/v1/bot-chat/turn',req);assert.equal(r.status,200);const result=await r.json();assert.equal(result.store.readback,true);assert.equal(result.store.engine,'kotobase-peer');
  assert.equal((await post(s,'/v1/bot-chat/turn',req)).status,200);assert.equal(calls,1);
  const history=await(await post(s,'/v1/bot-chat/history',{botId:bot.id})).json();assert.equal(history.messages.length,2);assert.equal(history.messages[1].text,result.text);
  assert.equal((await post(s,'/v1/bot-chat/turn',{...req,text:'changed'})).status,409);
 }finally{await s.close();}
 const restarted=await serve(async()=>{throw Error('must not reinvoke completed request');});try{assert.equal((await post(restarted,'/v1/bot-chat/turn',req)).status,200);}finally{await restarted.close();}
});
test('an uncertain inference retains its accepted message and never redispatches on retry',async()=>{
 let calls=0;const s=await serve(async()=>{calls++;throw Error('synthetic uncertain outcome');});const req={schema:'awai.bot-chat-request.v1',requestId:randomUUID(),botId:bot.id,model,text:'Synthetic uncertain request'};
 try{assert.equal((await post(s,'/v1/bot-chat/turn',req)).status,503);assert.equal((await post(s,'/v1/bot-chat/turn',req)).status,409);assert.equal(calls,1);const h=await(await post(s,'/v1/bot-chat/history',{botId:bot.id})).json();assert.ok(h.messages.some(m=>m.id===req.requestId));}finally{await s.close();}
});
test('named sessions share the Agent contract and isolate history without starting inference',async()=>{
 let calls=0;const s=await serve(async()=>{calls++;return {provider:'meta',model,text:'Synthetic named-session response',runId:'synthetic-named'};});
 const a=randomUUID(),b=randomUUID();try{
  for(const sessionId of [a,b])assert.equal((await post(s,'/v1/bot-chat/sessions',{botId:bot.id,action:'create',sessionId,title:'Synthetic session'})).status,201);
  assert.equal(calls,0);
  const req={schema:'awai.bot-chat-request.v1',requestId:randomUUID(),botId:bot.id,model,text:'Synthetic scoped request',sessionId:a};
  assert.equal((await post(s,'/v1/bot-chat/turn',req)).status,200);
  assert.equal((await(await post(s,'/v1/bot-chat/history',{botId:bot.id,sessionId:a})).json()).messages.length,2);
  assert.equal((await(await post(s,'/v1/bot-chat/history',{botId:bot.id,sessionId:b})).json()).messages.length,0);
  assert.equal((await post(s,'/v1/bot-chat/turn',{...req,requestId:randomUUID(),text:'Second synthetic message'})).status,200);
  assert.equal((await post(s,'/v1/bot-chat/turn',req)).status,200);assert.equal(calls,2);
  const list=await(await post(s,'/v1/bot-chat/sessions',{botId:bot.id,action:'list'})).json();assert.equal(list.sessions.find(x=>x.sessionId===a).messageCount,4);assert.ok(list.sessions.every(x=>x.text===undefined));
  assert.equal((await post(s,'/v1/bot-chat/history',{botId:bot.id,sessionId:randomUUID()})).status,404);
 }finally{await s.close();}
});
