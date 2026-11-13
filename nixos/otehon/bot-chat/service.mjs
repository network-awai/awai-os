import fs from 'node:fs/promises';import http from 'node:http';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {database,threadId,verifySources} from './database.mjs';import {infer} from './inference.mjs';
export function handler(cfg,{db=database,execute=infer,loadBots}={}){
 const active=new Set();return async(req,res)=>{
  const origin=req.headers.origin;if(cfg.origins.includes(origin)){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');res.setHeader('access-control-allow-methods','POST, OPTIONS');res.setHeader('access-control-allow-headers','content-type');res.setHeader('access-control-allow-private-network','true');}
  const reply=(code,value)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  if(!cfg.origins.includes(origin))return reply(403,{error:'origin-not-approved'});
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const owner=req.headers['tailscale-user-login'];if(typeof owner!=='string'||owner!==cfg.ownerLogin)return reply(403,{error:'owner-identity-required'});
  if(req.method!=='POST'||!['/v1/bot-chat/history','/v1/bot-chat/turn'].includes(req.url)||req.headers['content-type']!=='application/json')return reply(404,{error:'unsupported-operation'});
  let request;try{let body='';for await(const chunk of req){body+=chunk;if(body.length>40000)throw Error();}request=JSON.parse(body);}catch{return reply(400,{error:'invalid-request'});}
  if(!/^profile:[\w.-]+$/.test(request.botId??''))return reply(400,{error:'invalid-bot'});
  let bot;try{bot=(await loadBots()).find(b=>b.id===request.botId);}catch{return reply(503,{error:'catalog-unavailable'});}if(!bot)return reply(404,{error:'bot-not-registered'});
  const thread=threadId(owner,bot.id);
  try{
   if(req.url.endsWith('/history')){const v=await db(cfg,thread,'history');const end=request.before?v.messages.findIndex(m=>m.id===request.before):v.messages.length;if(end<0)return reply(400,{error:'unknown-history-cursor'});const begin=Math.max(0,end-100),messages=v.messages.slice(begin,end);return reply(200,{botId:bot.id,messages,nextCursor:begin>0?messages[0].id:null,store:v.store});}
   if(request.schema!=='awai.bot-chat-request.v1'||request.model!==cfg.model||!/^[a-f0-9-]{36}$/.test(request.requestId??'')||typeof request.text!=='string'||!request.text.trim()||request.text.length>8192||request.history!==undefined)return reply(400,{error:'invalid-turn'});
   if(!bot.chatPersona?.available)return reply(409,{error:'verified-bot-profile-unavailable'});
   if(active.has(thread))return reply(409,{error:'agent-conversation-busy-no-automatic-retry'});active.add(thread);
   try{
    const history=await db(cfg,thread,'history'), prior=history.messages.find(m=>m.id===request.requestId),answer=history.messages.find(m=>m.parentId===request.requestId&&m.role==='assistant');
    if(prior){if(prior.text!==request.text)return reply(409,{error:'request-id-conflict'});if(answer)return reply(200,{requestId:request.requestId,botId:bot.id,state:'completed',text:answer.text,provider:answer.provider,model:answer.model,runId:answer.runId,store:history.store});return reply(409,{error:'previous-outcome-unknown-no-redispatch'});}
    const message={id:request.requestId,role:'user',text:request.text,at:new Date().toISOString()};await db(cfg,thread,'append',[message]);
    const result=await execute(cfg,bot,request,history.messages);
    if(result.provider!=='meta'||result.model!==cfg.model||typeof result.text!=='string'||!result.text.trim()||result.text.length>32768)throw Error('invalid-inference-result');
    const stored=await db(cfg,thread,'append',[{id:request.requestId+':reply',parentId:request.requestId,role:'assistant',text:result.text,at:new Date().toISOString(),provider:result.provider,model:result.model,runId:result.runId}]);
    return reply(200,{requestId:request.requestId,botId:bot.id,state:'completed',...result,store:stored.store});
   }finally{active.delete(thread);}
  }catch{return reply(503,{error:'agent-result-or-storage-unconfirmed-no-automatic-retry'});}
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[filename,digest]=process.argv.slice(2),bytes=await fs.readFile(filename);if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('service-config-pin-mismatch');const cfg=JSON.parse(bytes);
 if(cfg.schema!=='awai.itonami-agent-conversation.v1'||cfg.port!==8912||!cfg.ownerLogin||cfg.model!=='muse-spark-1.3')throw Error('invalid-chat-config');
 const personaBytes=await fs.readFile(cfg.personaManifest);if(createHash('sha256').update(personaBytes).digest('hex')!==cfg.personaManifestSha256)throw Error('persona-manifest-pin-mismatch');const personas=JSON.parse(personaBytes);
 await verifySources();await fs.mkdir(cfg.runRoot,{recursive:true,mode:0o700});
 const loadBots=async()=>{const e=JSON.parse(await fs.readFile(cfg.fleetArtifact));if(createHash('sha256').update(JSON.stringify(e.payload)).digest('hex')!==e.sha256)throw Error('catalog-digest-mismatch');if(e.payload.catalogSha256!==personas.catalogSha256)throw Error('persona-catalog-mismatch');return e.payload.bots.map(b=>({...b,chatPersona:personas.rows.find(p=>p.botId===b.id)}));};
 http.createServer(handler(cfg,{loadBots})).listen(cfg.port,'127.0.0.1',()=>console.log('Itonami Agent conversation service ready on private loopback'));
}
