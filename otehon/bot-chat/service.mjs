import fs from 'node:fs/promises';
import{isDeepStrictEqual}from'node:util';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {database,verifySources,bbJSON} from './database.mjs';
import {infer} from './inference.mjs';
import {presenceReporter} from './presence.mjs';
import {peerGrant,historyGrant,peerMetadata,authorizePeer,checkPeerAdmission} from './peer.mjs';
import {scopes,sessionRows,recordSession,validSession} from './sessions.mjs';
import {attachVoiceTransport} from './voice-transport.mjs';
// Thin HTTP/process bridge. Identity, custody, recovery and alias policy live in CLJC.
export async function identityCall(cfg,request){return bbJSON(cfg.bb,['-m','itonami-identity.core'],{config:{identityRoot:cfg.identityRoot,identityNamespace:cfg.identityNamespace,identityCustody:cfg.identityCustody,identityEtcdConfig:cfg.identityEtcdConfig,identityAutoEnroll:cfg.identityAutoEnroll,identityAllowedBots:cfg.identityAllowedBots,identityFixture:cfg.identityFixture,fixtureLedgerRoot:cfg.fixtureLedgerRoot},request});}
export function handler(cfg,{db=database,execute=infer,loadBots,onProcess=()=>{},checkAdmission=checkPeerAdmission,identity=identityCall,activeScopes=new Set()}={}){
 const active=activeScopes;
 return async(req,res)=>{
  const origin=req.headers.origin,allowedOrigin=cfg.origins.includes(origin);
  if(allowedOrigin){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');res.setHeader('access-control-allow-methods','POST, OPTIONS');res.setHeader('access-control-allow-headers','content-type');res.setHeader('access-control-allow-private-network','true');}
  const reply=(code,value)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  if(!allowedOrigin&&!(cfg.allowCLI===true&&origin===undefined))return reply(403,{error:'origin-not-approved'});
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const owner=req.headers['tailscale-user-login'];
  if(typeof owner!=='string'||owner!==cfg.ownerLogin)return reply(403,{error:'owner-identity-required'});
  if(req.method!=='POST'||!['/v1/bot-chat/history','/v1/bot-chat/turn','/v1/bot-chat/sessions','/v1/bot-chat/bots','/v1/bot-chat/media','/v1/mail/aliases/list','/v1/mail/aliases/issue','/v1/mail/aliases/stop','/v1/mail/identity/status','/v1/mail/identity/recover'].includes(req.url)||req.headers['content-type']!=='application/json')return reply(404,{error:'unsupported-operation'});
  let request;try{let body='';for await(const chunk of req){body+=chunk;if(body.length>40000)throw Error();}request=JSON.parse(body);}catch{return reply(400,{error:'invalid-request'});}
  if(!request||typeof request!=='object'||Array.isArray(request))return reply(400,{error:'invalid-request'});
  if(req.url==='/v1/bot-chat/bots'){if(Object.keys(request).length)return reply(400,{error:'invalid-bot-directory'});try{const bots=await loadBots();return reply(200,{schema:'awai.agent-directory.v1',bots:bots.filter(b=>b.chatPersona?.available).map(b=>({id:b.id,name:b.name,repository:b.repository??null,chatPersona:{available:true,sourceSha256:b.chatPersona.sourceSha256}}))});}catch{return reply(503,{error:'catalog-unavailable'});}}
  if(!/^profile:[\w.-]+$/.test(request.botId??''))return reply(400,{error:'invalid-bot'});
  const sessionId=request.sessionId??'default';if(!validSession(sessionId))return reply(400,{error:'invalid-session'});
  let bot,bots;try{bots=await loadBots();bot=bots.find(b=>b.id===request.botId);}catch{return reply(503,{error:'catalog-unavailable'});}
  if(!bot)return reply(404,{error:'bot-not-registered'});
  if(req.url.startsWith('/v1/mail/')){
   const action=req.url.split('/').at(-1);if(request.action!==action)return reply(400,{error:'invalid-mail-action'});
   const scope='mail:'+bot.id;if(active.has(scope))return reply(409,{error:'mail-directory-busy'});
   active.add(scope);try{const v=await identity(cfg,request);return reply(v.error?409:200,v);}catch{return reply(503,{error:'identity-operation-unconfirmed'});}finally{active.delete(scope);}
  }
  try{
   const candidate=historyGrant(cfg,sessionId),grant=candidate?.participants.some(p=>p['bot-id']===bot.id)?candidate:null;
   const canonicalBotId=grant?.participants[0]['bot-id']??bot.id;
   const {thread,index}=await scopes(cfg,owner,canonicalBotId,sessionId),rows=await sessionRows(cfg,index,db);
   let session=rows.sessions.find(s=>s.sessionId===sessionId);
   if(req.url.endsWith('/sessions')){
    if(request.action==='list'){
     const legacy=await db(cfg,(await scopes(cfg,owner,bot.id)).thread,'history');
     const sessions=[...rows.sessions];
     for(const g of [...(cfg.peerCycles??[]),...(cfg.circleHistory??[])]){if(!g.participants.some(p=>p['bot-id']===bot.id)||sessions.some(s=>s.sessionId===g['session-id']))continue;const target=await scopes(cfg,owner,g.participants[0]['bot-id'],g['session-id']);const linked=await sessionRows(cfg,target.index,db);const shared=linked.sessions.find(s=>s.sessionId===g['session-id']);if(shared)sessions.push(shared);}
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
   if(req.url==='/v1/bot-chat/media'){
    if(grant||sessionId==='default'||!bot.chatPersona?.available)return reply(409,{error:'named-owner-session-required'});
    if(active.has(index))return reply(409,{error:'agent-conversation-busy-no-automatic-retry'});active.add(index);
    try{const h=await db(cfg,thread,'history'),prior=h.messages.find(m=>m.id===request.requestId);
     let admitted;try{admitted=await bbJSON(cfg.bb,['-m','itonami-chat.media-adapter'],{...request,at:prior?.at??new Date().toISOString()});}catch{return reply(400,{error:'invalid-local-image-record'});}
     const previousImage=h.messages.find(m=>m.parentId===request.requestId&&m.kind==='local-image');if(prior&&(!previousImage||prior.text!==request.text||!isDeepStrictEqual(previousImage.image,request.image)))return reply(409,{error:'request-id-conflict'});
     const stored=await db(cfg,thread,'append',admitted.events);
     const answer=stored.messages.find(m=>m.id===request.requestId+':image');
     if(!answer||answer.image?.sha256!==request.image.sha256)return reply(503,{error:'image-record-unconfirmed-no-automatic-retry'});
     if(stored.messages.at(-1)?.id===answer.id)await recordSession(cfg,index,sessionId,sessionId+':'+request.requestId+':media',{title:session.title,createdAt:session.createdAt,updatedAt:answer.at,messageCount:stored.messages.length,state:'completed'},db);
     return reply(200,{schema:'awai.agent-image-record.v1',botId:bot.id,sessionId,requestId:request.requestId,message:answer,store:stored.store});
    }finally{active.delete(index);}
   }
   if(grant?.kind==='circle-work')return reply(409,{error:'scheduled-circle-history-is-read-only'});
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
    const result=await execute(cfg,peer?.bot??bot,{...request,sessionId,attributionIssue:peer?.grant['issue-id']??null,peer:peer?.envelope},history.messages,{onProcess:value=>onProcess({...value,...(peer?{peerCycleKey:createHash('sha256').update(peer.grant['cycle-id']).digest('hex')}:{})})});
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
 const activeScopes=new Set(),common={loadBots,onProcess:presence.onProcess,activeScopes};
 const server=http.createServer(handler(cfg,common));
 await attachVoiceTransport(server,cfg,{handleFactory:signal=>handler(cfg,{...common,execute:(config,bot,request,messages,hooks)=>infer(config,bot,request,messages,{...hooks,signal})})});
 server.listen(cfg.port,'127.0.0.1',()=>console.log('Itonami Agent conversation service ready on private loopback'));
 // Startup enrolls the verified catalog under the owner policy. Small batches bound
 // process time; ordinary bot selection also resumes an interrupted enrollment.
 if(cfg.identityAutoEnroll===true){const seen=new Set();let reconciling=false;const reconcile=async()=>{if(reconciling)return;reconciling=true;try{const pending=(await loadBots()).filter(b=>!seen.has(b.id));for(let i=0;i<pending.length;i+=5){const ids=pending.slice(i,i+5).map(b=>b.id),v=await identityCall(cfg,{action:'boot',bots:ids});if(v.error||v.schema!=='itonami.identity-boot.v1'||v.verified!==ids.length)throw Error('identity-enrollment-unconfirmed');for(const id of ids)seen.add(id);}console.log('Identity catalog enrollment readback complete: '+seen.size);}catch{console.error('Identity enrollment requires recovery or operator attention');}finally{reconciling=false;}};setInterval(reconcile,60000);void reconcile();}
}
