import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {handler} from '../service.mjs';import {bbJSON,verifySources} from '../database.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
test('peer turns use canonical goal/session/speaker binding and stop after four real-store fixture replies',async()=>{
 await verifySources();const cycle=randomUUID(),model='muse-spark-1.3',snapshot='Synthetic public fleet snapshot. Not live evidence.';
 const grant={schema:'itonami.peer-cycle-grant.v1','cycle-id':cycle,'session-id':cycle,'cycle-source':'operator-one-cycle','issue-id':'AWAI-2862',provider:'meta',model,'max-turns':4,tools:[],goal:'Synthetic peer test',snapshot,'snapshot-sha':sha(snapshot),participants:[{'bot-id':'profile:a','profile-sha':'a'.repeat(64)},{'bot-id':'profile:b','profile-sha':'b'.repeat(64)}]};
 const root=path.resolve(process.env.CHAT_TEST_ROOT??'.agent-output','peer-fixture-'+randomUUID());await fs.mkdir(root,{recursive:true,mode:0o700});
 const cfg={origins:['http://127.0.0.1:8906'],allowCLI:true,ownerLogin:'synthetic-owner',model,bb:process.env.BB_BIN??'bb',databaseRoot:root,peerCycles:[grant]};
 let allowAdmission=false;const calls=[],bots=grant.participants.map(x=>({id:x['bot-id'],name:x['bot-id'],chatPersona:{available:true,sourceSha256:x['profile-sha']}}));
 const server=http.createServer(handler(cfg,{loadBots:async()=>bots,checkAdmission:async()=>allowAdmission,execute:async(_,bot)=>{calls.push(bot.id);return {provider:'meta',model,text:'Synthetic peer reply '+calls.length,runId:'fixture-'+calls.length};}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const post=(op,body,origin)=>fetch(base+'/v1/bot-chat/'+op,{method:'POST',headers:{'content-type':'application/json','tailscale-user-login':'synthetic-owner',...(origin?{origin}:{})},body:JSON.stringify(body)});
 try{
  assert.equal((await post('sessions',{botId:'profile:a',sessionId:cycle,action:'create',title:'Synthetic peer'})).status,201);
  let turns=[];for(let n=0;n<4;n++){
   const plan=await bbJSON(cfg.bb,['-m','itonami-chat.peer'],{grant,turns});
   const request={schema:'awai.bot-chat-request.v1',botId:'profile:a',sessionId:cycle,requestId:randomUUID(),model,text:plan.prompt,peer:{cycleId:cycle,turn:n}};
   if(n===0){assert.equal((await post('turn',request,'http://127.0.0.1:8906')).status,409);assert.equal(calls.length,0);assert.equal((await post('turn',request)).status,409);assert.equal(calls.length,0);allowAdmission=true;}
   const response=await post('turn',request);assert.equal(response.status,200);const r=await response.json();assert.equal(r.speakerBotId,plan.speaker);assert.equal(r.peer.turn,n);turns.push({turn:n,speaker:r.speakerBotId,state:'completed',text:r.text});
  }
  const extra=await post('turn',{schema:'awai.bot-chat-request.v1',botId:'profile:a',sessionId:cycle,requestId:randomUUID(),model,text:'Do more',peer:{cycleId:cycle,turn:4}});assert.equal(extra.status,409);
  assert.deepEqual(calls,['profile:a','profile:b','profile:a','profile:b']);
  const h=await(await post('history',{botId:'profile:a',sessionId:cycle})).json();assert.equal(h.messages.length,8);assert.equal(h.session.completedTurns,4);assert.equal(h.session.goal,grant.goal);
  const linked=await(await post('sessions',{botId:'profile:b',action:'list'})).json();assert.ok(linked.sessions.some(s=>s.sessionId===cycle));
  const other=await(await post('history',{botId:'profile:b',sessionId:cycle})).json();assert.equal(other.messages.length,8);assert.equal(other.store.headCid,h.store.headCid);
 }finally{await new Promise(r=>server.close(r));}
});
