import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex'),[cfgFile,digest,summaryFile]=process.argv.slice(2),bytes=await fs.readFile(cfgFile);
if(sha(bytes)!==digest)throw Error('peer projection config mismatch');const cfg=JSON.parse(bytes),s=JSON.parse(await fs.readFile(summaryFile));
if(s.schema!=='itonami.peer-cycle-result.v1'||s['cycle-key']!==sha(cfg.grant['cycle-id'])||!['progress','completed','unknown'].includes(s.state)||s.completedTurns>cfg.grant['max-turns'])throw Error('peer projection binding mismatch');
const row={cycleKey:s['cycle-key'],goal:s.goal,state:s.state,maxTurns:s.maxTurns,completedTurns:s.completedTurns,observedAt:s.observedAt,participants:s.participants,issueId:s.issueId,trackingIssue:s.trackingIssue,provider:'meta',model:cfg.grant.model,turns:s.turns.map(t=>({turn:t.turn,speaker:t.speaker,state:t.state}))};
for(const file of cfg.publicArtifacts??[]){if(!path.isAbsolute(file)||path.basename(file)!=='peer-cycles.json')throw Error('bounded peer projection path required');let old;try{old=JSON.parse(await fs.readFile(file));}catch{}
 if(old?.payload?.cycles?.some(x=>x.cycleKey===row.cycleKey&&x.completedTurns>row.completedTurns))continue;
 const payload={schema:'itonami.peer-progress.v1',catalogSha256:cfg.catalogSha256,observedAt:s.observedAt,cycles:[row,...(old?.payload?.cycles??[]).filter(x=>x.cycleKey!==row.cycleKey)].slice(0,12)};
 const text=JSON.stringify({schema:'itonami.peer-progress-artifact.v1',sha256:sha(JSON.stringify(payload)),payload}),tmp=file+'.'+randomUUID()+'.pending';await fs.writeFile(tmp,text,{flag:'wx',mode:0o600});await fs.rename(tmp,file);
}
