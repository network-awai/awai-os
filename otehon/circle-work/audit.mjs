import fs from 'node:fs/promises';import path from 'node:path';import {sha,cid} from './common.mjs';import {nextSlot} from './schedule.mjs';
export async function audit(cfg,job,binding,history){
 if(job.grant?.execution?.type!=='verified-runtime-audit-v1')throw Error('explicit audit grant required');
 const bytes=await fs.readFile(path.join(cfg.personaRoot,job.profileSha256+'.txt'));if(bytes.length>131072)throw Error('profile audit size limit');
 const checks=[{name:'profile-sha256',passed:sha(bytes)===job.profileSha256},{name:'source-enabled',passed:job.source.sourceEnabled===true&&!job.source.paused&&!['paused','completed','removed'].includes(job.source.sourceState)},{name:'owning-issue',passed:!!binding.issueUuid&&binding.projectId===job.projectId},{name:'independent-store-readback',passed:history.store?.readback===true}];
 let next=null;try{next=nextSlot(job.source.schedule,Date.now(),job.timezone,job.anchor);checks.push({name:'source-cadence',passed:Number.isFinite(next)});}catch{checks.push({name:'source-cadence',passed:false});}
 const report={schema:'itonami.verified-runtime-audit.v1',at:new Date().toISOString(),botId:job.botId,circleId:job.circleId,goalKey:job.goalKey,issueId:binding.issueId,revision:cfg.revision,profileRevision:job.profileRevision,checks,nextSourceSlot:next,passed:checks.every(c=>c.passed),scope:'measured runtime readiness; not business Goal acceptance',modelCalls:0};return {...report,artifactCid:cid(JSON.stringify(report))};
}

export function auditBytes(e){const {artifactCid,...report}=e;const bytes=JSON.stringify(report);if(cid(bytes)!==artifactCid)throw Error('audit artifact CID mismatch');return bytes;}
