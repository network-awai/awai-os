import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {randomUUID}from'node:crypto';
import{attachVoiceTransport,verifiedWebSocket,voiceUpgradeAllowed,VOICE_PATH,VOICE_PROTOCOL}from'../voice-transport.mjs';import{bbJSON}from'../database.mjs';
const bb=process.env.BB_BIN??'bb',scope={botId:'profile:synthetic',sessionId:randomUUID()},cfg={bb,origins:['https://app.synthetic.invalid'],ownerLogin:'synthetic@example.invalid',model:'muse-spark-1.3'};
const open={schema:'awai.bot-voice-open.v1',type:'open',scope,durationMs:180000,maxTurns:12};const frame=()=>({schema:'awai.bot-voice-frame.v1',type:'turn',requestId:randomUUID(),text:'Synthetic voice transcript'});
const gate=input=>bbJSON(bb,['-m','itonami-chat.voice-adapter'],input);
test('actual CLJC policy rejects wrong scope, extra authority, deadline, duplicate IDs and turn 13',async()=>{
 const initial=await gate({action:'open',frame:open});assert.equal(initial.admitted,true);let state=initial.value;
 for(const f of [{...open,durationMs:180001},{...open,scope:{...scope,sessionId:'default'}},{...open,provider:'other'},{...open,maxTurns:0}])assert.equal((await gate({action:'open',frame:f})).admitted,false);
 for(const f of [{...frame(),text:''},{...frame(),text:99},{...frame(),url:'https://elsewhere.invalid'},{...frame(),scope:{...scope,botId:'profile:other'}}])assert.equal((await gate({action:'turn',state,frame:f,elapsedMs:0})).admitted,false);
 assert.equal((await gate({action:'turn',state,frame:frame(),elapsedMs:180000})).admitted,false);
 const first=frame();let accepted=await gate({action:'turn',state,frame:first,elapsedMs:10});state=accepted.value.state;
 assert.equal((await gate({action:'turn',state,frame:first,elapsedMs:11})).admitted,false);
 for(let i=1;i<12;i++){accepted=await gate({action:'turn',state,frame:frame(),elapsedMs:i*10});assert.equal(accepted.admitted,true);state=accepted.value.state}
 assert.equal((await gate({action:'turn',state,frame:frame(),elapsedMs:130})).admitted,false);
});
test('upgrade admission binds exact peer, original authenticated owner, Origin, route and protocol',()=>{
 const req={method:'GET',url:VOICE_PATH,headers:{origin:cfg.origins[0],'tailscale-user-login':cfg.ownerLogin,'sec-websocket-protocol':VOICE_PROTOCOL},socket:{remoteAddress:'127.0.0.1'}};assert.equal(voiceUpgradeAllowed(req,cfg),true);
 for(const r of [{...req,url:VOICE_PATH+'?owner=x'},{...req,socket:{remoteAddress:'192.0.2.1'}},{...req,headers:{...req.headers,origin:cfg.origins[0]+'.evil'}},{...req,headers:{...req.headers,'tailscale-user-login':'other'}},{...req,headers:{...req.headers,'sec-websocket-protocol':'wrong'}}])assert.equal(voiceUpgradeAllowed(r,cfg),false);
});
async function waitAborted(s){for(let i=0;i<50&&!s.aborted();i++)await new Promise(r=>setTimeout(r,10));assert.equal(s.aborted(),true)}
async function setup({wallMs=10000,openMs=2000,execute}={}){
 const{WebSocket}=await verifiedWebSocket();let calls=0,aborted=false;const server=http.createServer();
 await attachVoiceTransport(server,cfg,{wallMs,openMs,handleFactory:signal=>{signal.addEventListener('abort',()=>aborted=true);return async(req,res)=>{assert.equal(req.headers['tailscale-user-login'],cfg.ownerLogin);let body='';for await(const b of req)body+=b;const v=JSON.parse(body);res.writeHead(200);if(req.url.endsWith('/history'))return res.end(JSON.stringify({store:{owner:'itonami-agent',readback:true}}));calls++;if(execute)await execute(signal);res.end(JSON.stringify({requestId:v.requestId,botId:v.botId,sessionId:v.sessionId,model:cfg.model,provider:'meta',state:'completed',text:'Synthetic reply',store:{owner:'itonami-agent',readback:true}}))}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}${VOICE_PATH}`,VOICE_PROTOCOL,{origin:cfg.origins[0],headers:{'tailscale-user-login':cfg.ownerLogin}});const messages=[],waiters=[];ws.on('message',b=>{const m=JSON.parse(b);waiters.length?waiters.shift()(m):messages.push(m)});const closed=new Promise(r=>ws.on('close',r));await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
 return{ws,closed,next:()=>messages.length?Promise.resolve(messages.shift()):new Promise(r=>waiters.push(r)),calls:()=>calls,aborted:()=>aborted,async close(){ws.terminate();await closed;await new Promise(r=>server.close(r))}};
}
test('wire protocol preserves result binding and refuses a repeated frame without inference replay',async()=>{
 const s=await setup();try{s.ws.send(JSON.stringify(open));assert.equal((await s.next()).schema,'awai.bot-voice-ready.v1');const f=frame();s.ws.send(JSON.stringify(f));const r=await s.next();assert.equal(r.requestId,f.requestId);assert.deepEqual(r.scope,scope);assert.equal(r.store.readback,true);s.ws.send(JSON.stringify(f));await s.closed;assert.equal(s.calls(),1);await waitAborted(s)}finally{await s.close()}
});
test('stop aborts the owned in-flight operation; no second dispatch or retry',async()=>{
 let started;const wait=new Promise(r=>started=r);const s=await setup({execute:async signal=>{started();await new Promise(r=>signal.addEventListener('abort',r,{once:true}))}});
 try{s.ws.send(JSON.stringify(open));await s.next();s.ws.send(JSON.stringify(frame()));await wait;s.ws.close();await s.closed;assert.equal(s.calls(),1);await waitAborted(s)}finally{await s.close()}
});
test('wall deadline closes even an idle approved connection',async()=>{const s=await setup({wallMs:2000});try{s.ws.send(JSON.stringify(open));await s.next();await s.closed;assert.equal(s.calls(),0);await waitAborted(s)}finally{await s.close()}});
