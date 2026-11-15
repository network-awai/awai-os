// Read-only PUBLIC fixture refresh, outside the browser/app origin.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
const exec=promisify(execFile);
const [pilotPath,output]=process.argv.slice(2);
if(!output)throw Error('usage: node reliability_audit.mjs PILOT_REPORT NEW_EVIDENCE.json');
const pilot=JSON.parse(await readFile(pilotPath,'utf8'));
if(pilot.schema!=='awai.public-replica-pilot/1'||pilot.scope!=='host-filesystem-public-fixture-only'
  ||!Array.isArray(pilot.hosts)||pilot.hosts.length!==2||pilot.hosts[0]===pilot.hosts[1]
  ||!pilot.hosts.every(h=>/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(h))
  ||!/^\/Users\/node\/github\/workspaces\/codex\/awai-2776-replica-[a-f0-9]{12}$/.test(pilot.remoteWorkspace))
  throw Error('unsupported pilot binding');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const observations=[];
for(const [i,node]of pilot.hosts.entries()){
  const command='PATH=/opt/homebrew/bin:/usr/bin:/bin; export PATH; cd '+quote(pilot.remoteWorkspace)
    +' && bb -cp nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src'
    +' scripts/otehon-c1/replica_fixture.clj read '+(i===0?'source/store':'replica');
  try{
    const r=await exec('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',
      '-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','PermitLocalCommand=no','-T','node@'+node,command],
      {timeout:15000,maxBuffer:65536});
    const v=JSON.parse(r.stdout);
    observations.push(v.result==='refused'?{node,status:'refused'}:{node,status:'read',
      rootCid:v['root-cid'],carSha:v['car-sha'],payloadSha:v['payload-sha'],bytes:v.bytes,degraded:v['degraded?']});
  }catch{observations.push({node,status:'unknown'});}
}
const fixture=pilot.fixture;
const evidence={schema:'awai.fs-reliability-evidence.v1',scope:'public-fixture-host-storage',
  observedAt:new Date().toISOString(),expectedNodes:pilot.hosts,
  dataset:{rootCid:fixture['root-cid'],carSha:fixture['car-sha'],payloadSha:fixture['payload-sha'],bytes:fixture.bytes},
  observations,historicalTests:{observedAt:pilot.observedAt,
    corruptCloneRefused:pilot.checks?.corruptCloneRefused??null,
    stagedArchiveRestore:pilot.checks?.stagedRestoreFromThirdHostArchive??null},
  sourceIssue:'AWAI-2776',continuousMonitoring:false};
await writeFile(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({observedAt:evidence.observedAt,nodes:observations.map(x=>({node:x.node,status:x.status}))}));
