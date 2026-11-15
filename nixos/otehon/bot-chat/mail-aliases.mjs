// Private owner-host mail directory. No application-origin handler or SMTP effect.
import {createHash,createPublicKey,verify,randomBytes} from 'node:crypto';
import {database} from './database.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(s);
const bounded=(s,n)=>typeof s==='string'&&s.trim().length>0&&s.length<=n&&!/[\x00-\x1f\x7f]/.test(s);
export function bindingStatement(b){return JSON.stringify({schema:'itonami.mail-principal-binding.v1',principalId:b.principalId,botId:b.botId,did:b.did,epoch:b.epoch});}
export function verifyBinding(b){
 if(!b||!uuid(b.principalId)||!/^profile:[\w.-]+$/.test(b.botId??'')||!Number.isSafeInteger(b.epoch)||b.epoch<0||b.revoked===true||!Array.isArray(b.actions)||b.actions.some(a=>!['list','issue','stop'].includes(a)))throw Error('mail-binding-required');
 // Decode the did:key Ed25519 multicodec; Node performs the signature verification.
 const z=b.did?.match(/^did:key:z([1-9A-HJ-NP-Za-km-z]{40,60})$/)?.[1];if(!z)throw Error('mail-binding-required');
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;for(const c of z)n=n*58n+BigInt(alphabet.indexOf(c));let hex=n.toString(16);if(hex.length%2)hex='0'+hex;const raw=Buffer.concat([Buffer.alloc(z.match(/^1*/)[0].length),Buffer.from(hex,'hex')]);
 if(raw.length!==34||raw[0]!==0xed||raw[1]!==1||typeof b.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(b.signature))throw Error('mail-binding-required');
 const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw.subarray(2)]),format:'der',type:'spki'});
 if(!verify(null,Buffer.from(bindingStatement(b)),key,Buffer.from(b.signature,'base64')))throw Error('mail-binding-required');
 return b;
}
function directory(events,b,now){
 const creates=events.filter(e=>e.action==='issue'),stopped=new Set(events.filter(e=>e.action==='stop').map(e=>e.aliasId));
 const aliases=creates.map(e=>({...e.alias,state:stopped.has(e.alias.aliasId)?'stopped':e.alias.expiresAt&&Date.parse(e.alias.expiresAt)<=now?'expired':'reserved'}));
 if(new Set(aliases.map(a=>a.aliasId)).size!==aliases.length||new Set(aliases.map(a=>a.address)).size!==aliases.length)throw Error('mail-directory-conflict');
 return {principalId:b.principalId,did:b.did,epoch:b.epoch,aliases:aliases.sort((a,c)=>c.createdAt.localeCompare(a.createdAt))};
}
export async function aliases(cfg,request,{db=database,now=Date.now()}={}){
 const bindings=(cfg.mailAliasBindings??[]).filter(b=>b.botId===request.botId);if(bindings.length!==1)throw Error('mail-binding-required');
 // This list comes only from digest-pinned owner service configuration, never request/model data.
 const b=verifyBinding(bindings[0]);if(!b.actions.includes(request.action))throw Error('mail-operation-not-granted');
 if(!['list','issue','stop'].includes(request.action))throw Error('invalid-mail-action');
 const thread=sha('itonami/private-mail-alias/v1\0'+b.principalId+'\0'+b.botId),read=await db(cfg,thread,'history');
 const decode=rows=>rows.map(e=>JSON.parse(e.text));let events=decode(read.messages);
 if(events.some(e=>e.principalId!==b.principalId||e.botId!==b.botId))throw Error('mail-directory-conflict');
 const latest=events.reduce((a,e)=>e.epoch>a.epoch?e:a,{epoch:-1});
 if(b.epoch<latest.epoch||b.epoch===latest.epoch&&b.did!==latest.did)throw Error('mail-binding-required');
 const result=stored=>({schema:'itonami.mail-alias-result.v1',botId:b.botId,...directory(events,b,now),basis:stored.store.headCid??null,store:stored.store,routing:'not-provisioned'});
 if(request.action==='list')return result(read);
 if(!uuid(request.requestId)||!Object.hasOwn(request,'basis'))throw Error('invalid-mail-request');
 if(request.action==='issue'&&(!bounded(request.purpose,120)||!bounded(request.counterparty,254)||request.expiresAt!=null&&(!Number.isFinite(Date.parse(request.expiresAt))||Date.parse(request.expiresAt)<=now)))throw Error('invalid-mail-request');
 if(request.action==='stop'&&!/^[a-f0-9]{32}$/.test(request.aliasId??''))throw Error('invalid-mail-request');
 const requestSha=sha(JSON.stringify({action:request.action,principalId:b.principalId,botId:b.botId,purpose:request.purpose??null,counterparty:request.counterparty??null,expiresAt:request.expiresAt??null,aliasId:request.aliasId??null}));
 const prior=events.find(e=>e.requestId===request.requestId);if(prior){if(prior.requestSha!==requestSha)throw Error('mail-request-conflict');return result(read);}
 if(request.basis!==(read.store.headCid??null))throw Error('mail-basis-changed');
 const view=directory(events,b,now);if(request.action==='issue'&&view.aliases.length>=1000)throw Error('mail-directory-limit');
 if(request.action==='stop'&&!view.aliases.some(a=>a.aliasId===request.aliasId))throw Error('mail-alias-not-found');
 const at=new Date(now).toISOString(),event={schema:'itonami.private-mail-alias-event.v1',requestId:request.requestId,requestSha,principalId:b.principalId,botId:b.botId,did:b.did,epoch:b.epoch,action:request.action,at};
 if(request.action==='issue'){
  // Independent 160-bit opaque addresses; never derive them from DID, name or purpose.
  const local=randomBytes(20).toString('hex');if(view.aliases.some(a=>a.address===local+'@awai.network'))throw Error('mail-address-collision');
  event.alias={aliasId:randomBytes(16).toString('hex'),address:local+'@awai.network',purpose:request.purpose.trim(),counterparty:request.counterparty.trim(),createdAt:at,expiresAt:request.expiresAt??null,routing:'not-provisioned'};
 }else event.aliasId=request.aliasId;
 const saved=await db(cfg,thread,'append',[{id:request.requestId,role:'session',text:JSON.stringify(event),at}],read.store.headCid??null);
 // The database acknowledges only an independent encrypted Kotobase/AwaiFS readback.
 events=decode(saved.messages);return result(saved);
}
export function usableAlias(view,aliasId){const a=view.aliases.find(a=>a.aliasId===aliasId);if(!a||a.state!=='reserved')throw Error('mail-alias-inactive');return a;}
