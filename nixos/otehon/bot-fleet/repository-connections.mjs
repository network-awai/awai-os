// Operator GitHub metadata only. Availability is never a bot capability grant.
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);const orgs=['cloud-itonami','kotoba-lang','network-awai'];
export async function repositoryConnections(cfg){
 const file=`${cfg.stateRoot}/repository-connections.json`;let prior;
 try{prior=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
 if(prior?.schema==='awai.repository-connections.v1'&&prior.transportVersion===3&&Date.now()-Date.parse(prior.attemptedAt)<21600000)return prior;
 if(!cfg.github||!cfg.githubSha256)return prior??{schema:'awai.repository-connections.v1',repositories:[],errors:['connector-unconfigured']};
 if(createHash('sha256').update(await fs.readFile(cfg.github)).digest('hex')!==cfg.githubSha256)throw Error('github-connector-pin-mismatch');
 const catalog=JSON.parse(await fs.readFile(`${cfg.stateRoot}/catalog.json`,'utf8'));
 const requested=[...new Set(catalog.organization.bots.map(b=>b.linear?.repository??b.profile.repository))];
 if(requested.length>10000||requested.some(r=>!/^([\w.-]+)\/[\w.-]+$/.test(r)||!orgs.includes(r.split('/')[0])))throw Error('bounded-owned-repository-set-required');
 const observedAt=new Date().toISOString();const rows=[],errors=[],chunks=[];
 for(let i=0;i<requested.length;i+=25)chunks.push(requested.slice(i,i+25));
 let next=0;
 const worker=async()=>{while(next<chunks.length){const repos=chunks[next++];
  const query=`query { ${repos.map((r,i)=>{const [owner,name]=r.split('/');return `r${i}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){nameWithOwner isPrivate isArchived isDisabled}`;}).join(' ')} }`;
  let stdout='';try{stdout=(await exec(cfg.github,['api','graphql','-f',`query=${query}`],{timeout:20000,maxBuffer:2097152})).stdout;}catch(error){stdout=typeof error.stdout==='string'?error.stdout:'';}
  let data;try{data=JSON.parse(stdout).data;}catch{}
  repos.forEach((requestedRepository,i)=>{const v=data?.[`r${i}`];
   if(v&&typeof v.nameWithOwner==='string'&&typeof v.isPrivate==='boolean'&&typeof v.isArchived==='boolean'&&typeof v.isDisabled==='boolean')
    rows.push({repository:v.nameWithOwner,requestedRepository,private:v.isPrivate,archived:v.isArchived,disabled:v.isDisabled,observedAt});
   else {errors.push(requestedRepository);const old=prior?.repositories?.find(r=>(r.requestedRepository??r.repository)===requestedRepository);if(old)rows.push(old);}
  });
 }};
 await Promise.all(Array.from({length:4},worker));
 rows.sort((a,b)=>a.repository.localeCompare(b.repository));
 const result={schema:'awai.repository-connections.v1',transportVersion:3,attemptedAt:observedAt,repositories:rows,errors};
 const temp=`${file}.pending`;await fs.writeFile(temp,JSON.stringify(result),{mode:0o600});await fs.rename(temp,file);return result;
}
