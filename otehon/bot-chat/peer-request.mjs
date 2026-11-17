// Explicit owner CLI transport for the bounded peer pilot. Not a browser fallback.
import fs from 'node:fs/promises';import https from 'node:https';import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const [cfgFile,cfgSha,reqFile,reqSha]=process.argv.slice(2);
const cb=await fs.readFile(cfgFile),rb=await fs.readFile(reqFile);
if(sha(cb)!==cfgSha||sha(rb)!==reqSha)throw Error('peer request/config pin mismatch');
const cfg=JSON.parse(cb),request=JSON.parse(rb);
if(cfg.schema!=='itonami.peer-pilot.v1'||cfg.agentOrigin!=='https://21mbp.tail110d8b.ts.net:8443'||!/^100\.[0-9.]+$/.test(cfg.resolveAddress)||!['sessions','history','turn'].includes(request.operation))throw Error('explicit private Agent route required');
const result=await new Promise((resolve,reject)=>{
 const u=new URL('/v1/bot-chat/'+request.operation,cfg.agentOrigin);
 const q=https.request(u,{method:'POST',headers:{'content-type':'application/json'},lookup:(_,options,cb)=>options.all?cb(null,[{address:cfg.resolveAddress,family:4}]):cb(null,cfg.resolveAddress,4),timeout:150000},r=>{
  let body='';r.on('data',b=>{body+=b;if(body.length>2097152){q.destroy(Error('response limit'));}});r.on('end',()=>{try{const v=JSON.parse(body);if(r.statusCode<200||r.statusCode>299||v.store?.owner!=='itonami-agent'||v.store?.readback!==true)throw Error('Agent response '+r.statusCode+': '+(/^[a-z0-9-]{1,100}$/.test(v.error??'')?v.error:'unconfirmed')+'; no automatic retry');resolve(v);}catch(e){reject(e);}});
 });q.on('timeout',()=>q.destroy(Error('Agent timeout; no automatic retry')));q.on('error',reject);q.end(JSON.stringify(request.body));
});
process.stdout.write(JSON.stringify(result));
