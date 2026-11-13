import fs from 'node:fs/promises';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {database,verifySources} from './database.mjs';
import {infer} from './inference.mjs';
import {presenceReporter} from './presence.mjs';
import {peerGrant,peerMetadata,authorizePeer,checkPeerAdmission} from './peer.mjs';
import {scopes,sessionRows,recordSession,validSession} from './sessions.mjs';
export function handler(cfg,{db=database,execute=infer,loadBots,onProcess=()=>{},checkAdmission=checkPeerAdmission}={}){
 const active=new Set();
 return async(req,res)=>{
  const origin=req.headers.origin,allowedOrigin=cfg.origins.includes(origin);
  if(allowedOrigin){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');res.setHeader('access-control-allow-methods','POST, OPTIONS');res.setHeader('access-control-allow-headers','content-type');res.setHeader('access-control-allow-private-network','true');}
  const reply=(code,value)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  if(!allowedOrigin&&!(cfg.allowCLI===true&&origin===undefined))return reply(403,{error:'origin-not-approved'});
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const owner=req.headers['tailscale-user-login'];
  if(typeof owner!=='string'||owner!==cfg.ownerLogin)return reply(403,{error:'owner-identity-required'});
  if(req.method!=='POST'||!['/v1/bot-chat/history','/v1/bot-chat/turn','/v1/bot-chat/sessions'].includes(req.url)||req.headers['content-type']!=='application/json')return reply(404,{error:'unsupported-operation'});
  let request;try{let body='';for await(const chunk of req){body+=chunk;if(body.length>40000)throw Error();}request=JSON.parse(body);}catch{return reply(400,{error:'invalid-request'});}
  if(!request||typeof request!=='object'||Array.isArray(request))return reply(400,{error:'invalid-request'});
  if(!/^profile:[\w.-]+$/.test(request.botId??''))return reply(400,{error:'invalid-bot'});
  const sessionId=request.sessionId??'default';if(!validSession(sessionId))return reply(400,{error:'invalid-session'});
  let bot,bots;try{bots=await loadBots();bot=bots.find(b=>b.id===request.botId);}catch{return reply(503,{error:'catalog-unavailable'});}
  if(!bot)return reply(404,{error:'bot-not-registered'});
  try{
   const candidate=peerGrant(cfg,sessionId),grant=candidate?.participants.some(p=>p['bot-id']===bot.id)?candidate:null;
   const canonicalBotId=grant?.participants[0]['bot-id']??bot.id;
   const {thread,index}=await scopes(cfg,owner,canonicalBotId,sessionId),rows=await sessionRows(cfg,index,db);
   let session=rows.sessions.find(s=>s.sessionId===sessionId);
   if(req.url.endsWith('/sessions')){
    if(request.action==='list'){
     const legacy=await db(cfg,(await scopes(cfg,owner,bot.id)).thread,'history');
     const sessions=[...rows.sessions];
     for(const g of cfg.peerCycles??[]){if(!g.participants.some(p=>p['bot-id']===bot.id)||sessions.some(s=>s.sessionId===g['session-id']))continue;const target=await scopes(cfg,owner,g.participants[0]['bot-id'],g['session-id']);const linked=await sessionRows(cfg,target.index,db);const shared=linked.sessions.find(s=>s.sessionId===g['session-id']);if(shared)sessions.push(shared);}
     if(legacy.messages.length&&!sessions.some(s=>s.sessionId==='default'))sessions.push({sessionId:'default',title:bot.name,createdAt:legacy.messages[0].at,updatedAt:legacy.messages.at(-1).at,messageCount:legacy.messages.length,state:legacy.messages.at(-1).role==='assistant'?'completed':'unknown'});
     sessions.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));return reply(200,{botId:bot.id,sessions:sessions.slice(0,100),store:rows.store});
    }
    if(request.action!=='create'||sessionId==='default'||typeof request.title!=='string'||request.title.length>120)return reply(400,{error:'invalid-session-create'});
    if(session)return reply(200,{botId:bot.id,session,store:rows.store});
    if(active.has(index))return reply(409,{error:'agent-conversation-busy-no-automatic-retry'});
    active.add(index);try{
     const at=new Date().toISOString();session={sessionId,title:request.title.trim(),createdAt:at,updatedAt:at,messageCount:0,state:'empty',...(grant?peerMetadata(grant):{})};
     const v=await recordSession(cfg,index,sessionId,sessionId,session,db);return reply(201,{botId:bot.id,session,store:v.store});
    }finally{active.delete(index);}
   }
   if(sessionId!=='default'&&!session)return reply(404,{error:'session-not-registered'});
   if(req.url.endsWith('/history')){
    const v=await db(cfg,thread,'history'),end=request.before?v.messages.findIndex(m=>m.id===request.before):v.messages.length;
    if(end<0)return reply(400,{error:'unknown-history-cursor'});const begin=Math.max(0,end-100),messages=v.messages.slice(begin,end);
    return reply(200,{botId:bot.id,sessionId,session,messages,nextCursor:begin>0?messages[0].id:null,store:v.store});
   }
   if(request.schema!=='awai.bot-chat-request.v1'||request.model!==cfg.model||!/^[a-f0-9-]{36}$/.test(request.requestId??'')||typeof request.text!=='string'||!request.text.trim()||request.text.length>8192||request.history!==undefined)return reply(400,{error:'invalid-turn'});
   if(!bot.chatPersona?.available)return reply(409,{error:'verified-bot-profile-unavailable'});
   if(active.has(index))return reply(409,{error:'agent-conversation-busy-no-automatic-retry'});active.add(index);
   try{
    const history=await db(cfg,thread,'history'),prior=history.messages.find(m=>m.id===request.requestId),answer=history.messages.find(m=>m.parentId===request.requestId&&m.role==='assistant');
    const meta=(messages,state)=>({title:session?.title??bot.name,createdAt:session?.createdAt??messages[0]?.at,updatedAt:messages.at(-1).at,messageCount:messages.length,state,...(grant?peerMetadata(grant,messages.filter(m=>m.role==='assistant').length):{})});
    if(prior){
     if(prior.text!==request.text||(prior.peer&&(!request.peer||prior.peer.cycleId!==request.peer.cycleId||prior.peer.turn!==request.peer.turn)))return reply(409,{error:'request-id-conflict'});
     if(!answer)return reply(409,{error:'previous-outcome-unknown-no-redispatch'});
     if(history.messages.at(-1)?.id===answer.id&&session?.updatedAt!==answer.at)await recordSession(cfg,index,sessionId,sessionId+':'+request.requestId+':done',meta(history.messages,'completed'),db);
     return reply(200,{requestId:request.requestId,botId:bot.id,sessionId,state:'completed',text:answer.text,provider:answer.provider,model:answer.model,runId:answer.runId,usage:answer.usage,usageCoverage:answer.usageCoverage,speakerBotId:answer.speakerBotId,speakerName:answer.speakerName,peer:answer.peer,store:history.store});
    }
    let peer=null;
    if(request.peer||grant){try{peer=await authorizePeer(cfg,{...request,sessionId},history.messages,bots,origin);}catch{return reply(409,{error:'peer-plan-refused-no-inference',requestId:request.requestId,modelInvoked:false});}
     try{if(!await checkAdmission(cfg,request,peer))return reply(409,{error:'peer-admission-unconfirmed-no-inference',requestId:request.requestId,modelInvoked:false});}catch{return reply(503,{error:'peer-admission-unavailable-no-inference',requestId:request.requestId,modelInvoked:false});}}

    const message={id:request.requestId,role:'user',text:request.text,at:new Date().toISOString(),...(peer?{peer:peer.envelope,speakerName:peer.envelope.from==='owner-goal'?'Goal':peer.envelope.from}: {})};
    const accepted=await db(cfg,thread,'append',[message]);
    await recordSession(cfg,index,sessionId,sessionId+':'+request.requestId+':accepted',meta(accepted.messages,'unknown'),db);
    const result=await execute(cfg,peer?.bot??bot,{...request,sessionId,attributionIssue:peer?.grant['issue-id']??null,peer:peer?.envelope},history.messages,{onProcess});
    if(result.provider!=='meta'||result.model!==cfg.model||typeof result.text!=='string'||!result.text.trim()||result.text.length>32768)throw Error('invalid-inference-result');
    const stored=await db(cfg,thread,'append',[{id:request.requestId+':reply',parentId:request.requestId,role:'assistant',text:result.text,at:new Date().toISOString(),provider:result.provider,model:result.model,runId:result.runId,usage:result.usage,usageCoverage:result.usageCoverage,...(peer?{peer:peer.envelope,speakerBotId:peer.bot.id,speakerName:peer.bot.name}: {})}]);
    await recordSession(cfg,index,sessionId,sessionId+':'+request.requestId+':done',meta(stored.messages,'completed'),db);
    return reply(200,{requestId:request.requestId,botId:bot.id,sessionId,state:'completed',...result,...(peer?{peer:peer.envelope,speakerBotId:peer.bot.id,speakerName:peer.bot.name}:{}),store:stored.store});
   }finally{active.delete(index);}
  }catch{return reply(503,{error:'agent-result-or-storage-unconfirmed-no-automatic-retry'});}
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[filename,digest]=process.argv.slice(2),bytes=await fs.readFile(filename);if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('service-config-pin-mismatch');const cfg=JSON.parse(bytes);
 if(cfg.schema!=='awai.itonami-agent-conversation.v1'||cfg.port!==8912||!cfg.ownerLogin||cfg.model!=='muse-spark-1.3')throw Error('invalid-chat-config');
 const personaBytes=await fs.readFile(cfg.personaManifest);if(createHash('sha256').update(personaBytes).digest('hex')!==cfg.personaManifestSha256)throw Error('persona-manifest-pin-mismatch');const personas=JSON.parse(personaBytes);
 await verifySources();await fs.mkdir(cfg.runRoot,{recursive:true,mode:0o700});
 const loadBots=async()=>{const e=JSON.parse(await fs.readFile(cfg.fleetArtifact));if(createHash('sha256').update(JSON.stringify(e.payload)).digest('hex')!==e.sha256)throw Error('catalog-digest-mismatch');if(e.payload.catalogSha256!==personas.catalogSha256)throw Error('persona-catalog-mismatch');return e.payload.bots.map(b=>({...b,chatPersona:personas.rows.find(p=>p.botId===b.id)}));};
 const presence=presenceReporter(cfg,personas);
 http.createServer(handler(cfg,{loadBots,onProcess:presence.onProcess})).listen(cfg.port,'127.0.0.1',()=>console.log('Itonami Agent conversation service ready on private loopback'));
}
