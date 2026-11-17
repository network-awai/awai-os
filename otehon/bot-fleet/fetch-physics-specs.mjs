// Download public pinned data only; never execute profile scripts or prompts.
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const [catalogPath,output,connectorConfig]=process.argv.slice(2);if(!connectorConfig)throw Error('catalog/new-output/pinned-connector-config required');
const cfg=JSON.parse(await fs.readFile(connectorConfig,'utf8'));if(sha(await fs.readFile(cfg.github))!==cfg.githubSha256)throw Error('GitHub binary pin mismatch');
const raw=await fs.readFile(catalogPath),catalog=JSON.parse(raw);await fs.mkdir(output);
const targets=catalog.organization.bots.filter(b=>b.profile.files.some(f=>f.path==='scripts/physai_measure.py'&&f.sha256==='abf4b59ccfc889da6a99cc8adb32da7bf6df6add6ecbc0766311a4bfbf83c823'));
if(targets.length>1000||targets.some(b=>!/^cloud-itonami\/[\w.-]+$/.test(b.profile.repository)||!/^[a-f0-9]{40}$/.test(b.profile.commit)))throw Error('bounded physics source set required');
const chunks=[];for(let i=0;i<targets.length;i+=20)chunks.push(targets.slice(i,i+20));let next=0;const rows=[];
async function worker(){while(next<chunks.length){const group=chunks[next++];
 const query=`query { ${group.map((b,i)=>{const [owner,name]=b.profile.repository.split('/');return `r${i}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){isPrivate isArchived object(expression:${JSON.stringify(b.profile.commit+':physics.edn')}){...on Blob{oid byteSize text}}}`;}).join(' ')} }`;
 let stdout='';try{stdout=(await exec(cfg.github,['api','graphql','-f',`query=${query}`],{timeout:30000,maxBuffer:4194304})).stdout;}catch(e){stdout=typeof e.stdout==='string'?e.stdout:'';}
 let data;try{data=JSON.parse(stdout).data;}catch{}
 for(let i=0;i<group.length;i++){const b=group[i],r=data?.[`r${i}`],v=r?.object;let row={botId:b.id,repository:b.profile.repository,commit:b.profile.commit,state:'source-unavailable'};
  if(r?.isPrivate===false&&r.isArchived===false&&v&&typeof v.text==='string'&&v.byteSize<=65536){
   const bytes=Buffer.from(v.text);const oid=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
   if(bytes.length===v.byteSize&&oid===v.oid){const digest=sha(bytes),file=`${b.name}-${digest}.edn`;await fs.writeFile(`${output}/${file}`,bytes,{flag:'wx',mode:0o600});row={...row,state:'verified-public',sha256:digest,gitBlobOid:oid,bytes:bytes.length,file};}
  }else if(r?.isPrivate===true||r?.isArchived===true)row.state='private-or-archived-held';rows.push(row);
 }
}}
await Promise.all(Array.from({length:4},worker));rows.sort((a,b)=>a.botId.localeCompare(b.botId));
const report={schema:'awai.physics-spec-inventory.v1',observedAt:new Date().toISOString(),catalogSha256:sha(raw),sourceScriptSha256:'abf4b59ccfc889da6a99cc8adb32da7bf6df6add6ecbc0766311a4bfbf83c823',rows};
await fs.writeFile(`${output}/inventory.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(rows.reduce((m,r)=>({...m,[r.state]:(m[r.state]??0)+1}),{})));
