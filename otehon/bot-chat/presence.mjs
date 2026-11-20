import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
export function presenceReporter(cfg,personas){
 const active=new Map(),instanceId=randomUUID();let closed=false,last=Promise.resolve();
 const publish=async()=>{if(closed)return;const at=new Date().toISOString();
  const payload={schema:'itonami.agent-presence.v1',catalogSha256:personas.catalogSha256,observedAt:at,service:{instanceId,node:cfg.nodeId??'jun-control',heartbeatAt:at,scope:'on-demand-conversation'},residentCoverage:'unobserved',residentBots:[],conversationBots:personas.rows.filter(r=>r.available).map(r=>r.botId),executions:[...active.values()].map(r=>({...r,heartbeatAt:at}))};
  const text=JSON.stringify({schema:'itonami.agent-presence-artifact.v1',sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),payload});
  for(const file of cfg.presenceArtifacts??[]){if(!path.isAbsolute(file)||path.basename(file)!=='agent-presence.json')throw Error('bounded presence artifact required');const tmp=file+'.'+randomUUID()+'.pending';await fs.writeFile(tmp,text,{flag:'wx',mode:0o600});await fs.rename(tmp,file);}
 };
 const schedule=()=>{last=last.catch(()=>{}).then(publish);return last;};
 const onProcess=value=>{if(value.phase==='running')active.set(value.invocationId,{botId:value.botId,invocationId:value.invocationId,phase:'responding',source:'muse-process-heartbeat',startedAt:value.startedAt,...(/^[a-f0-9]{64}$/.test(value.peerCycleKey??'')?{peerCycleKey:value.peerCycleKey}:{}),node:cfg.nodeId??'jun-control'});else active.delete(value.invocationId);void schedule().catch(()=>{});};
 const timer=setInterval(()=>void schedule().catch(()=>{}),10000);void publish().catch(()=>{});
 return {onProcess,flush:schedule,close:()=>{closed=true;clearInterval(timer);}};
}
