// Operator GitHub metadata only. Availability is never a bot capability grant.
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);const orgs=['cloud-itonami','kotoba-lang','network-awai'];
export async function repositoryConnections(cfg){
 const file=`${cfg.stateRoot}/repository-connections.json`;let prior;
 try{prior=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
 if(prior?.schema==='awai.repository-connections.v1'&&prior.transportVersion===2&&Date.now()-Date.parse(prior.attemptedAt)<21600000)return prior;
 if(!cfg.github||!cfg.githubSha256)return prior??{schema:'awai.repository-connections.v1',repositories:[],errors:['connector-unconfigured']};
 if(createHash('sha256').update(await fs.readFile(cfg.github)).digest('hex')!==cfg.githubSha256)throw Error('github-connector-pin-mismatch');
 const observedAt=new Date().toISOString();const rows=[],errors=[];
 await Promise.all(orgs.map(async org=>{
  try{
   const {stdout}=await exec(cfg.github,['api','--paginate',`orgs/${org}/repos?per_page=100`,
    '--jq','.[] | {repository:.full_name,private:.private,archived:.archived,disabled:.disabled}'],{timeout:45000,maxBuffer:2097152});
   const values=stdout.trim()?stdout.trim().split('\n').map(line=>JSON.parse(line)):[];
   if(!Array.isArray(values)||values.length>10000||values.some(v=>typeof v.repository!=='string'||!v.repository.startsWith(`${org}/`)
      ||typeof v.private!=='boolean'||typeof v.archived!=='boolean'||typeof v.disabled!=='boolean'))throw Error('invalid-org-metadata');
   rows.push(...values.map(v=>({...v,observedAt})));
  }catch{errors.push(org);rows.push(...(prior?.repositories??[]).filter(v=>v.repository.startsWith(`${org}/`)));}
 }));
 rows.sort((a,b)=>a.repository.localeCompare(b.repository));
 const result={schema:'awai.repository-connections.v1',transportVersion:2,attemptedAt:observedAt,repositories:rows,errors};
 const temp=`${file}.pending`;await fs.writeFile(temp,JSON.stringify(result),{mode:0o600});await fs.rename(temp,file);return result;
}
