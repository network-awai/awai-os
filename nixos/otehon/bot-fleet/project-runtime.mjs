// Otehon control-plane publisher; it runs outside the static app origin.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {projectFleet} from '../shell/src/fleet-projection.js';
import {attachStabilization} from './stabilization.mjs';
import {repositoryConnections} from './repository-connections.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const resources={manifest:'http://127.0.0.1:8586/itonami-manifest-jobs-AWAI-2831-v1/current.json',
 readiness:'http://127.0.0.1:8586/itonami-bot-readiness-AWAI-2795-20261112-v1/current.json',
 original:'http://127.0.0.1:8586/itonami-job-results-AWAI-2795-v1/current.json',
 adapted:'http://127.0.0.1:8586/itonami-health-jobs-AWAI-2809-v1/current.json',
 physics:'http://127.0.0.1:8586/itonami-physics-jobs-AWAI-2809-v1/current.json',
 material:'http://127.0.0.1:8586/itonami-material-jobs-AWAI-2809-v1/current.json',
 vm:'http://127.0.0.1:8586/itonami-vm-jobs-AWAI-2820-v1/current.json'};
const output='http://127.0.0.1:8586/itonami-fleet-state-AWAI-2795-v1/current.json';
const summaryOutput='http://127.0.0.1:8586/itonami-fleet-state-AWAI-2795-v1/summary.json';
export async function atomic(file,text){
 const temp=`${file}.${randomUUID()}.pending`;const h=await fs.open(temp,'wx',0o600);
 try{await h.writeFile(text);await h.sync();}finally{await h.close();}await fs.rename(temp,file);
}
async function bounded(url,options={}){
 const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('selected-resource-unavailable');
 const chunks=[];let size=0;
 for await(const chunk of r.body){size+=chunk.length;if(size>8388608)throw Error('artifact-limit');chunks.push(chunk);}
 return Buffer.concat(chunks).toString('utf8');
}
export async function projectOnce(cfg){
 if(cfg.schema!=='awai.fleet-projector.v1'||!path.isAbsolute(cfg.stateRoot)||!path.isAbsolute(cfg.staticArtifact)
   ||path.basename(cfg.staticArtifact)!=='fleet-state.json'||path.basename(path.dirname(cfg.staticArtifact))!=='soshiki-runtime')throw Error('pinned-projector-config-required');
 const catalogText=await fs.readFile(path.join(cfg.stateRoot,'catalog.json'),'utf8');
 if(cfg.bindingsFile&&!/^bindings(-v[0-9]+)?\.json$/.test(cfg.bindingsFile))throw Error('bounded-binding-file-required');
 const bindingsText=await fs.readFile(path.join(cfg.stateRoot,cfg.bindingsFile??'bindings.json'),'utf8');
 if(sha(catalogText)!==cfg.catalogSha256||sha(bindingsText)!==cfg.bindingsSha256)throw Error('projection-input-pin-mismatch');
 const reports={};await Promise.all(Object.entries(resources).map(async([key,url])=>{
  try{reports[key]=JSON.parse(await bounded(url));}catch{reports[key]=null;}
 }));
 const connections=await repositoryConnections(cfg);
 let physicsPlan;
 if(cfg.physicsPlanSha256){const name=cfg.physicsPlanFile??'physics-plan-v1.json';if(!/^physics-plan-v[0-9]+\.json$/.test(name))throw Error('bounded-plan-file-required');const text=await fs.readFile(path.join(cfg.stateRoot,name),'utf8');if(sha(text)!==cfg.physicsPlanSha256)throw Error('physics-plan-pin-mismatch');physicsPlan=JSON.parse(text);}
 let payload=projectFleet(JSON.parse(catalogText),reports,JSON.parse(bindingsText),Date.now(),cfg.catalogSha256,connections,physicsPlan);
 if(cfg.stabilizationPlanFile){
  if(!/^stabilization-plan-v[0-9]+\.json$/.test(cfg.stabilizationPlanFile))throw Error('bounded-stabilization-file-required');
  const plan=await fs.readFile(path.join(cfg.stateRoot,cfg.stabilizationPlanFile),'utf8');
  if(sha(plan)!==cfg.stabilizationPlanSha256)throw Error('stabilization-plan-pin-mismatch');
  payload=attachStabilization(payload,JSON.parse(plan),JSON.parse(catalogText));
 }
 const text=JSON.stringify({schema:'awai.fleet-artifact.v1',sha256:sha(JSON.stringify(payload)),payload});
 await atomic(path.join(cfg.stateRoot,'current.json'),text);
 await bounded(output,{method:'PUT',headers:{'content-type':'application/json'},body:text});
 if(await bounded(output)!==text)throw Error('projection-storage-readback-mismatch');
 const summaryPayload={schema:'awai.fleet-health-summary.v1',observedAt:payload.observedAt,
  catalogSha256:payload.catalogSha256,totals:payload.totals,sources:payload.sources};
 const summaryText=JSON.stringify(summaryPayload);
 const summary=JSON.stringify({schema:'awai.fleet-summary-artifact.v1',sha256:sha(summaryText),payloadText:summaryText});
 await bounded(summaryOutput,{method:'PUT',headers:{'content-type':'application/json'},body:summary});
 if(await bounded(summaryOutput)!==summary)throw Error('summary-storage-readback-mismatch');
 await atomic(cfg.staticArtifact,text);
 const osArtifact=path.join(path.dirname(path.dirname(cfg.staticArtifact)),'fleet-state.json');
 await atomic(osArtifact,text);
 const receipt={observedAt:payload.observedAt,sha256:sha(text),storageReadback:true,staticArtifactWritten:true,osStaticArtifactWritten:true,totals:payload.totals};
 await atomic(path.join(cfg.stateRoot,'receipt.json'),JSON.stringify(receipt));return receipt;
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
 const [file,digest]=process.argv.slice(2);const raw=await fs.readFile(file,'utf8');
 if(sha(raw)!==digest)throw Error('projector-manifest-pin-mismatch');
 console.log(JSON.stringify(await projectOnce(JSON.parse(raw))));
}
