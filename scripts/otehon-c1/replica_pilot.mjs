// Otehon PUBLIC fixture experiment over existing SSH trust. No volume migration.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile), repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const [a,b,outputArg]=process.argv.slice(2);
if(!outputArg||a===b||![a,b].every(h=>/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(h)))
  throw Error('usage: node replica_pilot.mjs HOST_A HOST_B NEW_OUTPUT_DIRECTORY');
const output=resolve(outputArg);await mkdir(output,{mode:0o700});
const remote='/Users/node/github/workspaces/codex/awai-2776-replica-'+randomBytes(6).toString('hex');
const cp='nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src';
const helper='scripts/otehon-c1/replica_fixture.clj';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const options=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',
  '-o','ClearAllForwardings=yes','-o','ForwardAgent=no','-o','PermitLocalCommand=no','-T'];
const steps=[];
async function ssh(host,command,input){
  const start=Date.now();
  // execFile's options have no stdin field. Spawn a bounded child explicitly.
  const {spawn}=await import('node:child_process');
  const result=await new Promise((yes,no)=>{
    const child=spawn('ssh',[...options,'node@'+host,command],{stdio:['pipe','pipe','pipe']});
    let out=Buffer.alloc(0),err=Buffer.alloc(0);
    const timer=setTimeout(()=>child.kill('SIGTERM'),30000);
    child.on('error',no);child.stdin.on('error',()=>{});
    child.stdout.on('data',x=>{out=Buffer.concat([out,x]);if(out.length>2*1024*1024)child.kill('SIGTERM');});
    child.stderr.on('data',x=>{err=Buffer.concat([err,x]);if(err.length>65536)child.kill('SIGTERM');});
    child.on('close',code=>{clearTimeout(timer);yes({code,out,err});});child.stdin.end(input);
  });
  steps.push({host,durationMs:Date.now()-start,exit:result.code});
  return result;
}
function requireSuccess(r){if(r.code!==0)throw Error('remote fixture step failed; preserve evidence');return r.out;}
async function call(host,...args){
  const command='PATH=/opt/homebrew/bin:/usr/bin:/bin; export PATH; cd '+quote(remote)
    +' && bb -cp '+quote(cp)+' '+quote(helper)+' '+args.map(quote).join(' ');
  return JSON.parse(requireSuccess(await ssh(host,command)).toString());
}
function equivalent(x,y){
  if(x['root-cid']!==y['root-cid']||x['car-sha']!==y['car-sha']||x['payload-sha']!==y['payload-sha']
    ||x.bytes!==y.bytes||y['degraded?']!==false)throw Error('replica identity/payload mismatch');
}
try{
  for(const [pinPath,modulePath] of[
    ['nixos/otehon/storage/vendor/source.json','nixos/otehon/storage/vendor/apex/src/awai/fs/wal.cljc'],
    ['nixos/otehon/storage/vendor/car-source.json','nixos/otehon/storage/vendor/apex-car/src/awai/fs/car.cljc']]){
    const pin=JSON.parse(await readFile(resolve(repo,pinPath),'utf8'));
    if(hash(await readFile(resolve(repo,modulePath)))!==pin.sha256)throw Error('owning storage dependency pin mismatch');
  }
  const bundle=resolve(output,'code.tar');
  await exec('tar',['-cf',bundle,helper,'nixos/otehon/storage/src','nixos/otehon/storage/vendor'],{cwd:repo});
  const code=await readFile(bundle),codeSha=hash(code);
  for(const host of[a,b]){
    const command='umask 077; mkdir -p /Users/node/github/workspaces/codex && mkdir '+quote(remote)
      +' && cd '+quote(remote)+' && cat > code.tar && test "$(shasum -a 256 code.tar | cut -d " " -f1)" = '
      +quote(codeSha)+' && tar -xf code.tar';
    requireSuccess(await ssh(host,command,code));
  }
  const source=await call(a,'seed','source');
  const freshSource=await call(a,'read','source/store');equivalent(source,freshSource);
  const car=requireSuccess(await ssh(a,'cat '+quote(remote+'/source/fixture.car')));
  if(hash(car)!==source['car-sha'])throw Error('transported CAR hash mismatch');
  await writeFile(resolve(output,'archive.car'),car,{flag:'wx',mode:0o600});
  requireSuccess(await ssh(b,'cd '+quote(remote)+' && (umask 077; set -C; cat > incoming.car)',car));
  const imported=await call(b,'import','replica','incoming.car');equivalent(source,imported);
  // Separate SSH/BB processes. Do not contact A during this read; no host is stopped.
  const targetOnly=await call(b,'read','replica');equivalent(source,targetOnly);
  const damaged=await call(b,'corrupt-copy','replica','damaged');
  if(!damaged['source-unchanged'])throw Error('fixture source changed');
  const bad=await ssh(b,'PATH=/opt/homebrew/bin:/usr/bin:/bin; export PATH; cd '+quote(remote)
    +' && bb -cp '+quote(cp)+' '+quote(helper)+' read damaged');
  const refusal=JSON.parse(bad.out.toString());
  if(refusal.result!=='refused'||refusal['error-type']!=='corrupt-car')throw Error('corruption negative control failed');
  // Restore from the current third host's retained archive, without asking A.
  const archived=await readFile(resolve(output,'archive.car'));
  requireSuccess(await ssh(b,'cd '+quote(remote)+' && (umask 077; set -C; cat > from-archive.car)',archived));
  const restored=await call(b,'import','restored','from-archive.car');equivalent(source,restored);
  const coldRestored=await call(b,'read','restored');equivalent(source,coldRestored);
  const report={schema:'awai.public-replica-pilot/1',issue:'AWAI-2776',observedAt:new Date().toISOString(),
    hosts:[a,b],remoteWorkspace:remote,sourceBaseRevision:(await exec('git',['rev-parse','HEAD'],{cwd:repo})).stdout.trim(),
    driverSha256:hash(await readFile(fileURLToPath(import.meta.url))),
    codeArchiveSha256:codeSha,fixture:source,
    corruptionRefusal:{applicationStatus:refusal.result,type:refusal['error-type'],transportExit:bad.code},
    rpo:'unmeasured',rto:'unmeasured',checks:{twoHostCopy:true,freshSourceProcess:true,
      freshTargetProcess:true,targetReadWithoutContactingSource:true,corruptCloneRefused:true,
      originalReplicaPreserved:true,stagedRestoreFromThirdHostArchive:true},steps,
    bounds:{payloadBytes:source.bytes,maxPackPayloadBytes:921600,maxCarBytes:1048576},
    notTested:['actual-provider-loss','power-loss','VM-restart','encrypted-private-data','key-custody',
      'storage-provider-auth','distributed-head-consensus-fencing','automatic-repair','capacity-scale','offsite-backup-policy'],
    productionReady:false,scope:'host-filesystem-public-fixture-only'};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({fixture:source,checks:report.checks,productionReady:false}));
}catch(error){
  await writeFile(resolve(output,'failed.json'),JSON.stringify({message:error.message,steps,remoteWorkspace:remote},null,2),{flag:'wx'});
  throw error;
}
